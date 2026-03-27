import * as THREE from 'three';
import mapboxgl from 'mapbox-gl';
import { SwarmController, type Obstacle } from './SwarmController';

const SWARM_SIZE = 50;
const MUNICH_CENTER: [number, number] = [11.5827, 48.1350];

const DRONE_REAL_SIZE_METERS = 1.0;

export interface SwarmData {
    lng: number;
    lat: number;
    relativeHeight: number;
    realSizeMeters: number;
    rotationZ: number;
    spinSpeed: number;
}

const generateSwarmData = (): SwarmData[] => {
    return Array.from({ length: SWARM_SIZE }).map(() => ({
        lng: MUNICH_CENTER[0] + (Math.random() - 0.5) * 0.0003,
        lat: MUNICH_CENTER[1] + (Math.random() - 0.5) * 0.0003,
        relativeHeight: 5,
        realSizeMeters: DRONE_REAL_SIZE_METERS,
        rotationZ: Math.random() * Math.PI * 2,
        spinSpeed: (Math.random() + 1.0) * 15.0
    }));
};

export const swarmData = generateSwarmData();

export const getSwarmBarycenter = (): [number, number] => {
    const sumLng = swarmData.reduce((acc, drone) => acc + drone.lng, 0);
    const sumLat = swarmData.reduce((acc, drone) => acc + drone.lat, 0);
    return [sumLng / SWARM_SIZE, sumLat / SWARM_SIZE];
};

export const getSwarmBounds = (): mapboxgl.LngLatBoundsLike => {
    const lngs = swarmData.map(d => d.lng);
    const lats = swarmData.map(d => d.lat);
    return [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)]
    ];
};

class DroneLayer implements mapboxgl.CustomLayerInterface {
    id = 'drone-layer';
    type: 'custom' = 'custom';
    renderingMode: '3d' = '3d';

    camera: THREE.Camera;
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer | null = null;
    map: mapboxgl.Map | null = null;

    meshArm1!: THREE.InstancedMesh;
    meshArm2!: THREE.InstancedMesh;
    meshProps!: THREE.InstancedMesh;

    swarmData = swarmData;
    centerMercator: mapboxgl.MercatorCoordinate;
    public swarmController: SwarmController;
    private unitsPerMeter: number;
    private lastTime: number = performance.now();

    debugObstacles: THREE.Group = new THREE.Group();
    lastScanTime: number = 0;

    private _tempZAxis = new THREE.Vector3(0, 0, 1);
    private _tempQuaternion = new THREE.Quaternion();

    private motorOffsets = [
        new THREE.Vector3(0.6, 0.6, 0.1),
        new THREE.Vector3(-0.6, 0.6, 0.1),
        new THREE.Vector3(0.6, -0.6, 0.1),
        new THREE.Vector3(-0.6, -0.6, 0.1)
    ];

    constructor() {
        this.camera = new THREE.Camera();
        this.scene = new THREE.Scene();
        this.scene.add(this.debugObstacles);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 2);
        directionalLight.position.set(0, -70, 100).normalize();
        this.scene.add(directionalLight);

        const ambientLight = new THREE.AmbientLight(0x404040, 3);
        this.scene.add(ambientLight);

        const [centerLng, centerLat] = getSwarmBarycenter();
        this.centerMercator = mapboxgl.MercatorCoordinate.fromLngLat([centerLng, centerLat], 0);
        this.unitsPerMeter = this.centerMercator.meterInMercatorCoordinateUnits();

        this.swarmController = new SwarmController(swarmData, centerLng, centerLat);

        this.initInstancedMeshes();
    }

    private initInstancedMeshes() {
        const bodyMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.3, metalness: 0.8 });
        const propMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });

        const armGeo1 = new THREE.BoxGeometry(1.6, 0.2, 0.15);
        const armGeo2 = new THREE.BoxGeometry(0.2, 1.6, 0.15);
        const propGeo = new THREE.BoxGeometry(0.8, 0.1, 0.02);

        this.meshArm1 = new THREE.InstancedMesh(armGeo1, bodyMat, SWARM_SIZE);
        this.meshArm2 = new THREE.InstancedMesh(armGeo2, bodyMat, SWARM_SIZE);
        this.meshProps = new THREE.InstancedMesh(propGeo, propMat, SWARM_SIZE * 4);

        this.meshArm1.frustumCulled = false;
        this.meshArm2.frustumCulled = false;
        this.meshProps.frustumCulled = false;

        this.meshArm1.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.meshArm2.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.meshProps.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

        const defaultColor = new THREE.Color(0x00ffff);
        for (let i = 0; i < SWARM_SIZE; i++) {
            this.meshArm1.setColorAt(i, defaultColor);
            this.meshArm2.setColorAt(i, defaultColor);
        }

        this.scene.add(this.meshArm1);
        this.scene.add(this.meshArm2);
        this.scene.add(this.meshProps);
    }

    private scanBuildings(groundElevation: number) {
        if (!this.map) return;

        const features = this.map.queryRenderedFeatures({ layers: ['add-3d-buildings'] });
        const newObstacles: Obstacle[] = [];
        this.debugObstacles.clear();

        const debugMat = new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true, transparent: true, opacity: 0.2 });
        const seen = new Set();

        features.forEach(f => {
            if (!f.properties || !f.geometry) return;
            const id = f.id || Math.random().toString();
            if (seen.has(id)) return;
            seen.add(id);

            const height = f.properties.height || 10;
            let minLng = 180, maxLng = -180, minLat = 90, maxLat = -90;
            let hasCoords = false;

            if (f.geometry.type === 'Polygon') {
                f.geometry.coordinates[0].forEach((coord: any) => {
                    minLng = Math.min(minLng, coord[0]);
                    maxLng = Math.max(maxLng, coord[0]);
                    minLat = Math.min(minLat, coord[1]);
                    maxLat = Math.max(maxLat, coord[1]);
                    hasCoords = true;
                });
            }

            if (hasCoords) {
                const centerLng = (minLng + maxLng) / 2;
                const centerLat = (minLat + maxLat) / 2;

                const centerLngLat = new mapboxgl.LngLat(centerLng, centerLat);
                const edgeLngLat = new mapboxgl.LngLat(centerLng, maxLat);
                const radiusMeters = centerLngLat.distanceTo(edgeLngLat);

                const merc = mapboxgl.MercatorCoordinate.fromLngLat([centerLng, centerLat], 0);

                const localX = (merc.x - this.centerMercator.x) / this.unitsPerMeter;
                const localY = -(merc.y - this.centerMercator.y) / this.unitsPerMeter;

                newObstacles.push({
                    position: new THREE.Vector3(localX, localY, 0),
                    radius: radiusMeters,
                    height: height
                });

                const cylGeo = new THREE.CylinderGeometry(
                    radiusMeters * this.unitsPerMeter,
                    radiusMeters * this.unitsPerMeter,
                    height * this.unitsPerMeter,
                    16
                );
                const cylMesh = new THREE.Mesh(cylGeo, debugMat);

                const localXMercator = (merc.x - this.centerMercator.x);
                const localYMercator = (merc.y - this.centerMercator.y);

                cylMesh.position.set(localXMercator, localYMercator, (height / 2 + groundElevation) * this.unitsPerMeter);

                cylMesh.rotation.x = Math.PI / 2;
                this.debugObstacles.add(cylMesh);
            }
        });

        this.swarmController.updateObstacles(newObstacles);
    }

    public setTargetGPS(lng: number, lat: number) {
        const targetMercator = mapboxgl.MercatorCoordinate.fromLngLat([lng, lat], 0);
        const localX = (targetMercator.x - this.centerMercator.x) / this.unitsPerMeter;
        const localY = -(targetMercator.y - this.centerMercator.y) / this.unitsPerMeter;
        this.swarmController.setTarget(localX, localY, 50);
    }

    public updateSelection(indices: number[]) {
        this.swarmController.updateSelection(indices);
        this.highlightDrones(indices);
    }

    public getDroneScreenPosition(index: number, screenWidth: number, screenHeight: number): { x: number, y: number } | null {
        if (!this.meshArm1 || !this.camera) return null;

        const matrix = new THREE.Matrix4();
        this.meshArm1.getMatrixAt(index, matrix);
        const position = new THREE.Vector3().setFromMatrixPosition(matrix);

        const vec4 = new THREE.Vector4(position.x, position.y, position.z, 1.0);
        vec4.applyMatrix4(this.camera.projectionMatrix);

        const ndcX = vec4.x / vec4.w;
        const ndcY = vec4.y / vec4.w;

        return {
            x: (ndcX + 1) / 2 * screenWidth,
            y: (1 - ndcY) / 2 * screenHeight
        };
    }

    public highlightDrones(selectedIndices: number[]) {
        const defaultColor = new THREE.Color(0x00ffff);
        const highlightColor = new THREE.Color(0xff00ff);

        for (let i = 0; i < SWARM_SIZE; i++) {
            const isSelected = selectedIndices.includes(i);
            const color = isSelected ? highlightColor : defaultColor;
            this.meshArm1.setColorAt(i, color);
            this.meshArm2.setColorAt(i, color);
        }

        this.meshArm1.instanceColor!.needsUpdate = true;
        this.meshArm2.instanceColor!.needsUpdate = true;
        this.map?.triggerRepaint();
    }

    onAdd(map: mapboxgl.Map, gl: WebGLRenderingContext) {
        this.map = map;
        this.renderer = new THREE.WebGLRenderer({
            canvas: map.getCanvas(),
            context: gl,
            antialias: true,
        });
        this.renderer.autoClear = false;
    }

    render(_gl: WebGLRenderingContext, matrix: number[]) {
        if (!this.renderer || !this.map) return;

        const now = performance.now();
        let deltaTime = (now - this.lastTime) / 1000.0;
        this.lastTime = now;
        if (deltaTime > 0.1) deltaTime = 0.1;

        const centerLngLat = this.centerMercator.toLngLat();
        const groundElevation = this.map.queryTerrainElevation([centerLngLat.lng, centerLngLat.lat]) || 520;
        if (now - this.lastScanTime > 5000) {
            this.scanBuildings(groundElevation);
            this.lastScanTime = now;
        }

        this.swarmController.update(deltaTime);


        const mapboxMatrix = new THREE.Matrix4().fromArray(matrix);
        const translationMatrix = new THREE.Matrix4().makeTranslation(
            this.centerMercator.x,
            this.centerMercator.y,
            this.centerMercator.z || 0
        );
        this.camera.projectionMatrix = mapboxMatrix.multiply(translationMatrix);

        const baseMatrix = new THREE.Matrix4();
        const propLocalMatrix = new THREE.Matrix4();
        const propWorldMatrix = new THREE.Matrix4();
        const position = new THREE.Vector3();
        const rotation = new THREE.Euler();
        const quaternion = new THREE.Quaternion();
        const scale = new THREE.Vector3();

        this.swarmController.drones.forEach((drone, index) => {
            const droneData = this.swarmData[index];

            const localXMercator = drone.position.x * this.unitsPerMeter;
            const localYMercator = -drone.position.y * this.unitsPerMeter;

            const droneMercX = this.centerMercator.x + localXMercator;
            const droneMercY = this.centerMercator.y - localYMercator;
            const mercCoord = new mapboxgl.MercatorCoordinate(droneMercX, droneMercY, 0);
            const lngLat = mercCoord.toLngLat();

            droneData.lng = lngLat.lng;
            droneData.lat = lngLat.lat;

            const localElevation = this.map!.queryTerrainElevation([lngLat.lng, lngLat.lat]) || groundElevation;

            const targetZ = (localElevation - groundElevation) + 5.0;

            const climbRate = 2.0;
            drone.position.z += (targetZ - drone.position.z) * (climbRate * deltaTime);

            const localZMercator = (drone.position.z + groundElevation) * this.unitsPerMeter;

            position.set(localXMercator, localYMercator, localZMercator);

            if (drone.velocity.lengthSq() > 0.1) {
                rotation.set(0, 0, Math.atan2(drone.velocity.y, drone.velocity.x));
            }
            quaternion.setFromEuler(rotation);

            const s = this.unitsPerMeter * drone.realSizeMeters;
            scale.set(s, s, s);

            baseMatrix.compose(position, quaternion, scale);

            this.meshArm1.setMatrixAt(index, baseMatrix);
            this.meshArm2.setMatrixAt(index, baseMatrix);

            const timeOffset = now / 1000.0;

            this.motorOffsets.forEach((offset, mIdx) => {
                const propIndex = index * 4 + mIdx;

                const direction = (mIdx % 2 === 0) ? 1 : -1;
                const propAngle = timeOffset * droneData.spinSpeed * direction;

                this._tempQuaternion.setFromAxisAngle(this._tempZAxis, propAngle);
                propLocalMatrix.compose(offset, this._tempQuaternion, scale);

                propWorldMatrix.multiplyMatrices(baseMatrix, propLocalMatrix);

                this.meshProps.setMatrixAt(propIndex, propWorldMatrix);
            });
        });

        this.meshArm1.instanceMatrix.needsUpdate = true;
        this.meshArm2.instanceMatrix.needsUpdate = true;
        this.meshProps.instanceMatrix.needsUpdate = true;

        this.renderer.resetState();
        this.renderer.render(this.scene, this.camera);

        this.map.triggerRepaint();
    }
}

export default DroneLayer;
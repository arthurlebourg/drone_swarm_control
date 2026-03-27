import * as THREE from 'three';
import mapboxgl from 'mapbox-gl';
import { SwarmController } from './SwarmController';

const SWARM_SIZE = 50;
const MUNICH_CENTER: [number, number] = [11.5827, 48.1350];

const DRONE_REAL_SIZE_METERS = 0.5;

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
        spinSpeed: 0
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

    instancedMesh: THREE.InstancedMesh;
    dummy: THREE.Object3D;
    swarmData = swarmData;

    centerMercator: mapboxgl.MercatorCoordinate;
    public swarmController: SwarmController;
    private unitsPerMeter: number;
    private lastTime: number = performance.now();

    constructor() {
        this.camera = new THREE.Camera();
        this.scene = new THREE.Scene();
        this.dummy = new THREE.Object3D();

        const directionalLight = new THREE.DirectionalLight(0xffffff, 2);
        directionalLight.position.set(0, -70, 100).normalize();
        this.scene.add(directionalLight);

        const ambientLight = new THREE.AmbientLight(0x404040, 3);
        this.scene.add(ambientLight);

        const [centerLng, centerLat] = getSwarmBarycenter();
        this.centerMercator = mapboxgl.MercatorCoordinate.fromLngLat([centerLng, centerLat], 0);
        this.unitsPerMeter = this.centerMercator.meterInMercatorCoordinateUnits();

        this.swarmController = new SwarmController(swarmData, centerLng, centerLat);

        this.instancedMesh = this.createInstancedSwarm();
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

    private createInstancedSwarm() {
        const simpleBoxGeometry = new THREE.BoxGeometry(1, 1, 1);

        const material = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            metalness: 0.5,
            roughness: 0.2,
            side: THREE.BackSide
        });

        const instancedMesh = new THREE.InstancedMesh(simpleBoxGeometry, material, SWARM_SIZE);
        instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        instancedMesh.frustumCulled = false;

        const defaultColor = new THREE.Color(0x00ffff);
        for (let i = 0; i < SWARM_SIZE; i++) {
            instancedMesh.setColorAt(i, defaultColor);
        }
        instancedMesh.instanceColor!.needsUpdate = true;

        this.scene.add(instancedMesh);
        return instancedMesh
    }

    public getDroneScreenPosition(index: number, screenWidth: number, screenHeight: number): { x: number, y: number } | null {
        if (!this.instancedMesh || !this.camera) return null;

        const matrix = new THREE.Matrix4();
        this.instancedMesh.getMatrixAt(index, matrix);

        const position = new THREE.Vector3().setFromMatrixPosition(matrix);

        const vec4 = new THREE.Vector4(position.x, position.y, position.z, 1.0);
        vec4.applyMatrix4(this.camera.projectionMatrix);

        const ndcX = vec4.x / vec4.w;
        const ndcY = vec4.y / vec4.w;

        const x = (ndcX + 1) / 2 * screenWidth;
        const y = (1 - ndcY) / 2 * screenHeight;

        return { x, y };
    }

    public highlightDrones(selectedIndices: number[]) {
        const defaultColor = new THREE.Color(0x00ffff);
        const highlightColor = new THREE.Color(0xff00ff);

        for (let i = 0; i < SWARM_SIZE; i++) {
            const isSelected = selectedIndices.includes(i);
            this.instancedMesh.setColorAt(i, isSelected ? highlightColor : defaultColor);
        }

        this.instancedMesh.instanceColor!.needsUpdate = true;
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

        this.swarmController.update(deltaTime);

        const mapboxMatrix = new THREE.Matrix4().fromArray(matrix);
        const translationMatrix = new THREE.Matrix4().makeTranslation(
            this.centerMercator.x,
            this.centerMercator.y,
            this.centerMercator.z || 0
        );
        this.camera.projectionMatrix = mapboxMatrix.multiply(translationMatrix);
        const centerLngLat = this.centerMercator.toLngLat();
        const groundElevation = this.map.queryTerrainElevation([centerLngLat.lng, centerLngLat.lat]) || 520;
        this.swarmController.drones.forEach((drone, index) => {
            const localXMercator = drone.position.x * this.unitsPerMeter;
            const localYMercator = -drone.position.y * this.unitsPerMeter;
            const localZMercator = (drone.position.z + groundElevation) * this.unitsPerMeter;

            this.dummy.position.set(localXMercator, localYMercator, localZMercator);

            if (drone.velocity.lengthSq() > 0.1) {
                this.dummy.rotation.z = Math.atan2(drone.velocity.y, drone.velocity.x);
            }

            const scale = this.unitsPerMeter * drone.realSizeMeters;
            this.dummy.scale.set(scale, scale, scale);

            this.dummy.updateMatrix();
            this.instancedMesh.setMatrixAt(index, this.dummy.matrix);
        });

        this.instancedMesh.instanceMatrix.needsUpdate = true;

        this.renderer.resetState();
        this.renderer.render(this.scene, this.camera);

        this.map.triggerRepaint();
    }
}

export default DroneLayer;
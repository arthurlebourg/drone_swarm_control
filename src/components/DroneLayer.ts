import * as THREE from 'three';
import mapboxgl from 'mapbox-gl';

const SWARM_SIZE = 500;
const MUNICH_CENTER: [number, number] = [11.5827, 48.1350];

const DRONE_REAL_SIZE_METERS = 1.0;

export interface SwarmData {
    lng: number;
    lat: number;
    relativeHeight: number;
    realSizeMeters: number;
    rotationZ: number;
}

export interface Obstacle {
    position: THREE.Vector3;
    width: number;
    depth: number;
    height: number;
    rotation: number;
}

const generateSwarmData = (): SwarmData[] => {
    return Array.from({ length: SWARM_SIZE }).map(() => ({
        lng: MUNICH_CENTER[0] + (Math.random() - 0.5) * 0.0003,
        lat: MUNICH_CENTER[1] + (Math.random() - 0.5) * 0.0003,
        relativeHeight: 5,
        realSizeMeters: DRONE_REAL_SIZE_METERS,
        rotationZ: Math.random() * Math.PI * 2,
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

    swarmGroup: THREE.Group;

    meshArm1!: THREE.InstancedMesh;
    meshArm2!: THREE.InstancedMesh;

    swarmData = swarmData;
    centerMercator: mapboxgl.MercatorCoordinate;
    private unitsPerMeter: number;
    private lastTime: number = performance.now();

    debugObstacles: THREE.Group = new THREE.Group();

    private _tempQuaternion = new THREE.Quaternion();

    private _baseMatrix = new THREE.Matrix4();
    private _position = new THREE.Vector3();
    private _scale = new THREE.Vector3();

    private worker: Worker;
    private latestPositions: Float32Array | null = null;

    constructor() {
        this.camera = new THREE.Camera();
        this.scene = new THREE.Scene();

        this.swarmGroup = new THREE.Group();
        this.scene.add(this.swarmGroup);

        this.swarmGroup.add(this.debugObstacles);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 2);
        directionalLight.position.set(0, -70, 100).normalize();
        this.scene.add(directionalLight);

        const ambientLight = new THREE.AmbientLight(0x404040, 3);
        this.scene.add(ambientLight);

        const [centerLng, centerLat] = getSwarmBarycenter();
        this.centerMercator = mapboxgl.MercatorCoordinate.fromLngLat([centerLng, centerLat], 0);
        this.unitsPerMeter = this.centerMercator.meterInMercatorCoordinateUnits();

        this.initInstancedMeshes();

        const url = new URL('../workers/swarm.worker.ts', import.meta.url)
        this.worker = new Worker(url, { type: 'module' });
        this.worker.onmessage = (e) => {
            if (e.data.type === 'TICK') {
                this.latestPositions = e.data.positions;
                this.map?.triggerRepaint();
            }
        };
        const bufferSize = SWARM_SIZE * 3 * 4;
        const sharedBuffer = new SharedArrayBuffer(bufferSize);
        this.latestPositions = new Float32Array(sharedBuffer);

        this.worker = new Worker(url, { type: 'module' });
        this.worker.onmessage = (e) => {
            if (e.data.type === 'TICK') {
                this.map?.triggerRepaint();
            }
        };

        this.worker.postMessage({
            type: 'INIT',
            payload: {
                numDrones: SWARM_SIZE,
                centerX: this.centerMercator.x,
                centerY: this.centerMercator.y,
                sharedBuffer: sharedBuffer
            }
        });
    }

    private initInstancedMeshes() {
        const bodyMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.3, metalness: 0.8 });

        const armGeo1 = new THREE.BoxGeometry(1.6, 0.2, 0.15);
        const armGeo2 = new THREE.BoxGeometry(0.2, 1.6, 0.15);

        this.meshArm1 = new THREE.InstancedMesh(armGeo1, bodyMat, SWARM_SIZE);
        this.meshArm2 = new THREE.InstancedMesh(armGeo2, bodyMat, SWARM_SIZE);

        this.meshArm1.frustumCulled = false;
        this.meshArm2.frustumCulled = false;

        this.meshArm1.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.meshArm2.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

        const defaultColor = new THREE.Color(0x00ffff);
        for (let i = 0; i < SWARM_SIZE; i++) {
            this.meshArm1.setColorAt(i, defaultColor);
            this.meshArm2.setColorAt(i, defaultColor);
        }

        this.swarmGroup.add(this.meshArm1);
        this.swarmGroup.add(this.meshArm2);
    }

    private _debugMat = new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true, transparent: true, opacity: 0.2 });

    private _seen = new Set();

    public scanBuildings(groundElevation: number) {
        if (!this.map) return;

        const features = this.map.queryRenderedFeatures({ layers: ['add-3d-buildings'] });
        const newObstacles: any[] = [];
        this.debugObstacles.clear();

        this._seen.clear();

        features.forEach(f => {
            if (!f.properties || !f.geometry || f.geometry.type !== 'Polygon') return;

            const id = f.id || Math.random().toString();
            if (this._seen.has(id)) return;
            this._seen.add(id);

            const rawCoords = f.geometry.coordinates[0];
            if (!rawCoords || rawCoords.length < 3) return;

            const height = f.properties.height || 10;
            const mercPoints = rawCoords.map((coord: any) => mapboxgl.MercatorCoordinate.fromLngLat(coord));

            let minArea = Infinity;
            let bestRotation = 0;
            let bestWidth = 0, bestDepth = 0;
            let bestCenterU = 0, bestCenterV = 0;

            for (let i = 0; i < mercPoints.length - 1; i++) {
                const dx = mercPoints[i + 1].x - mercPoints[i].x;
                const dy = mercPoints[i + 1].y - mercPoints[i].y;
                if (dx === 0 && dy === 0) continue;

                const rotation = Math.atan2(dy, dx);
                const cos = Math.cos(-rotation);
                const sin = Math.sin(-rotation);

                let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;

                for (const p of mercPoints) {
                    const u = p.x * cos - p.y * sin;
                    const v = p.x * sin + p.y * cos;
                    if (u < minU) minU = u;
                    if (u > maxU) maxU = u;
                    if (v < minV) minV = v;
                    if (v > maxV) maxV = v;
                }

                const area = (maxU - minU) * (maxV - minV);
                if (area < minArea) {
                    minArea = area;
                    bestRotation = rotation;
                    bestWidth = maxU - minU;
                    bestDepth = maxV - minV;
                    bestCenterU = (minU + maxU) / 2;
                    bestCenterV = (minV + maxV) / 2;
                }
            }

            if (minArea === Infinity) return;

            const mercCenterX = bestCenterU * Math.cos(bestRotation) - bestCenterV * Math.sin(bestRotation);
            const mercCenterY = bestCenterU * Math.sin(bestRotation) + bestCenterV * Math.cos(bestRotation);

            const widthMeters = bestWidth / this.unitsPerMeter;
            const depthMeters = bestDepth / this.unitsPerMeter;

            const localX = (mercCenterX - this.centerMercator.x) / this.unitsPerMeter;
            const localY = -(mercCenterY - this.centerMercator.y) / this.unitsPerMeter;

            newObstacles.push({
                position: new THREE.Vector3(localX, localY, 0),
                width: widthMeters,
                depth: depthMeters,
                height: height,
                rotation: -bestRotation
            });

            const boxGeo = new THREE.BoxGeometry(widthMeters, height, depthMeters);
            const boxMesh = new THREE.Mesh(boxGeo, this._debugMat);
            boxMesh.rotation.x = Math.PI / 2;

            const group = new THREE.Group();
            group.position.set(
                localX,
                localY,
                (height / 2) + groundElevation
            );
            group.rotation.z = -bestRotation;
            group.add(boxMesh);

            this.debugObstacles.add(group);
        });

        const flatObstacles = new Float32Array(newObstacles.length * 6);
        newObstacles.forEach((obs, i) => {
            const offset = i * 6;
            flatObstacles[offset] = obs.position.x;
            flatObstacles[offset + 1] = obs.position.y;
            flatObstacles[offset + 2] = obs.height;
            flatObstacles[offset + 3] = obs.width;
            flatObstacles[offset + 4] = obs.depth;
            flatObstacles[offset + 5] = obs.rotation;
        });

        this.worker.postMessage({ type: 'UPDATE_OBSTACLES', payload: flatObstacles });
    }

    public setTargetGPS(lng: number, lat: number) {
        const targetMercator = mapboxgl.MercatorCoordinate.fromLngLat([lng, lat], 0);
        const localX = (targetMercator.x - this.centerMercator.x) / this.unitsPerMeter;
        const localY = -(targetMercator.y - this.centerMercator.y) / this.unitsPerMeter;
        this.worker.postMessage({ type: 'SET_TARGET', payload: { x: localX, y: localY, z: 50 } });
    }

    public updateSelection(indices: number[]) {
        this.highlightDrones(indices);

        const selectedArray = new Uint32Array(indices);
        this.worker.postMessage({ type: 'UPDATE_SELECTION', payload: selectedArray });
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

    public clearTargetGPS() {
        this.worker.postMessage({ type: 'CLEAR_TARGET' });
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

        const mapboxMatrix = new THREE.Matrix4().fromArray(matrix);
        const transformMatrix = new THREE.Matrix4()
            .makeTranslation(this.centerMercator.x, this.centerMercator.y, this.centerMercator.z || 0)
            .scale(new THREE.Vector3(this.unitsPerMeter, -this.unitsPerMeter, this.unitsPerMeter));

        this.camera.projectionMatrix = mapboxMatrix.multiply(transformMatrix);

        const now = performance.now();
        const deltaTime = Math.min((now - this.lastTime) / 1000.0, 0.1);
        this.lastTime = now;

        this.worker.postMessage({ type: 'UPDATE', payload: { deltaTime } });

        if (!this.latestPositions) {
            this.map.triggerRepaint();
            return;
        }

        const centerLngLat = this.centerMercator.toLngLat();
        const groundElevation = this.map.queryTerrainElevation([centerLngLat.lng, centerLngLat.lat]) || 520;

        this._scale.set(1, 1, 1);

        for (let i = 0; i < SWARM_SIZE; i++) {
            const idx = i * 3;
            const px = this.latestPositions[idx];
            const py = this.latestPositions[idx + 1];
            const pz = this.latestPositions[idx + 2];

            this._position.set(px, py, pz + groundElevation);
            this._tempQuaternion.setFromEuler(new THREE.Euler(0, 0, 0));
            this._baseMatrix.compose(this._position, this._tempQuaternion, this._scale);

            this.meshArm1.setMatrixAt(i, this._baseMatrix);
            this.meshArm2.setMatrixAt(i, this._baseMatrix);
        }

        this.meshArm1.instanceMatrix.needsUpdate = true;
        this.meshArm2.instanceMatrix.needsUpdate = true;

        this.scene.updateMatrixWorld(true);

        this.renderer.resetState();
        this.renderer.render(this.scene, this.camera);
        this.map.triggerRepaint();
    }
}

export default DroneLayer;
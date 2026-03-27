import * as THREE from 'three';
import mapboxgl from 'mapbox-gl';

const SWARM_SIZE = 50;
const MUNICH_CENTER: [number, number] = [11.5827, 48.1350];

const MIN_DRONE_REAL_SIZE_METERS = 0.5;
const MAX_DRONE_REAL_SIZE_METERS = 1.0;

const generateSwarmData = () => {
    return Array.from({ length: SWARM_SIZE }).map(() => ({
        lng: MUNICH_CENTER[0] + (Math.random() - 0.5) * 0.0003,
        lat: MUNICH_CENTER[1] + (Math.random() - 0.5) * 0.0003,
        relativeHeight: 5,
        realSizeMeters: MIN_DRONE_REAL_SIZE_METERS + Math.random() * (MAX_DRONE_REAL_SIZE_METERS - MIN_DRONE_REAL_SIZE_METERS),
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

    instancedMesh!: THREE.InstancedMesh;
    dummy: THREE.Object3D;
    swarmData = swarmData;

    // NOUVEAU : On stocke le centre de la scène en coordonnées Mercator
    centerMercator!: mapboxgl.MercatorCoordinate;

    constructor() {
        this.camera = new THREE.Camera();
        this.scene = new THREE.Scene();
        this.dummy = new THREE.Object3D();

        const directionalLight = new THREE.DirectionalLight(0xffffff, 2);
        directionalLight.position.set(0, -70, 100).normalize();
        this.scene.add(directionalLight);

        const ambientLight = new THREE.AmbientLight(0x404040, 3);
        this.scene.add(ambientLight);

        // NOUVEAU : On calcule le centre Mercator de l'essaim dès le départ
        const [centerLng, centerLat] = getSwarmBarycenter();
        this.centerMercator = mapboxgl.MercatorCoordinate.fromLngLat([centerLng, centerLat], 0);

        this.createInstancedSwarm();
    }

    private createInstancedSwarm() {
        const simpleBoxGeometry = new THREE.BoxGeometry(1, 1, 1);

        const material = new THREE.MeshStandardMaterial({
            color: 0x00ffff,
            metalness: 0.5,
            roughness: 0.2,
            side: THREE.BackSide
        });

        this.instancedMesh = new THREE.InstancedMesh(simpleBoxGeometry, material, SWARM_SIZE);
        this.instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.instancedMesh.frustumCulled = false;

        this.scene.add(this.instancedMesh);
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

    render(gl: WebGLRenderingContext, matrix: number[]) {
        if (!this.renderer || !this.map) return;

        // --- LA MAGIE EST ICI ---
        // 1. On récupère la matrice absolue de Mapbox
        const mapboxMatrix = new THREE.Matrix4().fromArray(matrix);

        // 2. On crée une matrice de translation basée sur notre centre (calculé en Float64)
        const translationMatrix = new THREE.Matrix4().makeTranslation(
            this.centerMercator.x,
            this.centerMercator.y,
            this.centerMercator.z || 0
        );

        // 3. On combine les deux. La caméra Three.js considère maintenant que (0,0,0) est au barycentre de l'essaim.
        this.camera.projectionMatrix = mapboxMatrix.multiply(translationMatrix);

        this.swarmData.forEach((data, index) => {
            const groundElevation = this.map!.queryTerrainElevation([data.lng, data.lat]) || 520;
            const finalAltitude = groundElevation + data.relativeHeight;

            // Coordonnées absolues du drone
            const droneMercator = mapboxgl.MercatorCoordinate.fromLngLat(
                [data.lng, data.lat],
                finalAltitude
            );

            // 4. POSITION LOCALE : On soustrait le centre au drone.
            // Ce calcul est fait en JS (Float64), le résultat est un chiffre très petit et hyper précis.
            const localX = droneMercator.x - this.centerMercator.x;
            const localY = droneMercator.y - this.centerMercator.y;
            const localZ = (droneMercator.z || 0) - (this.centerMercator.z || 0);

            // On place le drone sur sa position locale
            this.dummy.position.set(localX, localY, localZ);
            this.dummy.rotation.z = data.rotationZ;

            const unitsPerMeter = droneMercator.meterInMercatorCoordinateUnits();
            const scale = unitsPerMeter;
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
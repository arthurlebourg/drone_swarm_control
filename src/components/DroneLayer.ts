import * as THREE from 'three';
import mapboxgl from 'mapbox-gl';
// Import plus standard pour Vite
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const SWARM_SIZE = 50;
const MUNICH_CENTER: [number, number] = [11.5820, 48.1351];

const generateSwarmData = () => {
    return Array.from({ length: SWARM_SIZE }).map(() => ({
        lng: MUNICH_CENTER[0] + (Math.random() - 0.5) * 0.03,
        lat: MUNICH_CENTER[1] + (Math.random() - 0.5) * 0.03,
        // Munich est à 520m d'altitude, on les place donc plus haut !
        alt: 600 + Math.random() * 200,
        rotationZ: Math.random() * Math.PI * 2,
        spinSpeed: 0.02 + Math.random() * 0.05
    }));
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
    swarmData = generateSwarmData();

    constructor() {
        this.camera = new THREE.Camera();
        this.scene = new THREE.Scene();
        this.dummy = new THREE.Object3D();

        const directionalLight = new THREE.DirectionalLight(0xffffff, 2);
        directionalLight.position.set(0, -70, 100).normalize();
        this.scene.add(directionalLight);

        const ambientLight = new THREE.AmbientLight(0x404040, 3);
        this.scene.add(ambientLight);

        this.createInstancedSwarm();
    }

    private createInstancedSwarm() {
        const geometries: THREE.BufferGeometry[] = [];

        const bodyGeometry = new THREE.BoxGeometry(1, 1, 0.2);
        geometries.push(bodyGeometry);

        const rotorPositions = [
            [0.4, 0.4, 0.1], [-0.4, 0.4, 0.1],
            [0.4, -0.4, 0.1], [-0.4, -0.4, 0.1],
        ];

        rotorPositions.forEach(pos => {
            const rotorGeometry = new THREE.CylinderGeometry(0.3, 0.3, 0.05, 16);
            rotorGeometry.rotateX(Math.PI / 2);
            rotorGeometry.translate(pos[0], pos[1], pos[2]);
            geometries.push(rotorGeometry);
        });

        const mergedGeometry = mergeGeometries(geometries);
        // ON A SUPPRIMÉ LE .scale(15, 15, 15) ICI !

        const material = new THREE.MeshStandardMaterial({
            color: 0x4444ff,
            metalness: 0.5,
            roughness: 0.2
        });

        this.instancedMesh = new THREE.InstancedMesh(mergedGeometry, material, SWARM_SIZE);
        this.instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
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

        this.camera.projectionMatrix = new THREE.Matrix4().fromArray(matrix);

        this.swarmData.forEach((data, index) => {
            data.rotationZ += data.spinSpeed;

            const mercator = mapboxgl.MercatorCoordinate.fromLngLat(
                [data.lng, data.lat],
                data.alt
            );

            // LE SECRET EST ICI : Calculer la taille exacte en mètres pour Mapbox
            const scale = mercator.meterInMercatorCoordinateUnits() * 15; // Un drone de 15m

            this.dummy.position.set(mercator.x, mercator.y, mercator.z || 0);
            this.dummy.rotation.z = data.rotationZ;

            // On applique l'échelle calculée
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
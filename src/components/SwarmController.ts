import * as THREE from 'three';
import type { SwarmData } from './DroneLayer';

export interface DroneState {
    position: THREE.Vector3;
    velocity: THREE.Vector3;
    realSizeMeters: number;
}

export interface Obstacle {
    position: THREE.Vector3;
    width: number;
    depth: number;
    height: number;
    rotation: number;
}

export interface ProcessedObstacle extends Obstacle {
    cos: number;
    sin: number;
    worldCos: number;
    worldSin: number;
    halfW: number;
    halfD: number;
    boundingRadiusSq: number;
}

export class SwarmController {
    drones: DroneState[] = [];
    target: THREE.Vector3 | null = null;
    selectedIndices: Set<number> = new Set();
    processedObstacles: ProcessedObstacle[] = [];

    maxSpeed = 15.0;
    maxForce = 20.0;
    separationDistance = 4.0;

    private _tempSteer = new THREE.Vector3();
    private _tempDiff = new THREE.Vector3();
    private _tempSeparation = new THREE.Vector3();

    private grid: Map<string, number[]> = new Map();
    private cellSize: number = 4.0;

    constructor(initialData: SwarmData[], centerMercatorX: number, centerMercatorY: number) {
        this.drones = initialData.map(data => {
            const localX = (data.lng - centerMercatorX) * 111320 * Math.cos(data.lat * Math.PI / 180);
            const localY = (data.lat - centerMercatorY) * 111320;
            const localZ = data.relativeHeight;

            return {
                position: new THREE.Vector3(
                    localX + (Math.random() - 0.5) * 100,
                    localY + (Math.random() - 0.5) * 100,
                    localZ
                ),
                velocity: new THREE.Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, 0),
                realSizeMeters: data.realSizeMeters
            };
        });
    }

    setTarget(localX: number, localY: number, altitude: number = 50) {
        this.target = new THREE.Vector3(localX, localY, altitude);
    }

    updateSelection(indices: number[]) {
        this.selectedIndices = new Set(indices);
    }

    updateObstacles(newObstacles: Obstacle[]) {
        // Precompute math once when obstacles are updated
        this.processedObstacles = newObstacles.map(obs => {
            const halfW = obs.width / 2;
            const halfD = obs.depth / 2;
            // The maximum distance from the center to a corner is the bounding radius
            const boundingRadius = Math.sqrt(halfW * halfW + halfD * halfD) + 2.0; // added padding

            return {
                ...obs,
                cos: Math.cos(-obs.rotation),
                sin: Math.sin(-obs.rotation),
                worldCos: Math.cos(obs.rotation),
                worldSin: Math.sin(obs.rotation),
                halfW,
                halfD,
                boundingRadiusSq: boundingRadius * boundingRadius
            };
        });
    }

    update(deltaTime: number) {
        this.grid.clear();
        for (let i = 0; i < this.drones.length; i++) {
            const pos = this.drones[i].position;
            const cx = Math.floor(pos.x / this.cellSize);
            const cy = Math.floor(pos.y / this.cellSize);
            const cz = Math.floor(pos.z / this.cellSize);

            const key = `${cx},${cy},${cz}`;

            if (!this.grid.has(key)) {
                this.grid.set(key, []);
            }
            this.grid.get(key)!.push(i);
        }

        for (let i = 0; i < this.drones.length; i++) {
            const drone = this.drones[i];
            const isSelected = this.selectedIndices.has(i);

            const separation = this.calculateSeparation(drone, i);
            separation.multiplyScalar(1.5);

            const attraction = new THREE.Vector3(0, 0, 0);
            if (isSelected && this.target) {
                attraction.copy(this.calculateAttraction(drone));
                attraction.multiplyScalar(1.0);
            } else {
                drone.velocity.multiplyScalar(0.95);
            }

            const avoidance = this.calculateObstacleAvoidance(drone);
            avoidance.multiplyScalar(5.0);

            drone.velocity.add(separation.multiplyScalar(deltaTime));
            drone.velocity.add(attraction.multiplyScalar(deltaTime));
            drone.velocity.add(avoidance.multiplyScalar(deltaTime));

            drone.velocity.z = 0;

            drone.velocity.clampLength(0, this.maxSpeed);

            const moveStep = drone.velocity.clone().multiplyScalar(deltaTime);
            drone.position.add(moveStep);
        }
    }

    private calculateObstacleAvoidance(drone: DroneState): THREE.Vector3 {
        this._tempSteer.set(0, 0, 0);
        let count = 0;
        const padding = 2.0;

        for (const obs of this.processedObstacles) {
            if (drone.position.z > obs.height + padding) continue;

            const relX = drone.position.x - obs.position.x;
            const relY = drone.position.y - obs.position.y;

            const distSqToCenter = relX * relX + relY * relY;
            if (distSqToCenter > obs.boundingRadiusSq) continue;

            const localX = relX * obs.cos - relY * obs.sin;
            const localY = relX * obs.sin + relY * obs.cos;

            const closestX = Math.max(-obs.halfW, Math.min(localX, obs.halfW));
            const closestY = Math.max(-obs.halfD, Math.min(localY, obs.halfD));

            const localDistSq = (localX - closestX) ** 2 + (localY - closestY) ** 2;

            if (localDistSq < padding * padding) {
                const dist = Math.sqrt(localDistSq);
                let localPushX = localX;
                let localPushY = localY;

                if (dist !== 0) {
                    localPushX = localX - closestX;
                    localPushY = localY - closestY;
                }

                const pushX = localPushX * obs.worldCos - localPushY * obs.worldSin;
                const pushY = localPushX * obs.worldSin + localPushY * obs.worldCos;

                const urgency = 1.0 - (dist / padding);

                this._tempDiff.set(pushX, pushY, 0).normalize().multiplyScalar(urgency);
                this._tempSteer.add(this._tempDiff);
                count++;
            }
        }

        if (count > 0) {
            this._tempSteer.divideScalar(count).normalize().multiplyScalar(this.maxSpeed).sub(drone.velocity);
            this._tempSteer.clampLength(0, this.maxForce * 10.0);
        }

        return this._tempSteer.clone();
    }

    private calculateSeparation(drone: DroneState, index: number): THREE.Vector3 {
        this._tempSeparation.set(0, 0, 0);
        let count = 0;

        const cx = Math.floor(drone.position.x / this.cellSize);
        const cy = Math.floor(drone.position.y / this.cellSize);
        const cz = Math.floor(drone.position.z / this.cellSize);

        const separationDistSq = this.separationDistance * this.separationDistance;

        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const key = `${cx + dx},${cy + dy},${cz + dz}`;
                    const neighbors = this.grid.get(key);

                    if (neighbors) {
                        for (const otherIdx of neighbors) {
                            if (otherIdx === index) continue;

                            const other = this.drones[otherIdx];

                            const distSq = drone.position.distanceToSquared(other.position);

                            if (distSq > 0 && distSq < separationDistSq) {
                                const distance = Math.sqrt(distSq);

                                this._tempDiff.subVectors(drone.position, other.position)
                                    .normalize()
                                    .divideScalar(distance);
                                this._tempSeparation.add(this._tempDiff);
                                count++;
                            }
                        }
                    }
                }
            }
        }

        if (count > 0) {
            this._tempSeparation.divideScalar(count);
            if (this._tempSeparation.lengthSq() > 0) {
                this._tempSeparation.normalize()
                    .multiplyScalar(this.maxSpeed)
                    .sub(drone.velocity)
                    .clampLength(0, this.maxForce);
            }
        }

        return this._tempSeparation.clone();
    }

    private calculateAttraction(drone: DroneState): THREE.Vector3 {
        if (!this.target) return new THREE.Vector3(0, 0, 0);

        const desired = new THREE.Vector3().subVectors(this.target, drone.position);
        const distance = desired.length();

        if (distance < 5.0) {
            desired.setLength(this.maxSpeed * (distance / 5.0));
        } else {
            desired.setLength(this.maxSpeed);
        }

        const steer = new THREE.Vector3().subVectors(desired, drone.velocity);
        steer.clampLength(0, this.maxForce);
        return steer;
    }
}
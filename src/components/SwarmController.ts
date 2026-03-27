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

export class SwarmController {
    drones: DroneState[] = [];
    target: THREE.Vector3 | null = null;
    selectedIndices: Set<number> = new Set();
    obstacles: Obstacle[] = [];

    maxSpeed = 15.0;
    maxForce = 20.0;
    separationDistance = 4.0;

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
        this.obstacles = newObstacles;
    }

    update(deltaTime: number) {
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
        const steer = new THREE.Vector3();
        let count = 0;
        const padding = 2.0;

        for (const obs of this.obstacles) {
            if (drone.position.z > obs.height + padding) continue;

            const relX = drone.position.x - obs.position.x;
            const relY = drone.position.y - obs.position.y;

            const cos = Math.cos(-obs.rotation);
            const sin = Math.sin(-obs.rotation);
            const localX = relX * cos - relY * sin;
            const localY = relX * sin + relY * cos;

            const halfW = obs.width / 2;
            const halfD = obs.depth / 2;
            const closestX = Math.max(-halfW, Math.min(localX, halfW));
            const closestY = Math.max(-halfD, Math.min(localY, halfD));

            const dist = Math.sqrt((localX - closestX) ** 2 + (localY - closestY) ** 2);

            if (dist < padding) {
                let localPushX, localPushY;

                if (dist === 0) {
                    localPushX = localX;
                    localPushY = localY;
                } else {
                    localPushX = localX - closestX;
                    localPushY = localY - closestY;
                }

                const worldCos = Math.cos(obs.rotation);
                const worldSin = Math.sin(obs.rotation);
                const pushX = localPushX * worldCos - localPushY * worldSin;
                const pushY = localPushX * worldSin + localPushY * worldCos;

                const urgency = 1.0 - (dist / padding);
                const diff = new THREE.Vector3(pushX, pushY, 0).normalize().multiplyScalar(urgency);

                steer.add(diff);
                count++;
            }
        }

        if (count > 0) {
            steer.divideScalar(count).normalize().multiplyScalar(this.maxSpeed).sub(drone.velocity);
            steer.clampLength(0, this.maxForce * 10.0);
        }
        return steer;
    }

    private calculateSeparation(drone: DroneState, index: number): THREE.Vector3 {
        const steer = new THREE.Vector3();
        let count = 0;

        for (let i = 0; i < this.drones.length; i++) {
            if (i === index) continue;
            const other = this.drones[i];
            const distance = drone.position.distanceTo(other.position);

            if (distance > 0 && distance < this.separationDistance) {
                const diff = new THREE.Vector3().subVectors(drone.position, other.position);
                diff.normalize().divideScalar(distance);
                steer.add(diff);
                count++;
            }
        }

        if (count > 0) {
            steer.divideScalar(count);
            if (steer.lengthSq() > 0) {
                steer.normalize().multiplyScalar(this.maxSpeed).sub(drone.velocity).clampLength(0, this.maxForce);
            }
        }
        return steer;
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
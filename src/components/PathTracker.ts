import * as THREE from 'three';

export class PathTracker {
    private numDrones: number;
    private maxHistory: number;
    private maxAgeMs: number;
    private lastRecordTime: number = 0;

    // Flat array: [x, y, z, timestamp] per point to avoid object allocation overhead
    private history: Float32Array;
    private heads: Int16Array;
    private counts: Int16Array;

    constructor(numDrones: number, maxHistory: number = 200, maxAgeMs: number = 10000) {
        // Increased maxHistory to 200 and maxAge to 10 seconds since we only draw one!
        this.numDrones = numDrones;
        this.maxHistory = maxHistory;
        this.maxAgeMs = maxAgeMs;

        this.history = new Float32Array(numDrones * maxHistory * 4);
        this.heads = new Int16Array(numDrones);
        this.counts = new Int16Array(numDrones);
    }

    public recordPositions(latestPositions: Float32Array, now: number, groundElevation: number) {
        // Throttle recording to ~15fps (every 66ms) to keep the trail long without blowing up the buffer
        if (now - this.lastRecordTime < 66) return;
        this.lastRecordTime = now;

        for (let i = 0; i < this.numDrones; i++) {
            const idx = i * 3;
            const px = latestPositions[idx];
            const py = latestPositions[idx + 1];
            const pz = latestPositions[idx + 2] + groundElevation; // Store absolute Z height

            const head = this.heads[i];
            const offset = (i * this.maxHistory + head) * 4;

            this.history[offset] = px;
            this.history[offset + 1] = py;
            this.history[offset + 2] = pz;
            this.history[offset + 3] = now;

            this.heads[i] = (head + 1) % this.maxHistory;
            if (this.counts[i] < this.maxHistory) {
                this.counts[i]++;
            }
        }
    }

    public draw(ctx: CanvasRenderingContext2D, camera: THREE.Camera, width: number, height: number, now: number, selectedDrones: number[]) {
        ctx.clearRect(0, 0, width, height);

        // Only draw if exactly one drone is selected
        if (selectedDrones.length !== 1) return;

        ctx.beginPath();
        ctx.strokeStyle = '#00ffff'; // Cyan trail to stand out
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        const vec4 = new THREE.Vector4();
        const d = selectedDrones[0]; // Target our single drone
        const count = this.counts[d];

        if (count < 2) return;

        let head = this.heads[d];
        let isFirst = true;

        for (let i = 0; i < count; i++) {
            let idx = head - 1 - i;
            if (idx < 0) idx += this.maxHistory;

            const offset = (d * this.maxHistory + idx) * 4;
            const time = this.history[offset + 3];

            if (now - time > this.maxAgeMs) break;

            vec4.set(
                this.history[offset],
                this.history[offset + 1],
                this.history[offset + 2],
                1.0
            );

            vec4.applyMatrix4(camera.projectionMatrix);

            if (vec4.w <= 0) continue;

            const ndcX = vec4.x / vec4.w;
            const ndcY = vec4.y / vec4.w;

            const screenX = (ndcX + 1) / 2 * width;
            const screenY = (1 - ndcY) / 2 * height;

            if (isFirst) {
                ctx.moveTo(screenX, screenY);
                isFirst = false;
            } else {
                ctx.lineTo(screenX, screenY);
            }
        }

        ctx.stroke();
    }
}
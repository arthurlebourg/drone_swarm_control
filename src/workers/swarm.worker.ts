import init, { SwarmWasm } from "swarm-wasm";

let swarm: SwarmWasm | null = null;
let wasmInstance: any = null;
let numDrones = 0;
let sharedPositions: Float32Array | null = null;

self.onmessage = async (e) => {
    const { type, payload } = e.data;

    if (type === 'INIT') {
        wasmInstance = await init();
        numDrones = payload.numDrones;
        swarm = new SwarmWasm(numDrones, payload.centerX, payload.centerY);

        // Store a view of the SharedArrayBuffer
        sharedPositions = new Float32Array(payload.sharedBuffer);

        self.postMessage({ type: 'READY' });
    }
    else if (type === 'UPDATE') {
        if (!swarm || !wasmInstance || !sharedPositions) return;

        swarm.update(payload.deltaTime);

        const ptr = swarm.get_positions_ptr();
        const currentPositions = new Float32Array(wasmInstance.memory.buffer, ptr, numDrones * 3);

        sharedPositions.set(currentPositions);

        (self as any).postMessage({ type: 'TICK' });
    }
    else if (type === 'SET_TARGET') {
        swarm?.set_target(payload.x, payload.y, payload.z);
    }
    else if (type === 'UPDATE_SELECTION') {
        swarm?.update_selection(payload);
    }
    else if (type === 'UPDATE_OBSTACLES') {
        swarm?.update_obstacles(payload);
    }
    else if (type === 'CLEAR_TARGET') {
        swarm?.clear_target();
    }
};
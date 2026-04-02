# Drone Swarm Control

A 3D browser-based simulation of a drone swarm navigating through a city environment. It leverages Rust and WebAssembly to handle the heavy physics calculations (boids algorithm, obstacle avoidance) for hundreds of drones, keeping the main thread free while rendering everything seamlessly over Mapbox using Three.js.

![Drone Swarm Demo](./demo.gif)

### Tech Stack

* **Frontend:** React, TypeScript, Zustand, Vite
* **Rendering:** Mapbox GL JS, Three.js (Custom 3D layers)
* **Simulation Logic:** Rust, WebAssembly (WASM), Web Workers
 
### Features

* **Real-time Swarm Physics:** Simulates 500 drones using separation, attraction, and avoidance mechanics.
* **3D Environment Integration:** Drones dynamically avoid 3D buildings fetched from Mapbox.
* **Interactive Controls:** Click and drag to draw a selection box around drones, view their real-time coordinates, and set new targets for the swarm to follow.
* **High Performance:** Physics processing is entirely offloaded to a Web Worker running WASM, utilizing `SharedArrayBuffer` for fast position updates.

### Getting Started

To run this locally, you'll need Node.js installed, as well as the Rust toolchain and `wasm-pack` for building the WebAssembly module.

1. **Clone and install dependencies:**
   ```bash
   npm install
   ```

2. **Set up your Mapbox token:**
   Create a `.env` file in the root directory and add your Mapbox access token:
   ```env
   VITE_MAPBOX_TOKEN=your_mapbox_token_here
   ```

3. **Start the development server:**
   This command will automatically compile the Rust WASM package and spin up the Vite dev server.
   ```bash
   npm run dev
   ```
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    wasm(),
    topLevelAwait()
  ],
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  worker: {
    // This ensures the worker is built as an ES module, which is required for top-level await
    format: 'es',
    plugins: () => [
      wasm(),
      topLevelAwait()
    ]
  },
  // Ensure we can import the wasm package locally
  optimizeDeps: {
    exclude: ['swarm-wasm']
  }
})
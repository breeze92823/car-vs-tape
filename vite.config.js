import { defineConfig } from 'vite'

// Relative asset paths so the zipped dist/ runs from any Bloxity host path.
// es2022 for top-level await in main.js (Rapier's wasm init).
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 }, // rapier3d-compat inlines its wasm
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
})

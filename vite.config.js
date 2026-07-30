import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5173, host: true },
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        // Vite 8 bundles with Rolldown, whose manualChunks only accepts a
        // function — the classic Rollup object-map form throws at build time.
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/@dimforge/rapier3d-compat')) return 'rapier';
        },
      },
    },
  },
  // Rapier ships a wasm bundle; compat builds inline it as base64 so no
  // separate fetch is needed. Keep it out of the dep optimizer's way.
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
});

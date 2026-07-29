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
        manualChunks: {
          three: ['three'],
          rapier: ['@dimforge/rapier3d-compat'],
        },
      },
    },
  },
  // Rapier ships a wasm bundle; compat builds inline it as base64 so no
  // separate fetch is needed. Keep it out of the dep optimizer's way.
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
});

import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // Three.js alone is ~600 kB minified; that's expected for this app.
    chunkSizeWarningLimit: 1000,
  },
});

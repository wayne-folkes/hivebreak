import { defineConfig } from 'vite';

// The terminal game: one Node script, dist-cli/hivebreak.mjs, with the simulation bundled in.
export default defineConfig({
  build: {
    ssr: 'cli/main.ts',
    outDir: 'dist-cli',
    target: 'node20',
    emptyOutDir: true,
    rollupOptions: {
      output: { entryFileNames: 'hivebreak.mjs', banner: '#!/usr/bin/env node' },
    },
  },
});

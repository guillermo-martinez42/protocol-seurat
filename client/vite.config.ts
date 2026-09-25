import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  base: './',
  // Dev only: the Java server owns the Seurat endpoints (LAN, localhost).
  server: {
    proxy: {
      '/seurat': { target: 'http://localhost:8080', changeOrigin: false, ws: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: false },
  resolve: { alias: { '@': resolve(here, 'src') } },
  worker: { format: 'es' },
  test: { environment: 'node', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
});

import { defineConfig } from 'vite';
export default defineConfig({
  root: 'frontend',
  server: { port: 5173, strictPort: true, proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } },
  build: { outDir: '../dist', emptyOutDir: true },
});

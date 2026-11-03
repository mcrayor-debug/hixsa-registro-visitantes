import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// El panel se publica en /admin/ dentro de dist (junto al formulario público).
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/admin/',
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('../dist/admin', import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  server: { fs: { allow: ['..'] } },
});

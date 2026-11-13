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
    chunkSizeWarningLimit: 850, // la librería de PDF (~790 KB) solo se descarga al exportar
    rollupOptions: {
      output: {
        // Librerías en archivos separados: se guardan en caché y no se vuelven a descargar en cada versión
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
          if (id.includes('@supabase')) return 'supabase';
          if (/recharts|d3-|victory|lodash/.test(id)) return 'graficas';
          if (/jspdf|html2canvas|dompurify|canvg|fflate/.test(id)) return 'pdf';
          return undefined;
        },
      },
    },
  },
  server: { fs: { allow: ['..'] } },
});

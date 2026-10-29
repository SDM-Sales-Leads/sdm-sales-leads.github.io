import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // relative paths so the site works under any GitHub Pages sub-folder
  base: './',
  plugins: [react(), tailwindcss()],
  server: { port: 5173, host: '127.0.0.1' },
  build: {
    sourcemap: false, chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        // libraries rarely change: their own files keep the same name between releases, so people re-download only the app code
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (/node_modules\/(recharts|d3-[^/]+|victory-vendor|es-toolkit|decimal\.js-light|immer|@reduxjs|redux|react-redux|reselect|internmap)\//.test(id)) return 'vendor-charts';
          if (/node_modules\/@supabase\//.test(id)) return 'vendor-supabase';
          if (/node_modules\/(motion|motion-dom|motion-utils|framer-motion)\//.test(id)) return 'vendor-motion';
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'vendor-react';
          return undefined;
        },
      },
    },
  },
});

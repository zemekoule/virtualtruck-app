import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const trucksimLibs = fileURLToPath(new URL('../tools/trucksim-maps/packages/libs', import.meta.url));
const names = fileURLToPath(new URL('../names', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@truckermudgeon/base': `${trucksimLibs}/base`,
      '@truckermudgeon/map': `${trucksimLibs}/map`,
      '@truckermudgeon/ui': `${trucksimLibs}/ui`,
    },
    // The aliased map sources live outside web/ and must use its single copy of these.
    dedupe: ['react', 'react-dom', 'maplibre-gl', 'react-map-gl', 'pmtiles', 'proj4', 'color'],
  },
  server: {
    fs: { allow: ['.', trucksimLibs, names] },
    // Same origin as the page, so the Sanctum session cookie works (the api service of compose.yaml).
    proxy: { '/api': 'http://api:8000' },
  },
});

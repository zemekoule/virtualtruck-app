import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const trucksimLibs = fileURLToPath(new URL('../tools/trucksim-maps/packages/libs', import.meta.url));
const names = fileURLToPath(new URL('../names', import.meta.url));

export default defineConfig(({ mode }) => {
  // The project .env also holds the secret key, so only the publishable one goes to the page.
  const env = loadEnv(mode, '..', 'SUPABASE_');
  return {
    plugins: [react()],
    define: {
      SUPABASE: JSON.stringify({ projectId: env.SUPABASE_PROJECT_ID, publishableKey: env.SUPABASE_PUBLISHABLE_KEY }),
    },
    resolve: {
      alias: {
        '@truckermudgeon/base': `${trucksimLibs}/base`,
        '@truckermudgeon/map': `${trucksimLibs}/map`,
        '@truckermudgeon/ui': `${trucksimLibs}/ui`,
      },
      // The aliased map sources live outside web/ and must use its single copy of these.
      dedupe: ['react', 'react-dom', 'maplibre-gl', 'react-map-gl', 'pmtiles', 'proj4', 'color'],
    },
    server: { fs: { allow: ['.', trucksimLibs, names] } },
  };
});

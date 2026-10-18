import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv, type Plugin} from 'vite';

// The frontend always talks to the server that served it (same-origin /api, src/config/backend.ts):
// - `npm run dev` (= dev:local, Vite mode `fullstack`): /api is proxied to the local development server (3001).
// - `npm run build`: dist/, served by Cloudflare (the Worker's static assets) or by `npm run server`.
export default defineConfig(({mode}) => {
  const env = {...loadEnv(mode, process.cwd(), ''), ...process.env};
  const apiPort = env.APPBONSAI_API_PORT || 3001;

  // Say in the terminal which backend this frontend uses
  const banner: Plugin = {
    name: 'appbonsai-backend-banner',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        setTimeout(() => console.log(`\n  [appbonsai] Backend: LOCAL DEVELOPMENT → /api proxied to http://127.0.0.1:${apiPort} (separate dev database)\n`), 50);
      });
    },
  };

  return {
    plugins: [react(), tailwindcss(), banner],
    build: {
      rollupOptions: {
        output: {
          // Libraries in their own chunk: an app deploy doesn't make the phone download React again
          manualChunks: (id) => (/[\\/]node_modules[\\/](react|react-dom|scheduler|lucide-react)[\\/]/.test(id) ? 'vendor' : undefined),
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // The local development server (npm run dev) answers /api
      proxy: {'/api': `http://127.0.0.1:${apiPort}`},
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});

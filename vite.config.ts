import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv, type Plugin} from 'vite';

// Vite modes:
// - `remote` (npm run dev / npm run dev:remote): frontend only. Talks to the Raspberry Pi API at
//   VITE_API_BASE_URL (from .env.remote). No local server, collector or database.
// - `fullstack` (npm run dev:local): proxies /api to the local development server (port 3001).
// - `production` (npm run build): same-origin /api, served by the Pi's server.
// Only `remote` may point at another machine: everywhere else VITE_API_BASE_URL is forced empty.
export default defineConfig(({mode}) => {
  const env = {...loadEnv(mode, process.cwd(), ''), ...process.env};
  const remote = mode === 'remote';
  const apiBase = remote ? (env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '') : '';
  if (remote && !/^https?:\/\/[^/]+/.test(apiBase)) {
    throw new Error(
      '[appbonsai] npm run dev:remote needs VITE_API_BASE_URL (the Raspberry Pi API), e.g. http://ender3.local:3001.\n' +
        '            Put it in .env.remote (see .env.example), or use npm run dev:local for a separate local stack.'
    );
  }
  const apiPort = env.APPBONSAI_API_PORT || 3001;

  // Say loudly in the terminal which backend this frontend uses
  const banner: Plugin = {
    name: 'appbonsai-backend-banner',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        const line = remote
          ? `Backend: Raspberry Pi / remote → ${apiBase}/api (no local collector, no local database)`
          : `Backend: LOCAL DEVELOPMENT → /api proxied to http://127.0.0.1:${apiPort} (separate dev database)`;
        setTimeout(() => console.log(`\n  [appbonsai] ${line}\n`), 50);
      });
    },
  };

  return {
    plugins: [react(), tailwindcss(), banner],
    define: {
      'import.meta.env.VITE_API_BASE_URL': JSON.stringify(apiBase),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // Local full stack only: the local development server (npm run dev:local) answers /api.
      proxy: remote ? undefined : {'/api': `http://127.0.0.1:${apiPort}`},
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});

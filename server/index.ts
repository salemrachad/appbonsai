import compression from 'compression';
import express from 'express';
import { existsSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import type { BackendInfo } from '../src/api/types';
import { APP_CONFIG } from '../src/config/appConfig';
import { apiApp } from './app';
import { LivingCollector } from './collector';
import { corsForLocalNetwork } from './cors';
import { openDatabase } from './nodeSqlite';

// The Appbonsai server: polls the ESP32, stores everything in SQLite, runs the living loop
// (perception → health → behaviour → expression) and serves it on /api (and the built app on /).
// Local network only: no accounts, no cloud.
//
// Two modes:
// - production (`npm run server`, on the Raspberry Pi under systemd): THE authoritative collector
//   and database. Listens on the local network so the laptop's dev frontend can use it.
// - local-dev (`npm run dev:local`, flag --local-dev): a separate, throwaway full stack on this
//   machine with its own database (data/appbonsai-dev.db). Listens on 127.0.0.1 only.

const localDev = process.argv.includes('--local-dev') || process.env.APPBONSAI_MODE === 'local-dev';
const mode: BackendInfo['mode'] = localDev ? 'local-dev' : 'production';
const port = Number(process.env.APPBONSAI_API_PORT) || APP_CONFIG.server.port;
const host = process.env.APPBONSAI_HOST || (localDev ? '127.0.0.1' : '0.0.0.0');
const dbPath = process.env.APPBONSAI_DB ?? (localDev ? APP_CONFIG.server.devDbPath : APP_CONFIG.server.dbPath);
const distDir = path.resolve(process.cwd(), 'dist');
const servesApp = !localDev && process.env.APPBONSAI_SERVE_APP !== 'false' && existsSync(path.join(distDir, 'index.html'));

const startedAt = Date.now();
const db = openDatabase(dbPath);
const collector = new LivingCollector(db);
const backend: BackendInfo = { mode, hostname: hostname(), host, port, dbPath: db.path, collector: 'this server', servesApp };

const app = express();
app.use(compression()); // gzip: the bundle and /api/current are ~4× smaller on the phone
app.use('/api', corsForLocalNetwork((process.env.APPBONSAI_CORS_ORIGINS ?? '').split(',')));
app.use(apiApp(db, collector, { startedAt, backend }));

// Production: the built frontend (npm run build) from the same server, so the app and its API share an origin
if (servesApp) {
  // Hashed assets never change, so the browser keeps them; index.html is always revalidated to pick up a new build
  const assetsDir = path.join(distDir, 'assets');
  app.use(
    express.static(distDir, {
      setHeaders: (res, file) =>
        res.setHeader('Cache-Control', file.startsWith(assetsDir) ? 'public, max-age=31536000, immutable' : 'no-cache'),
    })
  );
  app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html'), { headers: { 'Cache-Control': 'no-cache' } }));
}

const server = app.listen(port, host, () => {
  if (localDev) {
    console.log('');
    console.log('  ┌──────────────────────────────────────────────────────────────────┐');
    console.log('  │  LOCAL DEVELOPMENT BACKEND: a separate collector and database.   │');
    console.log('  │  It reads the ESP32 (or takes its pushes) and keeps its OWN      │');
    console.log('  │  history in data/appbonsai-dev.db.                               │');
    console.log('  └──────────────────────────────────────────────────────────────────┘');
  }
  const shown = host === '0.0.0.0' ? `http://${hostname()}:${port}` : `http://${host}:${port}`;
  console.log(`[appbonsai] ${mode} backend · API on ${shown}/api · database ${db.path}${servesApp ? ' · serving dist/' : ''}`);
  void collector.start();
});

server.on('error', (err: NodeJS.ErrnoException) => {
  console.error(err.code === 'EADDRINUSE' ? `[appbonsai] port ${port} is already in use (is another server running?)` : err);
  process.exit(1);
});

const shutdown = () => {
  collector.stop();
  server.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

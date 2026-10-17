import express from 'express';
import type { BackendInfo } from '../src/api/types';
import { CalibrationService } from './calibration';
import type { LivingCollector } from './collector';
import type { AppDatabase } from './database';
import { calibrationRoutes } from './routes/calibration';
import { deviceRoutes } from './routes/devices';
import { eventRoutes } from './routes/events';
import { historyRoutes } from './routes/history';
import { ingestRoutes } from './routes/ingest';
import { interactionRoutes } from './routes/interactions';
import { statusRoutes } from './routes/status';
import { telemetryRoutes } from './routes/telemetry';

// The /api routes as one Express app: mounted by the laptop server (server/index.ts, with CORS, gzip and
// the built app around it) and run inside the tree's Durable Object on Cloudflare (worker/index.ts).
// stream: false leaves out GET /api/stream (an open stream keeps a Durable Object awake and billed; the
// browser then polls /api/current with its ETag instead).
export function apiApp(db: AppDatabase, collector: LivingCollector, opts: { startedAt: number; backend: BackendInfo; stream?: boolean }): express.Express {
  const app = express();
  app.use(jsonBody(5 * 1024 * 1024)); // browser history import can be a few MB
  const api = express.Router();
  api.use('/', statusRoutes(db, collector, opts.startedAt, opts.backend, { stream: opts.stream ?? true }));
  api.use('/events', eventRoutes(db, collector));
  api.use('/interactions', interactionRoutes(db, collector));
  api.use('/calibration', calibrationRoutes(new CalibrationService(db, collector)));
  api.use('/history', historyRoutes(db, collector));
  api.use('/telemetry', telemetryRoutes(db, collector));
  api.use('/ingest', ingestRoutes(db, collector));
  api.use('/devices', deviceRoutes(db));
  api.use((_req, res) => res.status(404).json({ error: 'Unknown API route' }));
  app.use('/api', api);
  return app;
}

// A JSON request body → req.body ({} without one). Instead of express.json(): body-parser pulls in iconv-lite,
// whose bundled form breaks in the Workers runtime, and JSON in UTF-8 is all this API takes.
function jsonBody(limit: number): express.RequestHandler {
  return (req, res, next) => {
    req.body = {};
    if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) return next();
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
    });
    req.on('error', next);
    req.on('end', () => {
      if (size > limit) return void res.status(413).json({ error: `Request body over ${limit} bytes` });
      const text = Buffer.concat(chunks).toString('utf8');
      try {
        if (text.trim()) req.body = JSON.parse(text);
      } catch {
        return void res.status(400).json({ error: 'The request body is not valid JSON' });
      }
      next();
    });
  };
}

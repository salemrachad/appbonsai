import express from 'express';
import { APP_CONFIG } from '../src/config/appConfig';
import { CalibrationService } from './calibration';
import { LivingCollector } from './collector';
import { AppDatabase } from './database';
import { calibrationRoutes } from './routes/calibration';
import { eventRoutes } from './routes/events';
import { historyRoutes } from './routes/history';
import { statusRoutes } from './routes/status';
import { telemetryRoutes } from './routes/telemetry';

// Local Appbonsai server: polls the ESP32, stores everything in SQLite, runs the living loop
// (perception → health → behaviour → expression) and serves it to the frontend on /api.
// Local only: no accounts, no cloud. Started together with Vite by `npm run dev`.

const port = Number(process.env.APPBONSAI_API_PORT) || APP_CONFIG.server.port;
const startedAt = Date.now();
const db = new AppDatabase(process.env.APPBONSAI_DB ?? APP_CONFIG.server.dbPath);
const collector = new LivingCollector(db);
const calibration = new CalibrationService(db, collector);

const app = express();
app.use(express.json({ limit: '5mb' })); // browser history import can be a few MB

app.use('/api', statusRoutes(db, collector, startedAt));
app.use('/api/events', eventRoutes(db, collector));
app.use('/api/calibration', calibrationRoutes(calibration));
app.use('/api/history', historyRoutes(db, collector));
app.use('/api/telemetry', telemetryRoutes(db, collector));
app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API route' }));

const server = app.listen(port, '127.0.0.1', () => {
  console.log(`[appbonsai] API on http://localhost:${port}/api · database ${db.path}`);
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

import { Router } from 'express';
import type { LivingCollector } from '../collector';
import type { AppDatabase } from '../database';
import { handleIngest } from '../ingest';

// POST /api/ingest: readings pushed by the ESP32 (server/ingest.ts)
export function ingestRoutes(db: AppDatabase, collector: LivingCollector): Router {
  const r = Router();
  r.post('/', (req, res) => {
    const { status, body } = handleIngest(db, collector, { authorization: req.headers.authorization, body: req.body }, Date.now());
    res.status(status).json(body);
  });
  return r;
}

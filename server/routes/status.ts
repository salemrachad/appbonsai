import { createHash } from 'node:crypto';
import { Router } from 'express';
import type { BackendInfo, LivingSnapshot, ServerStatus } from '../../src/api/types';
import { APP_CONFIG } from '../../src/config/appConfig';
import type { LivingCollector } from '../collector';
import type { AppDatabase } from '../database';

export function serverStatus(db: AppDatabase, collector: LivingCollector, startedAt: number, backend?: BackendInfo): ServerStatus {
  const stats = db.telemetryStats();
  const c = collector.collectorStatus();
  return {
    ok: true,
    backend: backend && { ...backend, collector: `this server collects (${c.dataSource}${c.endpoint ? ` from ${c.endpoint}` : ''})` },
    startedAt,
    engineVersion: APP_CONFIG.engineVersion,
    dbPath: db.path,
    configured: collector.isConfigured(),
    collector: c,
    counts: { telemetry: stats.count, events: db.eventCount(), episodes: db.episodeCount(), interactions: db.interactionCount() },
    oldestTelemetryAt: stats.oldest,
  };
}

// GET /api/status, /api/current, /api/health, /api/behaviour, /api/config; POST /api/refresh
export function statusRoutes(db: AppDatabase, collector: LivingCollector, startedAt: number, backend?: BackendInfo): Router {
  const r = Router();
  const snapshot = (): LivingSnapshot => ({ serverTime: Date.now(), status: serverStatus(db, collector, startedAt, backend), ...collector.snapshot() });

  r.get('/status', (_req, res) => res.json(serverStatus(db, collector, startedAt, backend)));
  // Polled every few seconds, but the state changes about once a minute: the ETag is a hash of everything
  // except serverTime, so an unchanged state answers 304 with no body (and the UI doesn't re-render)
  r.get('/current', (req, res) => {
    const { serverTime, ...state } = snapshot();
    const body = JSON.stringify(state);
    const etag = `"${createHash('sha1').update(body).digest('base64url')}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'no-cache');
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    res.type('application/json').send(`{"serverTime":${serverTime},${body.slice(1)}`);
  });

  r.get('/health', (_req, res) => {
    const s = collector.snapshot();
    res.json({ health: s.health, perception: s.perception });
  });
  r.get('/behaviour', (_req, res) => {
    const s = collector.snapshot();
    res.json({ behaviour: s.behaviour, expression: s.expression });
  });

  // Read the ESP32 now (header refresh button)
  r.post('/refresh', async (_req, res) => {
    await collector.pollNow();
    res.json(snapshot());
  });

  // Pause automatic watering detection while the soil probe is handled (calibration). {minutes: 0} resumes.
  r.post('/collector/calibration', (req, res) => {
    const minutes = req.body?.minutes === undefined ? undefined : Math.max(0, Math.min(120, Number(req.body.minutes) || 0));
    res.json({ suppressedUntil: collector.suppressWateringDetection(minutes) || null });
  });

  // Collector settings (endpoint, calibration, location, interval). The browser keeps its own copy.
  r.get('/config', (_req, res) => res.json(collector.getSettings()));
  r.put('/config', (req, res) => {
    if (!req.body || typeof req.body !== 'object') return res.status(400).json({ error: 'Expected settings object' });
    collector.updateSettings(req.body);
    res.json(collector.getSettings());
  });

  return r;
}

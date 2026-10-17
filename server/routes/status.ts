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
  const current = () => {
    const { serverTime, ...state } = snapshot();
    const body = JSON.stringify(state);
    return { etag: `"${createHash('sha1').update(body).digest('base64url')}"`, json: `{"serverTime":${serverTime},${body.slice(1)}` };
  };
  r.get('/current', (req, res) => {
    const { etag, json } = current();
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'no-cache');
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    res.type('application/json').send(json);
  });

  // The same state pushed as Server-Sent Events: sent on connect, then only when it changes (after each
  // evaluation, or found by the slow check, since status counters like petting sessions change without one).
  // The browser makes no polls and sees a new reading at once; /current stays as its fallback.
  r.get('/stream', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    let sent: string | null = null;
    // compression buffers otherwise: flush every write (its gzip dictionary spans events, so repeats cost little)
    const write = (chunk: string) => {
      res.write(chunk);
      (res as typeof res & { flush?: () => void }).flush?.();
    };
    const push = () => {
      const { etag, json } = current();
      if (etag === sent) return false;
      sent = etag;
      write(`event: state\nid: ${etag}\ndata: ${json}\n\n`);
      return true;
    };
    push();
    const unsubscribe = collector.onChange(push);
    const check = setInterval(() => push() || write(': ping\n\n'), APP_CONFIG.polling.streamCheckMs);
    req.on('close', () => {
      unsubscribe();
      clearInterval(check);
    });
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

  // The week's hike: the people choose one of the tree's two days on the calendar. {day: "2026-10-24"}
  r.post('/hike/choose', (req, res) => {
    const day = typeof req.body?.day === 'string' ? req.body.day : '';
    if (!collector.chooseHike(day)) return res.status(400).json({ error: 'That day can no longer be chosen' });
    res.json(snapshot());
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

import { Router } from 'express';
import type { HealthCondition } from '../../src/health/healthTypes';
import { normalizeTelemetryEndpoint } from '../../src/telemetry/ESP32TelemetryProvider';
import { readSoilFields } from '../../src/telemetry/telemetryNormalizer';
import type { LivingCollector } from '../collector';
import type { AppDatabase } from '../database';

interface LegacyEntry {
  t: number;
  source: string;
  soilMoisture: number;
  temperature: number | null;
  humidity: number | null;
  lightPercent: number | null;
  radiation: number | null;
}
interface LegacyWatering {
  timestamp: number;
  moistureBefore: number;
  moistureAfter: number;
  notes?: string;
}

// GET /api/telemetry/latest?limit=20 · POST /api/telemetry/test {url} · POST /api/telemetry/import-browser
export function telemetryRoutes(db: AppDatabase, collector: LivingCollector): Router {
  const r = Router();

  r.get('/latest', (req, res) => {
    const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 20));
    res.json(db.latestTelemetry(null, limit));
  });

  // Test Link from the server's side (no browser CORS / Local Network Access involved)
  r.post('/test', async (req, res) => {
    const url = normalizeTelemetryEndpoint(String(req.body?.url ?? ''));
    if (!url) return res.status(400).json({ success: false, error: 'Enter the ESP32 address', normalizedUrl: '' });
    try {
      const resp = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(4500) });
      if (!resp.ok) return res.json({ success: false, error: `HTTP ${resp.status} from ${url}`, normalizedUrl: url });
      const raw = await resp.json();
      const { apiSoilMoisture, soilRaw } = readSoilFields(raw);
      res.json({ success: true, soilMoisture: apiSoilMoisture, soilRaw, normalizedUrl: url, raw });
    } catch (err: any) {
      res.json({ success: false, error: `Server could not reach ${url}: ${err?.cause?.code ?? err?.message ?? err}`, normalizedUrl: url });
    }
  });

  // One-time move of the old browser (localStorage) history into SQLite. Live sensor readings only;
  // weather estimates were never observations. Duplicates are ignored, so it is safe to repeat.
  r.post('/import-browser', (req, res) => {
    const entries: LegacyEntry[] = Array.isArray(req.body?.entries) ? req.body.entries : [];
    const watering: LegacyWatering[] = Array.isArray(req.body?.watering) ? req.body.watering : [];
    let telemetry = 0;
    let events = 0;
    for (const e of entries) {
      if (e?.source !== 'esp32_sensor' || !Number.isFinite(e.t) || !Number.isFinite(e.soilMoisture)) continue;
      const id = db.insertTelemetry(
        {
          timestamp: e.t,
          source: 'esp32_sensor',
          deviceId: null,
          soilMoisture: e.soilMoisture,
          apiSoilMoisture: null,
          soilRaw: null,
          temperature: e.temperature ?? null,
          humidity: e.humidity ?? null,
          lightPercent: e.lightPercent ?? null,
          lightRaw: null,
          radiation: null,
          wifiRssi: null,
          dataQuality: 'imported',
        },
        { importedFrom: 'browser localStorage' }
      );
      if (id !== null) telemetry++;
    }
    for (const w of watering) {
      if (!Number.isFinite(w?.timestamp)) continue;
      const ev = db.insertEvent({
        timestamp: w.timestamp,
        type: 'watering',
        note: 'Imported from browser history',
        metadata: { source: 'sensor', moistureBefore: w.moistureBefore ?? null, moistureAfter: w.moistureAfter ?? null, conditionBefore: null as HealthCondition | null },
      });
      if (ev) events++;
    }
    if (telemetry > 0 || events > 0) collector.reloadHistory();
    res.json({ telemetry, events });
  });

  return r;
}

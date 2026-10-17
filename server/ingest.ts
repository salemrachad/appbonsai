import { APP_CONFIG } from '../src/config/appConfig';
import { DAY } from '../src/lib/time';
import type { LivingCollector } from './collector';
import type { AppDatabase } from './database';
import { authenticateDevice } from './devices';

// POST /api/ingest: the ESP32 sends its readings (protocol v1, docs/HOSTING.md).
//
//   { "v": 1, "device_id": "a1b2c3d4e5f6", "fw": "1.3.0", "boot": "7f3a9c", "uptime_ms": 8700000,
//     "readings": [ { "seq": 1042, "uptime_ms": 8640000, "soil_moisture": 46, "soil_raw": 2310, ... } ] }
//   Authorization: Bearer <device token>
//
// Each reading is the same JSON the device serves on GET /api/telemetry, plus seq and its time: uptime_ms
// (placed on the server's clock against the request's uptime_ms, so the device needs no clock) or t (ms since
// epoch, e.g. from NTP). boot changes on every start; within one boot seq only grows, so a retried request is
// dropped. The reply tells the device how often to send.

export interface IngestResult {
  status: number;
  body: { ok: true; accepted: number; errors: string[]; interval_s: number; commands: string[] } | { ok: false; error: string };
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function handleIngest(db: AppDatabase, collector: LivingCollector, req: { authorization?: string; body: unknown }, receivedAt: number): IngestResult {
  const fail = (status: number, error: string): IngestResult => ({ status, body: { ok: false, error } });
  const body = req.body as Record<string, unknown> | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'Expected a JSON object');

  const device = authenticateDevice(db, body.device_id, req.authorization);
  if (!device) return fail(401, 'Unknown device or wrong token');
  if (body.v !== 1) return fail(400, `Unsupported protocol version ${JSON.stringify(body.v)} (this server speaks v1)`);
  const readings = body.readings;
  if (!Array.isArray(readings) || readings.length === 0) return fail(400, 'readings must be a non-empty array');
  if (readings.length > APP_CONFIG.push.maxReadings) return fail(413, `At most ${APP_CONFIG.push.maxReadings} readings per request`);
  // Two collectors must never feed one tree: pushed readings are only taken when the server is set to receive them
  if (!collector.pushMode()) return fail(409, 'This server is not set to receive pushed readings (Settings → ESP32 → "The ESP32 sends its readings")');

  const boot = typeof body.boot === 'string' ? body.boot.slice(0, 64) : null;
  const sameBoot = boot !== null && boot === device.boot && device.lastSeq !== null;
  const nowUptime = finite(body.uptime_ms) ? body.uptime_ms : null;
  const skew = APP_CONFIG.push.maxClockSkewMs;
  let lastSeq = sameBoot ? device.lastSeq : null;
  const errors: string[] = [];
  const placed: { at: number; payload: unknown }[] = [];

  readings.forEach((r, i) => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return void errors.push(`reading ${i}: not an object`);
    const seq = finite(r.seq) ? r.seq : null;
    if (seq !== null) {
      if (sameBoot && seq <= device.lastSeq!) return; // already received (a retry)
      lastSeq = Math.max(lastSeq ?? seq, seq);
    }
    // When it was measured, on the server's clock
    let at: number | null = null;
    if (finite(r.uptime_ms) && nowUptime !== null && r.uptime_ms <= nowUptime) at = receivedAt - (nowUptime - r.uptime_ms);
    else if (finite(r.t) && r.t <= receivedAt + skew && r.t >= receivedAt - 7 * DAY) at = Math.min(r.t, receivedAt);
    else if (i === readings.length - 1) at = receivedAt; // the newest one, sent just now
    if (at === null) return void errors.push(`reading ${i}: no usable time (uptime_ms or t)`);
    placed.push({ at: Math.round(at), payload: r });
  });

  const result = collector.ingest(device.id, placed);
  db.touchDevice(device.id, { lastSeenAt: receivedAt, firmware: typeof body.fw === 'string' ? body.fw.slice(0, 32) : null, boot, lastSeq });
  return { status: 200, body: { ok: true, accepted: result.accepted, errors: [...errors, ...result.errors], ...collector.pushReply() } };
}

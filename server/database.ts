import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { BehaviourEpisode, HourlyBucket, Interaction, InteractionKind, PlantEvent, PlantEventType, TelemetryRecord } from '../src/history/historyTypes';
import type { HealthCondition, Severity } from '../src/health/healthTypes';
import type { OutsideObservation } from '../src/telemetry/outsideWeather';
import { MIGRATIONS, SCHEMA_SQL, SCHEMA_VERSION } from './schema';

// Thin data-access layer over node:sqlite (built into Node 22.5+, no native build step).
// Plain SQL, no ORM.

type Row = Record<string, any>;
const json = <T>(s: string | null | undefined, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};

const toTelemetry = (r: Row): TelemetryRecord => ({
  id: r.id,
  timestamp: r.timestamp,
  source: r.source,
  deviceId: r.device_id,
  soilMoisture: r.soil_moisture,
  apiSoilMoisture: r.api_soil_moisture,
  soilRaw: r.soil_raw,
  temperature: r.temperature,
  humidity: r.humidity,
  lightPercent: r.light_percent,
  lightRaw: r.light_raw,
  radiation: r.radiation,
  wifiRssi: r.wifi_rssi,
  dataQuality: r.data_quality,
});

const toEvent = (r: Row): PlantEvent => ({
  id: r.id,
  timestamp: r.timestamp,
  type: r.type,
  note: r.note,
  metadata: json(r.metadata_json, {}),
});

const toInteraction = (r: Row): Interaction => ({
  id: r.id,
  kind: r.kind,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  count: r.count,
  metadata: json(r.metadata_json, {}),
});

const toOutside = (r: Row): OutsideObservation => ({
  at: r.timestamp,
  sky: r.sky,
  code: r.code,
  temperature: r.temperature,
  humidity: r.humidity,
  precipitation: r.precipitation,
  cloudCover: r.cloud_cover,
  wind: r.wind,
  gusts: r.gusts,
  isDay: r.is_day === null ? null : r.is_day === 1,
  sunrise: r.sunrise_at ?? null,
  sunset: r.sunset_at ?? null,
});

const toEpisode = (r: Row): BehaviourEpisode => ({
  id: r.id,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  lastSeenAt: r.last_seen_at,
  unobservedMs: r.unobserved_ms ?? 0,
  condition: r.condition,
  modifiers: json(r.modifiers_json, []),
  peakSeverity: r.peak_severity,
  engineVersion: r.engine_version,
});

export class AppDatabase {
  readonly db: DatabaseSync;
  readonly path: string;

  // ':memory:' gives a throwaway database (scenario tests).
  constructor(dbPath: string) {
    const memory = dbPath === ':memory:';
    this.path = memory ? dbPath : path.resolve(dbPath);
    if (!memory) fs.mkdirSync(path.dirname(this.path), { recursive: true });
    this.db = new DatabaseSync(this.path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA_SQL);
    this.migrate();
  }

  // Bring an older database up to SCHEMA_VERSION. Each step is skipped if already applied.
  private migrate() {
    const current = this.getMeta<number>('schema_version') ?? 1;
    for (const m of MIGRATIONS) {
      // Column checks run regardless of the stored version: the version number alone can be wrong
      // (e.g. a half-applied upgrade), the actual table shape can't
      if (m.version <= current && !m.check) continue;
      const has = m.check && (this.db.prepare(`PRAGMA table_info(${m.check.table})`).all() as Row[]).some((c) => c.name === m.check!.column);
      if (!has) this.db.exec(m.sql);
    }
    this.setMeta('schema_version', SCHEMA_VERSION);
  }

  close() {
    this.db.close();
  }

  // ---- meta ----
  getMeta<T>(key: string): T | null {
    const r = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as Row | undefined;
    return r ? json<T | null>(r.value, null) : null;
  }
  setMeta(key: string, value: unknown) {
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
  }

  // ---- telemetry ----
  insertTelemetry(t: Omit<TelemetryRecord, 'id'>, rawJson: unknown): number | null {
    const res = this.db
      .prepare(
        `INSERT OR IGNORE INTO telemetry
         (timestamp, source, device_id, soil_moisture, api_soil_moisture, soil_raw, temperature, humidity,
          light_percent, light_raw, radiation, wifi_rssi, data_quality, raw_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        t.timestamp,
        t.source,
        t.deviceId,
        t.soilMoisture,
        t.apiSoilMoisture,
        t.soilRaw,
        t.temperature,
        t.humidity,
        t.lightPercent,
        t.lightRaw,
        t.radiation,
        t.wifiRssi,
        t.dataQuality,
        rawJson === undefined ? null : JSON.stringify(rawJson)
      );
    return res.changes > 0 ? Number(res.lastInsertRowid) : null;
  }

  telemetrySince(source: string | null, since: number, until = Number.MAX_SAFE_INTEGER): TelemetryRecord[] {
    const rows = source
      ? this.db.prepare('SELECT * FROM telemetry WHERE source = ? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp').all(source, since, until)
      : this.db.prepare('SELECT * FROM telemetry WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp').all(since, until);
    return (rows as Row[]).map(toTelemetry);
  }

  latestTelemetry(source: string | null, limit: number): TelemetryRecord[] {
    const rows = source
      ? this.db.prepare('SELECT * FROM telemetry WHERE source = ? ORDER BY timestamp DESC LIMIT ?').all(source, limit)
      : this.db.prepare('SELECT * FROM telemetry ORDER BY timestamp DESC LIMIT ?').all(limit);
    return (rows as Row[]).map(toTelemetry);
  }

  hourlyBuckets(source: string, since: number): HourlyBucket[] {
    const rows = this.db
      .prepare(
        `SELECT (timestamp / 3600000) * 3600000 AS hour_start, COUNT(*) AS n,
                AVG(soil_moisture) AS soil, MIN(soil_moisture) AS min_soil, AVG(temperature) AS temp,
                AVG(humidity) AS hum, AVG(COALESCE(light_percent, radiation)) AS light
         FROM telemetry WHERE source = ? AND timestamp >= ?
         GROUP BY hour_start ORDER BY hour_start`
      )
      .all(source, since) as Row[];
    const r1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);
    return rows.map((r) => ({
      hourStart: r.hour_start,
      samples: r.n,
      avgSoil: r1(r.soil),
      minSoil: r1(r.min_soil),
      avgTemp: r1(r.temp),
      avgHumidity: r1(r.hum),
      avgLight: r1(r.light),
    }));
  }

  telemetryStats(): { count: number; oldest: number | null } {
    const r = this.db.prepare('SELECT COUNT(*) AS n, MIN(timestamp) AS oldest FROM telemetry').get() as Row;
    return { count: r.n, oldest: r.oldest };
  }

  // ---- plant events ----
  insertEvent(e: { timestamp: number; type: PlantEventType; note: string | null; metadata: object }): PlantEvent | null {
    const res = this.db
      .prepare('INSERT OR IGNORE INTO plant_events (timestamp, type, note, metadata_json) VALUES (?, ?, ?, ?)')
      .run(e.timestamp, e.type, e.note, JSON.stringify(e.metadata ?? {}));
    return res.changes > 0 ? this.getEvent(Number(res.lastInsertRowid)) : null;
  }
  getEvent(id: number): PlantEvent | null {
    const r = this.db.prepare('SELECT * FROM plant_events WHERE id = ?').get(id) as Row | undefined;
    return r ? toEvent(r) : null;
  }
  updateEvent(id: number, note: string | null, metadata: object) {
    this.db.prepare('UPDATE plant_events SET note = ?, metadata_json = ? WHERE id = ?').run(note, JSON.stringify(metadata), id);
  }
  deleteEvent(id: number): boolean {
    return this.db.prepare('DELETE FROM plant_events WHERE id = ?').run(id).changes > 0;
  }
  eventsSince(since: number, limit = 1000): PlantEvent[] {
    return (this.db.prepare('SELECT * FROM plant_events WHERE timestamp >= ? ORDER BY timestamp DESC LIMIT ?').all(since, limit) as Row[]).map(toEvent);
  }
  eventCount(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM plant_events').get() as Row).n;
  }

  // ---- interactions (attention, not care) ----
  // A session that starts within mergeMs of the previous session of the same kind extends it, so a
  // restless evening of petting stays one row.
  // allowNew = false: only merging is allowed (write cap reached); returns null if a new row would be needed.
  recordInteraction(
    i: { kind: InteractionKind; startedAt: number; endedAt: number; count: number; activeMs: number },
    mergeMs: number,
    allowNew = true
  ): { interaction: Interaction; merged: boolean } | null {
    const prev = this.db
      .prepare('SELECT * FROM interactions WHERE kind = ? AND ended_at >= ? AND started_at <= ? ORDER BY ended_at DESC LIMIT 1')
      .get(i.kind, i.startedAt - mergeMs, i.endedAt) as Row | undefined;
    if (prev) {
      const meta = json<Record<string, unknown>>(prev.metadata_json, {});
      const activeMs = (Number(meta.activeMs) || 0) + i.activeMs;
      this.db
        .prepare('UPDATE interactions SET started_at = MIN(started_at, ?), ended_at = MAX(ended_at, ?), count = count + ?, metadata_json = ? WHERE id = ?')
        .run(i.startedAt, i.endedAt, i.count, JSON.stringify({ ...meta, activeMs }), prev.id);
      return { interaction: toInteraction(this.db.prepare('SELECT * FROM interactions WHERE id = ?').get(prev.id) as Row), merged: true };
    }
    if (!allowNew) return null;
    const res = this.db
      .prepare('INSERT INTO interactions (kind, started_at, ended_at, count, metadata_json) VALUES (?, ?, ?, ?, ?)')
      .run(i.kind, i.startedAt, i.endedAt, i.count, JSON.stringify({ activeMs: i.activeMs }));
    return { interaction: toInteraction(this.db.prepare('SELECT * FROM interactions WHERE id = ?').get(Number(res.lastInsertRowid)) as Row), merged: false };
  }
  interactionsSince(since: number, kind?: InteractionKind): Interaction[] {
    const rows = kind
      ? this.db.prepare('SELECT * FROM interactions WHERE kind = ? AND ended_at >= ? ORDER BY started_at DESC').all(kind, since)
      : this.db.prepare('SELECT * FROM interactions WHERE ended_at >= ? ORDER BY started_at DESC').all(since);
    return (rows as Row[]).map(toInteraction);
  }
  interactionCount(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM interactions').get() as Row).n;
  }

  // ---- outside weather (context only) ----
  insertOutsideWeather(o: OutsideObservation, raw: unknown) {
    this.db
      .prepare(
        'INSERT INTO outside_weather (timestamp, sky, code, temperature, humidity, precipitation, cloud_cover, wind, gusts, is_day, sunrise_at, sunset_at, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(o.at, o.sky, o.code, o.temperature, o.humidity, o.precipitation, o.cloudCover, o.wind, o.gusts, o.isDay === null ? null : o.isDay ? 1 : 0, o.sunrise ?? null, o.sunset ?? null, raw === undefined ? null : JSON.stringify(raw));
  }
  latestOutsideWeather(): OutsideObservation | null {
    const r = this.db.prepare('SELECT * FROM outside_weather ORDER BY timestamp DESC LIMIT 1').get() as Row | undefined;
    return r ? toOutside(r) : null;
  }
  outsideWeatherSince(since: number): OutsideObservation[] {
    return (this.db.prepare('SELECT * FROM outside_weather WHERE timestamp >= ? ORDER BY timestamp ASC').all(since) as Row[]).map(toOutside);
  }

  // ---- calibration history ----
  insertCalibrationHistory(e: { timestamp: number; sensor: string; old: unknown; next: unknown; note: string | null }) {
    this.db
      .prepare('INSERT INTO calibration_history (timestamp, sensor, old_json, new_json, note) VALUES (?, ?, ?, ?, ?)')
      .run(e.timestamp, e.sensor, e.old == null ? null : JSON.stringify(e.old), e.next == null ? null : JSON.stringify(e.next), e.note);
  }
  calibrationHistory(limit = 20): { id: number; timestamp: number; sensor: string; old: unknown; next: unknown; note: string | null }[] {
    return (this.db.prepare('SELECT * FROM calibration_history ORDER BY timestamp DESC, id DESC LIMIT ?').all(limit) as Row[]).map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      sensor: r.sensor,
      old: json(r.old_json, null),
      next: json(r.new_json, null),
      note: r.note,
    }));
  }

  // ---- behaviour episodes ----
  openEpisode(): BehaviourEpisode | null {
    const r = this.db.prepare('SELECT * FROM behaviour_episodes WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1').get() as Row | undefined;
    return r ? toEpisode(r) : null;
  }
  insertEpisode(e: { startedAt: number; condition: HealthCondition; modifiers: HealthCondition[]; peakSeverity: Severity; engineVersion: string }): BehaviourEpisode {
    const res = this.db
      .prepare(
        'INSERT INTO behaviour_episodes (started_at, ended_at, last_seen_at, condition, modifiers_json, peak_severity, engine_version) VALUES (?, NULL, ?, ?, ?, ?, ?)'
      )
      .run(e.startedAt, e.startedAt, e.condition, JSON.stringify(e.modifiers), e.peakSeverity, e.engineVersion);
    return toEpisode(this.db.prepare('SELECT * FROM behaviour_episodes WHERE id = ?').get(Number(res.lastInsertRowid)) as Row);
  }
  touchEpisode(id: number, lastSeenAt: number, modifiers: HealthCondition[], peakSeverity: Severity, addUnobservedMs = 0) {
    this.db
      .prepare('UPDATE behaviour_episodes SET last_seen_at = ?, modifiers_json = ?, peak_severity = ?, unobserved_ms = unobserved_ms + ? WHERE id = ?')
      .run(lastSeenAt, JSON.stringify(modifiers), peakSeverity, Math.round(addUnobservedMs), id);
  }
  deleteEpisode(id: number) {
    this.db.prepare('DELETE FROM behaviour_episodes WHERE id = ?').run(id);
  }
  reopenEpisode(id: number) {
    this.db.prepare('UPDATE behaviour_episodes SET ended_at = NULL WHERE id = ?').run(id);
  }
  lastClosedEpisode(): BehaviourEpisode | null {
    const r = this.db.prepare('SELECT * FROM behaviour_episodes WHERE ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT 1').get() as Row | undefined;
    return r ? toEpisode(r) : null;
  }
  closeEpisode(id: number, endedAt: number) {
    this.db.prepare('UPDATE behaviour_episodes SET ended_at = ?, last_seen_at = MAX(last_seen_at, ?) WHERE id = ?').run(endedAt, endedAt, id);
  }
  episodesSince(since: number): BehaviourEpisode[] {
    return (
      this.db
        .prepare('SELECT * FROM behaviour_episodes WHERE COALESCE(ended_at, last_seen_at) >= ? ORDER BY started_at DESC')
        .all(since) as Row[]
    ).map(toEpisode);
  }
  episodeCount(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM behaviour_episodes').get() as Row).n;
  }
}

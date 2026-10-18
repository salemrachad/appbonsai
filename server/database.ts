import type { BehaviourEpisode, HourlyBucket, Interaction, InteractionKind, PlantEvent, PlantEventType, TelemetryRecord } from '../src/history/historyTypes';
import type { HealthCondition, Severity } from '../src/health/healthTypes';
import type { OutsideObservation } from '../src/telemetry/outsideWeather';
import { MIGRATIONS, SCHEMA_SQL, SCHEMA_VERSION } from './schema';

// Thin data-access layer: plain SQLite SQL, no ORM, over a driver. On the laptop the driver is node:sqlite
// (nodeSqlite.ts); in a Cloudflare Durable Object it will be the object's own SQLite (ctx.storage.sql), which
// is also synchronous. So nothing here may import a Node module, and the SQL sticks to what both run:
// RETURNING instead of the driver's changes / lastInsertRowid, no transactions, no PRAGMA except table_info.

export type Row = Record<string, any>;
export type SqlValue = null | number | bigint | string;

export interface SqlDriver {
  readonly path: string; // where the data lives, for status pages
  exec(sql: string): void; // several statements, no parameters (the schema)
  all(sql: string, ...params: SqlValue[]): Row[]; // one statement; writes return their RETURNING rows
  transaction<T>(fn: () => T): T; // all or nothing (a restore)
  close(): void;
}

// A whole tree's data, to move it to another server (scripts/cloudMigrate.ts → POST /api/admin/restore).
// The tree's own id stays with the server it lands on; its devices are moved to that tree.
export const DUMP_TABLES = ['telemetry', 'plant_events', 'behaviour_episodes', 'calibration_history', 'interactions', 'outside_weather', 'devices'] as const;
export interface DatabaseDump {
  schemaVersion: number;
  tables: Record<(typeof DUMP_TABLES)[number], Row[]>;
  meta: Record<string, unknown>; // every key but schema_version, values as stored (parsed JSON)
}

export function dumpDatabase(sql: SqlDriver): DatabaseDump {
  const tables = Object.fromEntries(DUMP_TABLES.map((t) => [t, sql.all(`SELECT * FROM ${t} ORDER BY rowid`)])) as DatabaseDump['tables'];
  const meta = Object.fromEntries(sql.all("SELECT key, value FROM meta WHERE key <> 'schema_version'").map((r) => [r.key, json(r.value, null)]));
  const version = sql.all("SELECT value FROM meta WHERE key = 'schema_version'")[0];
  return { schemaVersion: version ? Number(json(version.value, 0)) : 0, tables, meta };
}

export interface TreeRecord {
  id: string;
  createdAt: number;
}
const json = <T>(s: string | null | undefined, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};

// Everything but raw_json (stored for re-evaluation, never read back here): decoding it was a large share of each query
const TELEMETRY_COLUMNS =
  'id, timestamp, source, device_id, soil_moisture, api_soil_moisture, soil_raw, temperature, humidity, light_percent, light_raw, radiation, wifi_rssi, data_quality';
const OUTSIDE_COLUMNS = 'timestamp, sky, code, temperature, humidity, precipitation, cloud_cover, wind, gusts, is_day, sunrise_at, sunset_at';

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

export interface DeviceRecord {
  id: string;
  treeId: string | null; // the tree it measures (a replaced device keeps the tree's history)
  tokenHash: string;
  label: string | null;
  createdAt: number;
  lastSeenAt: number | null;
  firmware: string | null;
  boot: string | null;
  lastSeq: number | null;
}

const toDevice = (r: Row): DeviceRecord => ({
  id: r.id,
  treeId: r.tree_id ?? null,
  tokenHash: r.token_hash,
  label: r.label,
  createdAt: r.created_at,
  lastSeenAt: r.last_seen_at,
  firmware: r.firmware,
  boot: r.boot,
  lastSeq: r.last_seq,
});

export class AppDatabase {
  constructor(private sql: SqlDriver) {
    sql.exec(SCHEMA_SQL);
    this.migrate();
    this.ensureTree();
  }

  get path(): string {
    return this.sql.path;
  }

  private all(sql: string, ...params: SqlValue[]): Row[] {
    return this.sql.all(sql, ...params);
  }
  private get(sql: string, ...params: SqlValue[]): Row | undefined {
    return this.sql.all(sql, ...params)[0];
  }

  // Bring an older database up to SCHEMA_VERSION. Each step is skipped if already applied.
  private migrate() {
    const current = this.getMeta<number>('schema_version') ?? 1;
    for (const m of MIGRATIONS) {
      // Column checks run regardless of the stored version: the version number alone can be wrong
      // (e.g. a half-applied upgrade), the actual table shape can't
      if (m.version <= current && !m.check) continue;
      const has = m.check && this.all(`PRAGMA table_info(${m.check.table})`).some((c) => c.name === m.check!.column);
      if (!has) this.sql.exec(m.sql);
    }
    this.setMeta('schema_version', SCHEMA_VERSION);
  }

  // A database holds one tree (later: one Durable Object per tree). It gets its id when the database is made;
  // devices from before trees existed belong to it.
  private ensureTree() {
    if (!this.get('SELECT id FROM trees LIMIT 1')) this.all('INSERT INTO trees (id, created_at) VALUES (?, ?)', `tree_${crypto.randomUUID()}`, Date.now());
    this.all('UPDATE devices SET tree_id = (SELECT id FROM trees ORDER BY created_at LIMIT 1) WHERE tree_id IS NULL');
  }

  close() {
    this.sql.close();
  }

  // ---- moving a tree between servers ----
  dump(): DatabaseDump {
    return dumpDatabase(this.sql);
  }

  // Replace everything with a dump (all or nothing). Rows keep their ids (the saved runtime and state refer to
  // events and episodes by id). Columns are checked against the actual tables. The collector must be rebuilt.
  restore(dump: DatabaseDump): Record<string, number> {
    if (dump.schemaVersion !== SCHEMA_VERSION) throw new Error(`The dump is schema v${dump.schemaVersion}, this server v${SCHEMA_VERSION}`);
    const treeId = this.tree().id;
    const counts: Record<string, number> = {};
    this.sql.transaction(() => {
      for (const table of DUMP_TABLES) {
        this.all(`DELETE FROM ${table}`);
        const rows = dump.tables[table] ?? [];
        for (const row of rows) this.insertRow(table, table === 'devices' ? { ...row, tree_id: treeId } : row, 'INSERT');
        counts[table] = rows.length;
      }
      this.all("DELETE FROM meta WHERE key <> 'schema_version'");
      for (const [key, value] of Object.entries(dump.meta)) if (key !== 'schema_version') this.setMeta(key, value);
      counts.meta = Object.keys(dump.meta).length;
    });
    return counts;
  }

  // Readings from another server's dump that this one doesn't have yet (the minutes between a restore and the
  // device's switch). Stored as history, without their ids; the same reading twice is ignored.
  topUpTelemetry(rows: Row[]): number {
    let added = 0;
    this.sql.transaction(() => {
      for (const { id: _id, ...row } of rows) added += this.insertRow('telemetry', row, 'INSERT OR IGNORE');
    });
    return added;
  }

  private columns = new Map<string, Set<string>>();
  private insertRow(table: string, row: Row, verb: 'INSERT' | 'INSERT OR IGNORE'): number {
    let known = this.columns.get(table);
    if (!known) this.columns.set(table, (known = new Set(this.all(`PRAGMA table_info(${table})`).map((c) => c.name as string))));
    const cols = Object.keys(row).filter((c) => known.has(c));
    const values = cols.map((c) => {
      const v = row[c];
      if (v === null || typeof v === 'number' || typeof v === 'string') return v as SqlValue;
      throw new Error(`${table}.${c}: not a plain value`);
    });
    return this.all(`${verb} INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) RETURNING rowid`, ...values).length;
  }

  // ---- the tree (its name, species and location are its settings, in meta) ----
  tree(): TreeRecord {
    const r = this.get('SELECT id, created_at FROM trees ORDER BY created_at LIMIT 1')!;
    return { id: r.id, createdAt: r.created_at };
  }

  // ---- meta ----
  getMeta<T>(key: string): T | null {
    const r = this.get('SELECT value FROM meta WHERE key = ?', key);
    return r ? json<T | null>(r.value, null) : null;
  }
  setMeta(key: string, value: unknown) {
    this.all('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
  }

  // ---- telemetry ----
  insertTelemetry(t: Omit<TelemetryRecord, 'id'>, rawJson: unknown): number | null {
    const r = this.get(
        `INSERT OR IGNORE INTO telemetry
         (timestamp, source, device_id, soil_moisture, api_soil_moisture, soil_raw, temperature, humidity,
          light_percent, light_raw, radiation, wifi_rssi, data_quality, raw_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
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
    return r ? Number(r.id) : null;
  }

  telemetrySince(source: string | null, since: number, until = Number.MAX_SAFE_INTEGER): TelemetryRecord[] {
    const rows = source
      ? this.all(`SELECT ${TELEMETRY_COLUMNS} FROM telemetry WHERE source = ? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp`, source, since, until)
      : this.all(`SELECT ${TELEMETRY_COLUMNS} FROM telemetry WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp`, since, until);
    return rows.map(toTelemetry);
  }

  latestTelemetry(source: string | null, limit: number): TelemetryRecord[] {
    const rows = source
      ? this.all(`SELECT ${TELEMETRY_COLUMNS} FROM telemetry WHERE source = ? ORDER BY timestamp DESC LIMIT ?`, source, limit)
      : this.all(`SELECT ${TELEMETRY_COLUMNS} FROM telemetry ORDER BY timestamp DESC LIMIT ?`, limit);
    return rows.map(toTelemetry);
  }

  hourlyBuckets(source: string, since: number): HourlyBucket[] {
    const rows = this.all(
        `SELECT (timestamp / 3600000) * 3600000 AS hour_start, COUNT(*) AS n,
                AVG(soil_moisture) AS soil, MIN(soil_moisture) AS min_soil, AVG(temperature) AS temp,
                AVG(humidity) AS hum, AVG(COALESCE(light_percent, radiation)) AS light
         FROM telemetry WHERE source = ? AND timestamp >= ?
         GROUP BY hour_start ORDER BY hour_start`,
        source,
        since
      );
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
    const r = this.get('SELECT COUNT(*) AS n, MIN(timestamp) AS oldest FROM telemetry')!;
    return { count: r.n, oldest: r.oldest };
  }

  // ---- plant events ----
  insertEvent(e: { timestamp: number; type: PlantEventType; note: string | null; metadata: object }): PlantEvent | null {
    const r = this.get('INSERT OR IGNORE INTO plant_events (timestamp, type, note, metadata_json) VALUES (?, ?, ?, ?) RETURNING *', e.timestamp, e.type, e.note, JSON.stringify(e.metadata ?? {}));
    return r ? toEvent(r) : null;
  }
  getEvent(id: number): PlantEvent | null {
    const r = this.get('SELECT * FROM plant_events WHERE id = ?', id);
    return r ? toEvent(r) : null;
  }
  updateEvent(id: number, note: string | null, metadata: object) {
    this.all('UPDATE plant_events SET note = ?, metadata_json = ? WHERE id = ?', note, JSON.stringify(metadata), id);
  }
  deleteEvent(id: number): boolean {
    return this.all('DELETE FROM plant_events WHERE id = ? RETURNING id', id).length > 0;
  }
  eventsSince(since: number, limit = 1000): PlantEvent[] {
    return this.all('SELECT * FROM plant_events WHERE timestamp >= ? ORDER BY timestamp DESC LIMIT ?', since, limit).map(toEvent);
  }
  eventCount(): number {
    return this.get('SELECT COUNT(*) AS n FROM plant_events')!.n;
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
    const prev = this.get('SELECT * FROM interactions WHERE kind = ? AND ended_at >= ? AND started_at <= ? ORDER BY ended_at DESC LIMIT 1', i.kind, i.startedAt - mergeMs, i.endedAt);
    if (prev) {
      const meta = json<Record<string, unknown>>(prev.metadata_json, {});
      const activeMs = (Number(meta.activeMs) || 0) + i.activeMs;
      const r = this.get(
        'UPDATE interactions SET started_at = MIN(started_at, ?), ended_at = MAX(ended_at, ?), count = count + ?, metadata_json = ? WHERE id = ? RETURNING *',
        i.startedAt,
        i.endedAt,
        i.count,
        JSON.stringify({ ...meta, activeMs }),
        prev.id
      )!;
      return { interaction: toInteraction(r), merged: true };
    }
    if (!allowNew) return null;
    const r = this.get('INSERT INTO interactions (kind, started_at, ended_at, count, metadata_json) VALUES (?, ?, ?, ?, ?) RETURNING *', i.kind, i.startedAt, i.endedAt, i.count, JSON.stringify({ activeMs: i.activeMs }))!;
    return { interaction: toInteraction(r), merged: false };
  }
  interactionsSince(since: number, kind?: InteractionKind): Interaction[] {
    const rows = kind
      ? this.all('SELECT * FROM interactions WHERE kind = ? AND ended_at >= ? ORDER BY started_at DESC', kind, since)
      : this.all('SELECT * FROM interactions WHERE ended_at >= ? ORDER BY started_at DESC', since);
    return rows.map(toInteraction);
  }
  interactionCount(): number {
    return this.get('SELECT COUNT(*) AS n FROM interactions')!.n;
  }

  // ---- outside weather (context only) ----
  insertOutsideWeather(o: OutsideObservation, raw: unknown) {
    this.all(
      'INSERT INTO outside_weather (timestamp, sky, code, temperature, humidity, precipitation, cloud_cover, wind, gusts, is_day, sunrise_at, sunset_at, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      o.at, o.sky, o.code, o.temperature, o.humidity, o.precipitation, o.cloudCover, o.wind, o.gusts, o.isDay === null ? null : o.isDay ? 1 : 0, o.sunrise ?? null, o.sunset ?? null, raw === undefined ? null : JSON.stringify(raw)
    );
  }
  latestOutsideWeather(): OutsideObservation | null {
    const r = this.get(`SELECT ${OUTSIDE_COLUMNS} FROM outside_weather ORDER BY timestamp DESC LIMIT 1`);
    return r ? toOutside(r) : null;
  }
  outsideWeatherSince(since: number): OutsideObservation[] {
    return this.all(`SELECT ${OUTSIDE_COLUMNS} FROM outside_weather WHERE timestamp >= ? ORDER BY timestamp ASC`, since).map(toOutside);
  }

  // ---- calibration history ----
  insertCalibrationHistory(e: { timestamp: number; sensor: string; old: unknown; next: unknown; note: string | null }) {
    this.all(
      'INSERT INTO calibration_history (timestamp, sensor, old_json, new_json, note) VALUES (?, ?, ?, ?, ?)',
      e.timestamp, e.sensor, e.old == null ? null : JSON.stringify(e.old), e.next == null ? null : JSON.stringify(e.next), e.note
    );
  }
  calibrationHistory(limit = 20): { id: number; timestamp: number; sensor: string; old: unknown; next: unknown; note: string | null }[] {
    return this.all('SELECT * FROM calibration_history ORDER BY timestamp DESC, id DESC LIMIT ?', limit).map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      sensor: r.sensor,
      old: json(r.old_json, null),
      next: json(r.new_json, null),
      note: r.note,
    }));
  }

  // ---- devices (ESP32s that push) ----
  insertDevice(d: { id: string; treeId: string; tokenHash: string; label: string | null; createdAt: number }): boolean {
    return this.all('INSERT OR IGNORE INTO devices (id, tree_id, token_hash, label, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id', d.id, d.treeId, d.tokenHash, d.label, d.createdAt).length > 0;
  }
  getDevice(id: string): DeviceRecord | null {
    const r = this.get('SELECT * FROM devices WHERE id = ?', id);
    return r ? toDevice(r) : null;
  }
  devices(): DeviceRecord[] {
    return this.all('SELECT * FROM devices ORDER BY created_at').map(toDevice);
  }
  touchDevice(id: string, d: { lastSeenAt: number; firmware: string | null; boot: string | null; lastSeq: number | null }) {
    this.all('UPDATE devices SET last_seen_at = ?, firmware = COALESCE(?, firmware), boot = ?, last_seq = ? WHERE id = ?', d.lastSeenAt, d.firmware, d.boot, d.lastSeq, id);
  }
  setDeviceToken(id: string, tokenHash: string): boolean {
    return this.all('UPDATE devices SET token_hash = ?, boot = NULL, last_seq = NULL WHERE id = ? RETURNING id', tokenHash, id).length > 0;
  }
  deleteDevice(id: string): boolean {
    return this.all('DELETE FROM devices WHERE id = ? RETURNING id', id).length > 0;
  }

  // ---- behaviour episodes ----
  openEpisode(): BehaviourEpisode | null {
    const r = this.get('SELECT * FROM behaviour_episodes WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1');
    return r ? toEpisode(r) : null;
  }
  insertEpisode(e: { startedAt: number; condition: HealthCondition; modifiers: HealthCondition[]; peakSeverity: Severity; engineVersion: string }): BehaviourEpisode {
    const r = this.get(
      'INSERT INTO behaviour_episodes (started_at, ended_at, last_seen_at, condition, modifiers_json, peak_severity, engine_version) VALUES (?, NULL, ?, ?, ?, ?, ?) RETURNING *',
      e.startedAt, e.startedAt, e.condition, JSON.stringify(e.modifiers), e.peakSeverity, e.engineVersion
    )!;
    return toEpisode(r);
  }
  touchEpisode(id: number, lastSeenAt: number, modifiers: HealthCondition[], peakSeverity: Severity, addUnobservedMs = 0) {
    this.all(
      'UPDATE behaviour_episodes SET last_seen_at = ?, modifiers_json = ?, peak_severity = ?, unobserved_ms = unobserved_ms + ? WHERE id = ?',
      lastSeenAt, JSON.stringify(modifiers), peakSeverity, Math.round(addUnobservedMs), id
    );
  }
  deleteEpisode(id: number) {
    this.all('DELETE FROM behaviour_episodes WHERE id = ?', id);
  }
  reopenEpisode(id: number) {
    this.all('UPDATE behaviour_episodes SET ended_at = NULL WHERE id = ?', id);
  }
  lastClosedEpisode(): BehaviourEpisode | null {
    const r = this.get('SELECT * FROM behaviour_episodes WHERE ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT 1');
    return r ? toEpisode(r) : null;
  }
  closeEpisode(id: number, endedAt: number) {
    this.all('UPDATE behaviour_episodes SET ended_at = ?, last_seen_at = MAX(last_seen_at, ?) WHERE id = ?', endedAt, endedAt, id);
  }
  episodesSince(since: number): BehaviourEpisode[] {
    return this.all('SELECT * FROM behaviour_episodes WHERE COALESCE(ended_at, last_seen_at) >= ? ORDER BY started_at DESC', since).map(toEpisode);
  }
  episodeCount(): number {
    return this.get('SELECT COUNT(*) AS n FROM behaviour_episodes')!.n;
  }
}

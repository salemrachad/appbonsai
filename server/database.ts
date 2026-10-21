import type { BehaviourEpisode, HourlyBucket, Interaction, InteractionKind, PlantEvent, PlantEventType, TelemetryRecord } from '../src/history/historyTypes';
import type { HealthCondition, Severity } from '../src/health/healthTypes';
import type { OutsideObservation } from '../src/telemetry/outsideWeather';
import type { DreamOutcome, DreamRecord } from '../src/behaviour/behaviourTypes';
import type { PhotoAnalysis, PhotoRecord, Roi } from '../src/vision/visionTypes';
import { MIGRATIONS, SCHEMA_SQL, SCHEMA_VERSION } from './schema';

// Thin data-access layer: plain SQLite SQL, no ORM, over a driver. On the laptop the driver is node:sqlite
// (nodeSqlite.ts); in a Cloudflare Durable Object it will be the object's own SQLite (ctx.storage.sql), which
// is also synchronous. So nothing here may import a Node module, and the SQL sticks to what both run:
// RETURNING instead of the driver's changes / lastInsertRowid, transactions only through the driver (no BEGIN),
// no PRAGMA except table_info.

export type Row = Record<string, any>;
export type SqlValue = null | number | bigint | string;

export interface SqlDriver {
  readonly path: string; // where the data lives, for status pages
  exec(sql: string): void; // several statements, no parameters (the schema)
  all(sql: string, ...params: SqlValue[]): Row[]; // one statement; writes return their RETURNING rows
  transaction<T>(fn: () => T): T; // all or nothing (a restore)
  close(): void;
  // Rows read so far by this driver, as the storage counts them (a Durable Object bills rows read; node:sqlite
  // can't tell, so it counts the rows returned). Absent: unknown.
  rowsRead?(): number;
}

// A whole tree's data, to move it to another server (scripts/cloudMigrate.ts → POST /api/admin/restore).
// The tree's own id stays with the server it lands on; its devices are moved to that tree.
// (photos: their rows; the images stay in the photo store, which npm run cf:backup copies on its own)
export const DUMP_TABLES = ['telemetry', 'plant_events', 'behaviour_episodes', 'calibration_history', 'interactions', 'outside_weather', 'devices', 'utterances', 'dreams', 'photos'] as const;
export interface DatabaseDump {
  schemaVersion: number;
  tables: Record<(typeof DUMP_TABLES)[number], Row[]>;
  meta: Record<string, unknown>; // every key but schema_version, values as stored (parsed JSON)
}

// The tables that grow all the time. A nightly backup (server/backup.ts) takes only their rows added since the
// last one (not dreams: a night's row is updated at dawn, so it is taken whole, a row a night) (by id, so a reading stored late, e.g. from the device's buffer, is still caught), the rest whole.
export const GROWING_TABLES = ['telemetry', 'outside_weather', 'utterances'] as const;
export type BackupCursor = Record<(typeof GROWING_TABLES)[number], number>; // the highest id already backed up

// after: only the growing tables' rows with a higher id (a nightly backup); without it, everything
export function dumpDatabase(sql: SqlDriver, after?: BackupCursor): DatabaseDump {
  const rows = (t: (typeof DUMP_TABLES)[number]) =>
    after && t in after ? sql.all(`SELECT * FROM ${t} WHERE id > ? ORDER BY id`, after[t as keyof BackupCursor]) : sql.all(`SELECT * FROM ${t} ORDER BY rowid`);
  const tables = Object.fromEntries(DUMP_TABLES.map((t) => [t, rows(t)])) as DatabaseDump['tables'];
  // Not the schema version (the target has its own) nor where this server's backups stand (server/backup.ts)
  const meta = Object.fromEntries(sql.all("SELECT key, value FROM meta WHERE key NOT IN ('schema_version', 'backup_state')").map((r) => [r.key, json(r.value, null)]));
  const version = sql.all("SELECT value FROM meta WHERE key = 'schema_version'")[0];
  return { schemaVersion: version ? Number(json(version.value, 0)) : 0, tables, meta };
}

export type UtteranceKind = 'state' | 'day_line' | 'care_line' | 'musing' | 'observation';
export interface Utterance {
  id: number;
  at: number;
  key: string;
  kind: UtteranceKind;
  text: string;
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
const OUTSIDE_COLUMNS = 'timestamp, sky, code, temperature, humidity, precipitation, cloud_cover, wind, gusts, is_day, sunrise_at, sunset_at, pressure, aqi, pm25, pm10';

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
  // Beyond the sky: only when known (older rows have none)
  ...(r.pressure != null && { pressure: r.pressure }),
  ...(r.aqi != null && { aqi: r.aqi, pm25: r.pm25 ?? null, pm10: r.pm10 ?? null }),
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

// A photo row with where its image is kept (the API leaves the key out)
export type StoredPhoto = PhotoRecord & { imageKey: string; bytes: number };

const toPhoto = (r: Row): StoredPhoto => ({
  id: r.id,
  takenAt: r.taken_at,
  uploadedAt: r.uploaded_at,
  imageKey: r.image_key,
  width: r.width,
  height: r.height,
  bytes: r.bytes,
  isReference: r.is_reference === 1,
  roi: json<Roi | null>(r.roi_json, null),
  analysis: json<PhotoAnalysis | null>(r.analysis_json, null),
  note: r.note ?? null,
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

// The tables whose row counts the status shows (telemetry's is kept with its oldest reading)
const COUNTED = ['plant_events', 'interactions', 'behaviour_episodes'];

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
    const rows = this.sql.all(sql, ...params);
    this.forgetCounts(sql);
    return rows;
  }
  private get(sql: string, ...params: SqlValue[]): Row | undefined {
    return this.all(sql, ...params)[0];
  }

  // Counts for the status page: a COUNT(*) reads every row of its table, and the status is asked every few
  // seconds (a Durable Object's SQLite bills each row read). A row inserted or deleted drops the count, so it is
  // read again once, exactly. Telemetry's count follows each new reading instead.
  // They are also kept in meta (`table_counts`, one row): a Durable Object is unloaded between requests (with
  // readings every few minutes, it loads again for each one), and counting the whole telemetry table on every
  // load read more rows each day than the free tier allows (2026-10-19). A load reads that one row instead.
  private counts = new Map<string, number>();
  // Bumped when a restore or a top-up rewrites history: caches of past rows start over
  dataVersion = 0;
  private telemetryCache: { count: number; oldest: number | null } | null = null;
  private countsLoaded = false;
  private loadCounts() {
    if (this.countsLoaded) return;
    this.countsLoaded = true;
    const stored = this.getMeta<Record<string, number | null>>('table_counts') ?? {};
    for (const [k, v] of Object.entries(stored)) if (COUNTED.includes(k) && typeof v === 'number') this.counts.set(k, v);
    if (typeof stored.telemetry === 'number') this.telemetryCache = { count: stored.telemetry, oldest: stored.telemetry_oldest ?? null };
  }
  private saveCounts() {
    const o: Record<string, number | null> = Object.fromEntries(this.counts);
    if (this.telemetryCache) Object.assign(o, { telemetry: this.telemetryCache.count, telemetry_oldest: this.telemetryCache.oldest });
    this.setMeta('table_counts', o);
  }
  private forgetCounts(sql: string) {
    const w = sql.match(/^\s*(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE|DELETE\s+FROM)\s+(\w+)/i);
    if (w) this.windows.delete(w[1]); // a cached window of this table is stale (see windowOf)
    const m = /^\s*(INSERT|DELETE)\b/i.test(sql) ? sql.match(/\b(?:INTO|FROM)\s+(\w+)/i) : null;
    if (!m || !(COUNTED.includes(m[1]) || (m[1] === 'telemetry' && !this.countingTelemetry))) return;
    this.loadCounts(); // the stored count must drop too, not only the one in memory
    this.counts.delete(m[1]);
    if (m[1] === 'telemetry') this.telemetryCache = null;
    this.saveCounts();
  }
  private countingTelemetry = false;

  // Recent rows of tables that change rarely (care events, petting sessions), read every poll and with every
  // state snapshot (the stream asks every 15 s): kept as one window per table, read again after any write to it.
  // Same rows, same order as the query each time (the window is that query's result, filtered).
  private windows = new Map<string, { start: number; rows: Row[] }>();
  private windowOf(table: string, since: number, query: string | ((since: number) => Row[])): Row[] {
    let w = this.windows.get(table);
    if (!w || since < w.start) this.windows.set(table, (w = { start: since, rows: typeof query === 'string' ? this.sql.all(query, since) : query(since) }));
    return w.rows;
  }

  // The episodes of the last weeks, read every poll and with every snapshot: kept in memory and changed in step
  // with each write below (the open episode is touched every minute), so they are read from the table once.
  // A write to an episode outside the window drops it (read again next time). Always the query's rows and order.
  private episodeWindow: { start: number; rows: BehaviourEpisode[] } | null = null;
  private patchEpisode(id: number, change: (e: BehaviourEpisode) => void) {
    const e = this.episodeWindow?.rows.find((x) => x.id === id);
    if (e) change(e);
    else this.episodeWindow = null;
  }
  private countOf(table: string): number {
    this.loadCounts();
    let n = this.counts.get(table);
    if (n === undefined) {
      this.counts.set(table, (n = Number(this.sql.all(`SELECT COUNT(*) AS n FROM ${table}`)[0].n)));
      this.saveCounts();
    }
    return n;
  }
  // Rows read by the database so far (see SqlDriver.rowsRead), null when the driver can't tell
  rowsRead(): number | null {
    return this.sql.rowsRead ? this.sql.rowsRead() : null;
  }
  // Rows read since this database was opened, and since the UTC day began (a Durable Object's free tier allows
  // 5 M a day). A warning in the log once a day past 3 M.
  private readDay: { day: number; base: number; warned: boolean } | null = null;
  readStats(now: number): { sinceStart: number; today: number } | null {
    const total = this.rowsRead();
    if (total === null) return null;
    const day = Math.floor(now / 86_400_000);
    if (!this.readDay || this.readDay.day !== day) this.readDay = { day, base: this.readDay ? total : 0, warned: false };
    const today = total - this.readDay.base;
    if (today > 3_000_000 && !this.readDay.warned) {
      this.readDay.warned = true;
      console.warn(`[database] ${today} rows read today (the Durable Objects free tier allows 5 M a day)`);
    }
    return { sinceStart: total, today };
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

  // All or nothing; on a failure (rolled back) `undo` forgets what memory believed was written
  private transaction(fn: () => void, undo: () => void) {
    try {
      this.sql.transaction(fn);
    } catch (err) {
      undo();
      throw err;
    }
  }

  // ---- moving a tree between servers ----
  dump(after?: BackupCursor): DatabaseDump {
    return dumpDatabase(this.sql, after);
  }

  // Replace everything with a dump (all or nothing). Rows keep their ids (the saved runtime and state refer to
  // events and episodes by id). Columns are checked against the actual tables. The collector must be rebuilt.
  restore(dump: DatabaseDump): Record<string, number> {
    if (dump.schemaVersion !== SCHEMA_VERSION) throw new Error(`The dump is schema v${dump.schemaVersion}, this server v${SCHEMA_VERSION}`);
    const treeId = this.tree().id;
    const counts: Record<string, number> = {};
    this.transaction(() => {
      for (const table of DUMP_TABLES) {
        this.all(`DELETE FROM ${table}`);
        const rows = dump.tables[table] ?? [];
        for (const row of rows) this.insertRow(table, table === 'devices' ? { ...row, tree_id: treeId } : row, 'INSERT');
        counts[table] = rows.length;
      }
      // backup_state goes too: the data changed under the backup series, so the next backup starts a new series
      // with a complete one (server/backup.ts)
      this.all("DELETE FROM meta WHERE key <> 'schema_version'");
      this.metaSeen.clear();
      // (and not the other server's counts: they are counted here again, once)
      for (const [key, value] of Object.entries(dump.meta)) if (key !== 'schema_version' && key !== 'backup_state' && key !== 'table_counts') this.setMeta(key, value);
      counts.meta = Object.keys(dump.meta).length;
    }, () => this.metaSeen.clear());
    this.counts.clear();
    this.windows.clear();
    this.episodeWindow = null;
    this.telemetryCache = null;
    this.countsLoaded = true;
    this.saveCounts();
    this.dataVersion++;
    return counts;
  }

  // Readings from another server's dump that this one doesn't have yet (the minutes between a restore and the
  // device's switch). Stored as history, without their ids; the same reading twice is ignored.
  topUpTelemetry(rows: Row[]): number {
    let added = 0;
    this.sql.transaction(() => {
      for (const { id: _id, ...row } of rows) added += this.insertRow('telemetry', row, 'INSERT OR IGNORE');
    });
    this.loadCounts();
    this.telemetryCache = null;
    this.saveCounts();
    this.dataVersion++;
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
    if (r) this.metaSeen.set(key, r.value);
    return r ? json<T | null>(r.value, null) : null;
  }
  // A value the same as the stored one isn't written again (the collector saves several keys every minute, and
  // some rarely change; a Durable Object bills rows written)
  private metaSeen = new Map<string, string>();
  setMeta(key: string, value: unknown) {
    const text = JSON.stringify(value);
    if (this.metaSeen.get(key) === text) return;
    this.all('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, text);
    this.metaSeen.set(key, text);
  }

  // ---- telemetry ----
  insertTelemetry(t: Omit<TelemetryRecord, 'id'>, rawJson: unknown): number | null {
    this.loadCounts(); // (a stored count the insert below must follow)
    this.countingTelemetry = true; // the cached count follows the insert below
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
    this.countingTelemetry = false;
    if (r && this.telemetryCache) {
      this.telemetryCache = { count: this.telemetryCache.count + 1, oldest: this.telemetryCache.oldest === null ? t.timestamp : Math.min(this.telemetryCache.oldest, t.timestamp) };
      this.saveCounts();
    }
    return r ? Number(r.id) : null;
  }

  // Readings stored after row `afterId` (new ones, whatever their time: a device's buffered backfill too),
  // oldest id first: lets a cache read only what it hasn't seen
  telemetryAfterId(source: string, afterId: number): TelemetryRecord[] {
    return this.all(`SELECT ${TELEMETRY_COLUMNS} FROM telemetry WHERE source = ? AND id > ? ORDER BY id`, source, afterId).map(toTelemetry);
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
    this.loadCounts();
    if (!this.telemetryCache) {
      const r = this.sql.all('SELECT COUNT(*) AS n, MIN(timestamp) AS oldest FROM telemetry')[0];
      this.telemetryCache = { count: Number(r.n), oldest: r.oldest ?? null };
      this.saveCounts();
    }
    return this.telemetryCache;
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
    const rows = this.windowOf('plant_events', since, 'SELECT * FROM plant_events WHERE timestamp >= ? ORDER BY timestamp DESC');
    return rows.filter((r) => r.timestamp >= since).slice(0, limit).map(toEvent);
  }
  eventCount(): number {
    return this.countOf('plant_events');
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
    const rows = this.windowOf('interactions', since, 'SELECT * FROM interactions WHERE ended_at >= ? ORDER BY started_at DESC').filter((r) => r.ended_at >= since && (!kind || r.kind === kind));
    return rows.map(toInteraction);
  }
  interactionCount(): number {
    return this.countOf('interactions');
  }

  // ---- outside weather (context only) ----
  insertOutsideWeather(o: OutsideObservation, raw: unknown) {
    this.all(
      'INSERT INTO outside_weather (timestamp, sky, code, temperature, humidity, precipitation, cloud_cover, wind, gusts, is_day, sunrise_at, sunset_at, pressure, aqi, pm25, pm10, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      o.at, o.sky, o.code, o.temperature, o.humidity, o.precipitation, o.cloudCover, o.wind, o.gusts, o.isDay === null ? null : o.isDay ? 1 : 0, o.sunrise ?? null, o.sunset ?? null,
      o.pressure ?? null, o.aqi ?? null, o.pm25 ?? null, o.pm10 ?? null, raw === undefined ? null : JSON.stringify(raw)
    );
  }
  latestOutsideWeather(): OutsideObservation | null {
    const r = this.get(`SELECT ${OUTSIDE_COLUMNS} FROM outside_weather ORDER BY timestamp DESC LIMIT 1`);
    return r ? toOutside(r) : null;
  }
  outsideWeatherSince(since: number): OutsideObservation[] {
    return this.all(`SELECT ${OUTSIDE_COLUMNS} FROM outside_weather WHERE timestamp >= ? ORDER BY timestamp ASC`, since).map(toOutside);
  }
  // Observations stored after row `afterId` (see telemetryAfterId), with their ids
  outsideWeatherAfterId(afterId: number, since = 0): { id: number; o: OutsideObservation }[] {
    return this.all(`SELECT id, ${OUTSIDE_COLUMNS} FROM outside_weather WHERE id > ? AND timestamp >= ? ORDER BY id`, afterId, since).map((r) => ({ id: Number(r.id), o: toOutside(r) }));
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

  // ---- what the tree said (the diary keeps its words) ----
  insertUtterance(u: Omit<Utterance, 'id'>) {
    this.all('INSERT INTO utterances (at, key, kind, text) VALUES (?, ?, ?, ?)', u.at, u.key, u.kind, u.text);
  }
  utterancesSince(since: number): Utterance[] {
    return this.all('SELECT id, at, key, kind, text FROM utterances WHERE at >= ? ORDER BY at', since) as Utterance[];
  }

  // ---- the tree's dreams (one row per night; the outcome is set at dawn) ----
  insertDream(d: DreamRecord, engineVersion: string) {
    const { outcome, ...dream } = d;
    this.all(
      'INSERT OR IGNORE INTO dreams (night, starts_at, ends_at, composed_at, dream_json, outcome_json, engine_version) VALUES (?, ?, ?, ?, ?, ?, ?)',
      d.night, d.startsAt, d.endsAt, d.composedAt, JSON.stringify({ motifs: dream.motifs, phases: dream.phases, cast: dream.cast, alsoRan: dream.alsoRan ?? [] }), outcome ? JSON.stringify(outcome) : null, engineVersion
    );
  }
  finishDream(night: string, outcome: DreamOutcome) {
    this.all('UPDATE dreams SET outcome_json = ? WHERE night = ?', JSON.stringify(outcome), night);
  }
  dreamsSince(since: number): DreamRecord[] {
    return this.all('SELECT * FROM dreams WHERE starts_at >= ? ORDER BY starts_at', since).map((r) => {
      const d = json(r.dream_json, { motifs: [], phases: [], cast: [], alsoRan: [] });
      return { night: r.night, startsAt: r.starts_at, endsAt: r.ends_at, composedAt: r.composed_at, motifs: d.motifs ?? [], phases: d.phases ?? [], cast: d.cast ?? [], alsoRan: d.alsoRan ?? [], outcome: json(r.outcome_json, null) };
    });
  }

  // ---- daily photos (the image is in the photo store under imageKey) ----
  insertPhoto(p: Omit<StoredPhoto, 'id'>): StoredPhoto {
    const r = this.get(
      'INSERT INTO photos (taken_at, uploaded_at, image_key, width, height, bytes, is_reference, roi_json, analysis_json, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *',
      p.takenAt, p.uploadedAt, p.imageKey, p.width, p.height, p.bytes, p.isReference ? 1 : 0, p.roi ? JSON.stringify(p.roi) : null, p.analysis ? JSON.stringify(p.analysis) : null, p.note
    )!;
    if (p.isReference) this.setReferencePhoto(Number(r.id));
    return toPhoto(this.get('SELECT * FROM photos WHERE id = ?', r.id)!);
  }
  getPhoto(id: number): StoredPhoto | null {
    const r = this.get('SELECT * FROM photos WHERE id = ?', id);
    return r ? toPhoto(r) : null;
  }
  // One reference at a time: the newly marked one
  setReferencePhoto(id: number) {
    this.all('UPDATE photos SET is_reference = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE is_reference = 1 OR id = ?', id, id);
  }
  updatePhoto(id: number, change: { roi?: Roi | null; analysis?: PhotoAnalysis | null; note?: string | null }): StoredPhoto | null {
    const r = this.get('SELECT * FROM photos WHERE id = ?', id);
    if (!r) return null;
    const roi = 'roi' in change ? (change.roi ? JSON.stringify(change.roi) : null) : r.roi_json;
    const analysis = 'analysis' in change ? (change.analysis ? JSON.stringify(change.analysis) : null) : r.analysis_json;
    const note = 'note' in change ? change.note ?? null : r.note;
    return toPhoto(this.get('UPDATE photos SET roi_json = ?, analysis_json = ?, note = ? WHERE id = ? RETURNING *', roi, analysis, note, id)!);
  }
  deletePhoto(id: number): StoredPhoto | null {
    const r = this.get('DELETE FROM photos WHERE id = ? RETURNING *', id);
    return r ? toPhoto(r) : null;
  }
  // The photos taken since `since`, newest first, and the reference however old it is (fullness is measured
  // against it). Read every evaluation: a window kept in memory, read again after any write to photos, through
  // the indexes (a Durable Object bills rows read)
  photosSince(since: number): StoredPhoto[] {
    const rows = this.windowOf('photos', since, (start) => [
      ...this.sql.all('SELECT * FROM photos INDEXED BY idx_photos_taken WHERE taken_at >= ? ORDER BY taken_at DESC', start),
      ...this.sql.all('SELECT * FROM photos INDEXED BY idx_photos_reference WHERE is_reference = 1 AND taken_at < ? ORDER BY taken_at DESC LIMIT 1', start),
    ]);
    return rows.filter((r) => r.taken_at >= since || r.is_reference === 1).map(toPhoto);
  }
  // Every photo, newest first (the gallery and cf:backup: a few hundred rows a year, read on demand only)
  allPhotos(limit = 2000): StoredPhoto[] {
    return this.all('SELECT * FROM photos ORDER BY taken_at DESC LIMIT ?', limit).map(toPhoto);
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
    this.episodeWindow?.rows.push(toEpisode(r));
    return toEpisode(r);
  }
  touchEpisode(id: number, lastSeenAt: number, modifiers: HealthCondition[], peakSeverity: Severity, addUnobservedMs = 0) {
    this.all(
      'UPDATE behaviour_episodes SET last_seen_at = ?, modifiers_json = ?, peak_severity = ?, unobserved_ms = unobserved_ms + ? WHERE id = ?',
      lastSeenAt, JSON.stringify(modifiers), peakSeverity, Math.round(addUnobservedMs), id
    );
    this.patchEpisode(id, (e) => {
      e.lastSeenAt = lastSeenAt;
      e.modifiers = json(JSON.stringify(modifiers), []);
      e.peakSeverity = peakSeverity;
      e.unobservedMs += Math.round(addUnobservedMs);
    });
  }
  deleteEpisode(id: number) {
    this.all('DELETE FROM behaviour_episodes WHERE id = ?', id);
    if (this.episodeWindow) this.episodeWindow.rows = this.episodeWindow.rows.filter((e) => e.id !== id);
  }
  reopenEpisode(id: number) {
    this.all('UPDATE behaviour_episodes SET ended_at = NULL WHERE id = ?', id);
    this.patchEpisode(id, (e) => {
      e.endedAt = null;
    });
  }
  lastClosedEpisode(): BehaviourEpisode | null {
    const r = this.get('SELECT * FROM behaviour_episodes WHERE ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT 1');
    return r ? toEpisode(r) : null;
  }
  closeEpisode(id: number, endedAt: number) {
    this.all('UPDATE behaviour_episodes SET ended_at = ?, last_seen_at = MAX(last_seen_at, ?) WHERE id = ?', endedAt, endedAt, id);
    this.patchEpisode(id, (e) => {
      e.endedAt = endedAt;
      e.lastSeenAt = Math.max(e.lastSeenAt, endedAt);
    });
  }
  episodesSince(since: number): BehaviourEpisode[] {
    if (!this.episodeWindow || since < this.episodeWindow.start) {
      // last_seen_at >= since is implied (closing sets last_seen_at = MAX(last_seen_at, ended_at), and the open
      // one's only moves forward), so it adds no row and lets the index answer instead of the whole table
      const rows = this.sql.all('SELECT * FROM behaviour_episodes INDEXED BY idx_episodes_last_seen WHERE last_seen_at >= ? AND COALESCE(ended_at, last_seen_at) >= ? ORDER BY started_at DESC', since, since);
      this.episodeWindow = { start: since, rows: rows.map(toEpisode) };
    }
    return this.episodeWindow.rows
      .filter((e) => (e.endedAt ?? e.lastSeenAt) >= since)
      .sort((a, b) => b.startedAt - a.startedAt || b.id - a.id)
      .map((e) => ({ ...e, modifiers: [...e.modifiers] })); // copies: callers can't change the window
  }
  episodeCount(): number {
    return this.countOf('behaviour_episodes');
  }
}

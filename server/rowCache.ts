import type { OutsideObservation } from '../src/telemetry/outsideWeather';
import type { TelemetryRecord } from '../src/history/historyTypes';
import type { AppDatabase } from './database';
import { DAY } from '../src/lib/time';

// The recent readings and outside observations of a tree, kept in memory for the diary. The diary replays the
// last two weeks (the sloth's loyalty) every time it is opened, and Home reloads it every few minutes; reading
// those rows each time is what a Durable Object's SQLite bills (rows read). So the cache reads a window once,
// and then only the rows stored since (by id: a device's buffered backfill is new rows with older times, and is
// caught too). Same rows, same order as the queries it replaces (timestamp order), so the diary is unchanged.
// A restore or a top-up (AppDatabase.dataVersion) starts it over.

interface Rows<T> {
  start: number; // the window held: rows from this time on
  lastId: number; // the newest row read
  rows: T[]; // timestamp order
}
interface Store {
  version: number;
  source: string | null;
  telemetry: Rows<TelemetryRecord> | null;
  weather: Rows<{ id: number; o: OutsideObservation }> | null;
}
const stores = new WeakMap<AppDatabase, Store>();

function storeFor(db: AppDatabase): Store {
  let s = stores.get(db);
  if (!s || s.version !== db.dataVersion) stores.set(db, (s = { version: db.dataVersion, source: null, telemetry: null, weather: null }));
  return s;
}

// Keep at most the last KEEP of rows (the diary asks for two weeks and a little more); a request for older rows
// reads them again (rare). Trimmed by the newest row's time, never by what one request asked: requests for
// shorter windows must not make the next, longer one read everything again.
const KEEP = 16 * DAY;
const trim = <T,>(c: Rows<T>, at: (x: T) => number) => {
  const newest = c.rows.length ? at(c.rows[c.rows.length - 1]) : c.start;
  if (newest - KEEP - DAY <= c.start) return;
  c.start = newest - KEEP;
  c.rows = c.rows.filter((x) => at(x) >= c.start);
};
const merge = <T,>(rows: T[], fresh: T[], at: (x: T) => number): T[] => {
  const all = rows.concat(fresh);
  // Fresh rows are almost always newer; sort only when one isn't (stable: equal times keep their order)
  for (let i = rows.length; i < all.length; i++) if (i > 0 && at(all[i]) < at(all[i - 1])) return all.sort((a, b) => at(a) - at(b));
  return all;
};

// = db.telemetrySince(source, since, until)
export function recentTelemetry(db: AppDatabase, source: string, since: number, until = Number.MAX_SAFE_INTEGER): TelemetryRecord[] {
  const s = storeFor(db);
  const at = (r: TelemetryRecord) => r.timestamp;
  let c = s.source === source ? s.telemetry : null;
  if (!c || since < c.start) {
    const rows = db.telemetrySince(source, since);
    c = { start: since, lastId: rows.reduce((m, r) => Math.max(m, r.id), c?.lastId ?? 0), rows };
    s.source = source;
    s.telemetry = c;
  } else {
    const fresh = db.telemetryAfterId(source, c.lastId);
    if (fresh.length) {
      c.rows = merge(c.rows, fresh, at);
      c.lastId = fresh.reduce((m, r) => Math.max(m, r.id), c.lastId);
    }
    trim(c, at);
  }
  return c.rows.filter((r) => r.timestamp >= since && r.timestamp <= until);
}

// = db.outsideWeatherSince(since)
export function recentWeather(db: AppDatabase, since: number): OutsideObservation[] {
  const s = storeFor(db);
  const at = (x: { id: number; o: OutsideObservation }) => x.o.at;
  let c = s.weather;
  if (!c || since < c.start) {
    const rows = db.outsideWeatherAfterId(0, since);
    c = { start: since, lastId: rows.reduce((m, r) => Math.max(m, r.id), 0), rows: rows.sort((a, b) => at(a) - at(b) || a.id - b.id) };
    s.weather = c;
  } else {
    const fresh = db.outsideWeatherAfterId(c.lastId);
    if (fresh.length) {
      c.rows = merge(c.rows, fresh, at);
      c.lastId = fresh.reduce((m, r) => Math.max(m, r.id), c.lastId);
    }
    trim(c, at);
  }
  return c.rows.filter((x) => x.o.at >= since).map((x) => x.o);
}

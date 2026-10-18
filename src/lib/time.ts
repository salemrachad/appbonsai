// Time units in milliseconds, and the clock as the tree's screens and lines show it. One place, so a change
// to how times read happens once. Formatting follows the device's locale (toLocaleTimeString), as before.
// (species/ficus.ts keeps its own MIN/HOUR: its latch durations are in minutes.)
export const MIN = 60 * 1000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

// ---- The tree's clock ----
// Days, hours and the times the tree writes are the TREE's local time (its timezone, from the settings), not
// the machine's: the live tree runs on Cloudflare, whose clock is UTC. The collector sets the zone from the
// settings (and the browser from its copy of them); without one, the machine's own clock is used, as before.
let zone: string | undefined;
let native = true; // the zone is the machine's own: plain Date methods give the same answers, faster
const runtimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
};

export function setTreeTimeZone(tz: string | null | undefined) {
  const next = tz || undefined;
  if (next === zone) return;
  try {
    if (next) new Intl.DateTimeFormat('en-US', { timeZone: next }); // throws on an unknown zone
    zone = next;
  } catch {
    zone = undefined; // an unknown zone: the machine's clock
  }
  native = !zone || zone === runtimeZone();
  offsets.clear();
}
export const treeTimeZone = () => zone;

// 14:05 (or 2:05 PM, by locale), on the tree's clock
export const hhmm = (t: number | Date) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: native ? undefined : zone });
// 14:05:09
export const hhmmss = (t: number | Date) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: native ? undefined : zone });

// How far the tree's wall clock is ahead of UTC at t (cached per hour: zones change offset on the hour)
const offsets = new Map<number, number>();
let parts: Intl.DateTimeFormat | null = null;
function offsetAt(t: number): number {
  if (native) return -new Date(t).getTimezoneOffset() * MIN;
  const bucket = Math.floor(t / HOUR);
  const hit = offsets.get(bucket);
  if (hit !== undefined) return hit;
  if (!parts || parts.resolvedOptions().timeZone !== zone) parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' });
  const p: Record<string, number> = {};
  for (const x of parts.formatToParts(bucket * HOUR)) if (x.type !== 'literal') p[x.type] = Number(x.value);
  const off = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute) - bucket * HOUR;
  if (offsets.size > 20_000) offsets.clear();
  offsets.set(bucket, off);
  return off;
}

// The tree's calendar at t: year, month (1-12), day, hour, minute, weekday (0 = Sunday)
export interface Civil {
  y: number;
  m: number;
  d: number;
  h: number;
  min: number;
  dow: number;
}
export function civil(t: number): Civil {
  const w = new Date(t + offsetAt(t));
  return { y: w.getUTCFullYear(), m: w.getUTCMonth() + 1, d: w.getUTCDate(), h: w.getUTCHours(), min: w.getUTCMinutes(), dow: w.getUTCDay() };
}
// The instant of a wall-clock time on the tree's calendar (hours may be fractional; past 24 runs into the next
// day, a day past the month's end into the next month), DST-safe
export function clockOn(y: number, m: number, d: number, hour = 0): number {
  if (native) {
    const x = new Date(y, m - 1, d, 0, 0, 0, 0);
    if (hour) x.setMinutes(Math.round(hour * 60));
    return x.getTime();
  }
  const naive = Date.UTC(y, m - 1, d, 0, Math.round(hour * 60));
  const first = naive - offsetAt(naive);
  return naive - offsetAt(first);
}
// Midnight of the tree's day containing t
export const startOfDay = (t: number) => {
  const c = civil(t);
  return clockOn(c.y, c.m, c.d);
};
// Midnight n days later (or earlier) than the tree's day containing `day`
export const addDays = (day: number, n: number) => {
  const c = civil(day);
  return clockOn(c.y, c.m, c.d + n);
};
// A wall-clock time (hours, fractional) on the tree's day containing `day`
export const clockAt = (day: number, hour: number) => {
  const c = civil(day);
  return clockOn(c.y, c.m, c.d, hour);
};
// "2026-10-18": the tree's day as a key (unpadded; stable rolls and once-a-day memories use it)
export const dayKey = (t: number) => {
  const c = civil(t);
  return `${c.y}-${c.m}-${c.d}`;
};
// "2026-10-08": the tree's date, padded (sortable; the daily summaries use it)
export const dateKey = (t: number) => {
  const c = civil(t);
  return `${c.y}-${String(c.m).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`;
};
// The tree's hour of the day at t (0-23), and with minutes as a fraction
export const hourOf = (t: number) => civil(t).h;
export const hourFraction = (t: number) => {
  const c = civil(t);
  return c.h + c.min / 60;
};
// Short weekday name on the tree's calendar ("Mon")
export const weekdayShort = (t: number) => new Date(t).toLocaleDateString([], { weekday: 'short', timeZone: native ? undefined : zone });

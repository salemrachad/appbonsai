import type { PerceptionSample } from '../perception/perceptionTypes';
import type { SpeciesProfile } from '../species';
import { clockAt, DAY, HOUR, MIN, hhmm, startOfDay } from '../lib/time';
import type { DiaryItem, MomentKind } from './historyTypes';

// Moments of the day for the diary: facts found in the stored readings, at most one of each kind per local
// day. Nothing is invented and nothing is stored: the same readings always give the same moments. For today a
// moment appears only once it is settled (e.g. the warmest only after 18:00), so a line never moves.
// The tree's own words come first: a moment it already spoke about that day (said: the thought ids) is left out.

const SAID_AS: Partial<Record<MomentKind, string>> = { brightest: 'brightest_hour', warmest: 'warmest_hour', humid_morning: 'humid_morning' };
const QUICK = { tempC: 4, humidity: 15, windowMs: HOUR, slackMs: 10 * MIN };
const r1 = (n: number) => Math.round(n * 10) / 10;

export const dayStartOf = startOfDay; // the tree's day (its timezone)
const atHour = clockAt;

// samples: oldest first. said: what the tree said (utterances: their time and key). from: the first day to
// describe (an earlier, partly loaded day would give wrong moments).
export function dayMoments(samples: PerceptionSample[], species: SpeciesProfile, now: number, said: { at: number; key: string }[], from: number): DiaryItem[] {
  const byDay = new Map<number, PerceptionSample[]>();
  for (const s of samples) {
    const d = dayStartOf(s.t);
    if (d < from || s.t > now) continue;
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(s);
  }
  const items: DiaryItem[] = [];
  for (const [day, list] of byDay) {
    const saidToday = new Set(said.filter((u) => dayStartOf(u.at) === day).map((u) => u.key));
    const add = (moment: MomentKind, at: number, title: string, detail: string) => {
      if (SAID_AS[moment] && saidToday.has(SAID_AS[moment]!)) return;
      items.push({ at, kind: 'moment', moment, title, detail });
    };
    const useful = species.light.usefulMinPercent;

    // The brightest hour of the daylight (once it is two hours past)
    const hours = new Map<number, { sum: number; n: number }>();
    for (const s of list) {
      if (s.light === null || !s.isDay) continue;
      const h = Math.floor(s.t / HOUR) * HOUR;
      const b = hours.get(h) ?? { sum: 0, n: 0 };
      hours.set(h, { sum: b.sum + s.light, n: b.n + 1 });
    }
    let best: { h: number; avg: number } | null = null;
    for (const [h, b] of hours) if (b.n >= 10 && (!best || b.sum / b.n > best.avg)) best = { h, avg: b.sum / b.n };
    if (best && best.avg >= useful && best.h + 3 * HOUR <= now) add('brightest', best.h, 'Brightest hour', `${hhmm(best.h)}–${hhmm(best.h + HOUR)} · light ${Math.round(best.avg)}%`);

    // The first good light on the leaves: a real change, so a dim reading just before it (not the day's first
    // reading after a gap or a start)
    const i = list.findIndex((s) => s.isDay && s.light !== null && s.light >= useful);
    const before = i > 0 ? list[i - 1] : null;
    if (i > 0 && before && list[i].t - before.t <= 15 * MIN && (before.light === null || before.light < useful))
      add('first_light', list[i].t, 'First good light on the leaves', `light ${Math.round(list[i].light!)}%`);

    // The warmest moment (once the heat of the day is over) and the coolest of the night (after 09:00)
    const temps = list.filter((s) => s.temp !== null);
    if (temps.length >= 30 && now >= atHour(day, 18)) {
      const warm = temps.reduce((a, b) => (b.temp! > a.temp! ? b : a));
      add('warmest', warm.t, 'Warmest moment', `${hhmm(warm.t)} · ${r1(warm.temp!)}°C`);
    }
    const night = temps.filter((s) => s.t < atHour(day, 9));
    if (night.length >= 30 && now >= atHour(day, 9)) {
      const cool = night.reduce((a, b) => (b.temp! < a.temp! ? b : a));
      add('coolest_night', cool.t, 'Coolest of the night', `${hhmm(cool.t)} · ${r1(cool.temp!)}°C`);
    }

    // A humid morning (after 10:00)
    const morning = list.filter((s) => s.hum !== null && s.t < atHour(day, 10) && s.t >= atHour(day, 5));
    if (morning.length >= 15 && now >= atHour(day, 10)) {
      const wet = morning.reduce((a, b) => (b.hum! > a.hum! ? b : a));
      if (wet.hum! >= species.humidity.maxOptimal) add('humid_morning', wet.t, 'Humid morning', `up to ${Math.round(wet.hum!)}% at ${hhmm(wet.t)}`);
    }

    // The quickest change within an hour (temperature or humidity), against the reading about an hour earlier
    let quick: { at: number; from: number; title: string; detail: string; size: number } | null = null;
    let j = 0;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      while (j < i && s.t - list[j].t > QUICK.windowMs + QUICK.slackMs) j++;
      const e = list[j];
      if (j === i || s.t - e.t < QUICK.windowMs - QUICK.slackMs) continue;
      if (s.temp !== null && e.temp !== null) {
        const d = s.temp - e.temp;
        const size = Math.abs(d) / QUICK.tempC;
        if (size >= 1 && (!quick || size > quick.size))
          quick = { at: s.t, from: e.t, size, title: d > 0 ? 'Warmed quickly' : 'Cooled quickly', detail: `${d > 0 ? '+' : ''}${r1(d)}°C between ${hhmm(e.t)} and ${hhmm(s.t)}` };
      }
      if (s.hum !== null && e.hum !== null) {
        const d = s.hum - e.hum;
        const size = Math.abs(d) / QUICK.humidity;
        if (size >= 1 && (!quick || size > quick.size))
          quick = { at: s.t, from: e.t, size, title: d > 0 ? 'The air turned humid quickly' : 'The air dried quickly', detail: `${d > 0 ? '+' : ''}${Math.round(d)}% between ${hhmm(e.t)} and ${hhmm(s.t)}` };
      }
    }
    if (quick && (day + DAY <= now || now - quick.at >= HOUR)) add('quick_change', quick.at, quick.title, quick.detail);
  }
  return items;
}

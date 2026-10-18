import { CONDITION_LABELS } from '../health/labels';
import type { HealthCondition } from '../health/healthTypes';
import type { PerceptionSample } from '../perception/perceptionTypes';
import type { SpeciesProfile } from '../species';
import { DAY, HOUR, MIN } from '../lib/time';
import type { BehaviourEpisode, DiaryItem, PlantEvent } from './historyTypes';
import { dayStartOf } from './moments';

// The day in short, closing each finished local day in the diary: the soil from morning to night (and the
// waterings), the temperature and humidity ranges, the hours of good light, and the condition it spent most of
// its awake, observed time in (and any stress of an hour or more). All from stored readings, episodes and care.

const NOT_A_MOOD: HealthCondition[] = ['sleeping', 'sensor_uncertain']; // the night and the gaps aren't how the day went
const STRESS_MIN_MS = HOUR;
const MAX_STEP_MS = 10 * MIN; // a reading counts for the time until the next, at most this (gaps aren't light)
const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);
const hours = (ms: number) => {
  const h = Math.round((ms / HOUR) * 10) / 10;
  return `${h % 1 === 0 ? h.toFixed(0) : h} h`;
};

// samples: oldest first. from: the first day to describe (an earlier, partly loaded day would be wrong).
export function daySummaries(samples: PerceptionSample[], episodes: BehaviourEpisode[], events: PlantEvent[], species: SpeciesProfile, now: number, from: number): DiaryItem[] {
  const byDay = new Map<number, PerceptionSample[]>();
  for (const s of samples) {
    const d = dayStartOf(s.t);
    if (d < from || d + DAY > now) continue; // finished days only
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(s);
  }
  const items: DiaryItem[] = [];
  for (const [day, list] of byDay) {
    if (list.length < 30) continue;
    const end = day + DAY;
    const parts: string[] = [];

    const soil = list.filter((s) => s.soil !== null);
    const waterings = events.filter((e) => e.type === 'watering' && e.timestamp >= day && e.timestamp < end).length;
    if (soil.length) parts.push(`soil ${Math.round(soil[0].soil!)}% → ${Math.round(soil[soil.length - 1].soil!)}%${waterings ? `, watered ${times(waterings)}` : ''}`);
    else if (waterings) parts.push(`watered ${times(waterings)}`);

    const range = (vals: number[], unit: string, round: (n: number) => number) =>
      vals.length ? `${round(Math.min(...vals))}–${round(Math.max(...vals))}${unit}` : null;
    const t = range(list.flatMap((s) => (s.temp === null ? [] : [s.temp])), '°C', (n) => Math.round(n * 10) / 10);
    const rh = range(list.flatMap((s) => (s.hum === null ? [] : [s.hum])), '% humidity', Math.round);
    if (t) parts.push(t);
    if (rh) parts.push(rh);

    let goodLight = 0;
    list.forEach((s, i) => {
      if (!s.isDay || s.light === null || s.light < species.light.usefulMinPercent) return;
      const next = list[i + 1]?.t ?? Math.min(end, s.t + MAX_STEP_MS);
      goodLight += Math.min(MAX_STEP_MS, next - s.t);
    });
    parts.push(`${hours(goodLight)} of good light`);

    // How the day went: time per condition inside the day (episodes are the tree's states)
    const spent = new Map<HealthCondition, number>();
    for (const e of episodes) {
      const a = Math.max(e.startedAt, day);
      const b = Math.min(e.endedAt ?? e.lastSeenAt, end);
      if (b <= a) continue;
      spent.set(e.condition, (spent.get(e.condition) ?? 0) + (b - a) - Math.min(e.unobservedMs ?? 0, b - a));
    }
    const ranked = [...spent].filter(([c]) => !NOT_A_MOOD.includes(c)).sort((x, y) => y[1] - x[1]);
    if (ranked.length) {
      const [mostly] = ranked[0];
      const label = (c: HealthCondition) => CONDITION_LABELS[c].toLowerCase();
      const stresses = ranked.slice(1).filter(([c, ms]) => ms >= STRESS_MIN_MS && !['comfortable', 'thriving', 'recovering'].includes(c));
      parts.push([`mostly ${label(mostly)}`, ...stresses.map(([c, ms]) => `${hours(ms)} ${label(c)}`)].join(', '));
    }

    items.push({ at: end - 1, kind: 'day_summary', title: 'The day in short', detail: parts.join(' · ') });
  }
  return items;
}

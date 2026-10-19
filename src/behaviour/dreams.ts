import { APP_CONFIG } from '../config/appConfig';
import type { HealthCondition, HealthModifier } from '../health/healthTypes';
import type { BehaviourEpisode, DiaryItem, Interaction, PlantEvent } from '../history/historyTypes';
import type { OutsideObservation } from '../telemetry/outsideWeather';
import type { SpeciesProfile } from '../species';
import { sunTimes } from '../perception/sun';
import { lucyDay } from './lucy';
import { stableVariant } from './speech';
import { DREAM_WORDS } from './messages';
import type { HikePlan } from './hike';
import type { CanopyState, DreamCast, DreamFragment, DreamMotif, DreamOutcome, DreamPhase, DreamRecord, DreamSource, DreamState, HabitatState } from './behaviourTypes';
import { DAY, HOUR, MIN, addDays, clockAt, dayKey, hhmm, startOfDay } from '../lib/time';

// Dreams: the day digested at night (evidence class "art" over "science": a plant really does work through
// its day in the dark: it breaks down the starch made by daylight, its stems lengthen mostly at night, its
// clock anticipates dawn. The dream is an image laid over that, never a claim of a mind).
//
// No part of the tree's world writes the dream. Each brings fragments of its own day: the tree its episodes
// and the care it got, the sky outside, the squirrel, the sloth and the dragonfly their visits, Lucy her
// night by the pot, the people their hike, a hand on the leaves. The dream is what weighs most tonight:
//   salience = intensity × novelty (pleasures habituate: the tenth routine watering barely shows)
//            + recurrence (worries come back: a dry wind returns night after night through a dry spell)
//            + company (whoever sleeps beside the tree tonight is more in its dream)
// Composed once when the night begins and stored (the `dreams` table); its outcome (what was really dreamt:
// phases asleep with trustworthy data) is stored at dawn. Deterministic: stable rolls on the night.
// Health, vitality, mood, energy, speech timing and the visitors never read it.

const C = () => APP_CONFIG.dreams;
const roll = (seed: string) => stableVariant(seed, 10_000) / 10_000;
const r2 = (n: number) => Math.round(n * 100) / 100;

// Worries recur (until they fade); everything else habituates
const WORRIES: DreamMotif[] = ['dry_wind', 'glare', 'frost', 'flood', 'storm'];

export interface Night {
  key: string;
  startsAt: number;
  endsAt: number;
}
type Location = { latitude: number | null; longitude: number | null } | undefined;

// The night that begins on the evening of the day starting at dayStart: from a little after sunset to sunrise
export function nightOf(dayStart: number, location: Location): Night {
  const c = C();
  const lat = location?.latitude ?? null;
  const lon = location?.longitude ?? null;
  const sunset = lat !== null && lon !== null ? sunTimes(dayStart, lat, lon).sunset : null;
  const sunrise = lat !== null && lon !== null ? sunTimes(addDays(dayStart, 1), lat, lon).sunrise : null;
  return {
    key: dayKey(dayStart),
    startsAt: (sunset ?? clockAt(dayStart, c.fallback.sunsetHour)) + c.afterSunsetMin * MIN,
    endsAt: sunrise ?? clockAt(addDays(dayStart, 1), c.fallback.sunriseHour),
  };
}

// The night now running (if any), and the last one that is over
export function nightsAround(now: number, location: Location): { day: number; current: Night; running: Night | null; last: Night } {
  const today = startOfDay(now);
  const day = now < clockAt(today, 12) ? addDays(today, -1) : today;
  const current = nightOf(day, location);
  const running = now >= current.startsAt && now < current.endsAt ? current : null;
  const last = now >= current.endsAt ? current : nightOf(addDays(day, -1), location);
  return { day, current, running, last };
}

const THIRST: HealthCondition[] = ['thirsty', 'very_dry', 'hot_and_dry'];
const HEAT: HealthCondition[] = ['hot', 'hot_and_dry', 'very_bright'];
const COLD: HealthCondition[] = ['cold', 'freezing_risk'];

// Observed hours of these conditions (primary, or as a modifier) between from and to
function observedHours(episodes: BehaviourEpisode[], set: HealthCondition[], from: number, to: number): number {
  let h = 0;
  for (const e of episodes) {
    if (!set.includes(e.condition) && !e.modifiers.some((m) => set.includes(m))) continue;
    const end = e.endedAt ?? e.lastSeenAt;
    const span = Math.min(end, to) - Math.max(e.startedAt, from);
    if (span <= 0) continue;
    const observed = Math.max(0, 1 - e.unobservedMs / Math.max(1, end - e.startedAt));
    h += (span * observed) / HOUR;
  }
  return h;
}
const ramp = (x: number, full: number) => Math.min(1, Math.max(0, x / full));

export interface DreamDayInput {
  night: Night;
  dayStart: number;
  episodes: BehaviourEpisode[];
  events: PlantEvent[];
  interactions: Interaction[];
  outsideToday: OutsideObservation[];
  habitat: HabitatState; // as the night begins: the visitors' day (counts so far today) and who sleeps here
  hike: HikePlan | null;
  canopy: CanopyState;
  weatherComing: boolean;
  species: SpeciesProfile;
}

// What each part of the tree's world brings from the day (intensity only: novelty and recurrence come later)
export function dayFragments(i: DreamDayInput): DreamFragment[] {
  const from = i.dayStart;
  const to = i.night.startsAt;
  const out: DreamFragment[] = [];
  const add = (motif: DreamMotif, salience: number, source: DreamSource, why: string, role: DreamFragment['role'] = 'day') => {
    const had = out.find((f) => f.motif === motif && f.role === role);
    if (had && had.salience >= salience) return;
    if (had) out.splice(out.indexOf(had), 1);
    out.push({ motif, salience: r2(Math.min(1, salience)), source, role, why });
  };

  // The tree: the stresses it lived (observed time only) and a thriving day
  const dry = observedHours(i.episodes, THIRST, from, to);
  const veryDry = observedHours(i.episodes, ['very_dry', 'hot_and_dry'], from, to);
  if (dry >= 0.5) add('dry_wind', 0.35 + 0.45 * ramp(dry, 8) + (veryDry >= 0.5 ? 0.15 : 0), 'tree', `${Math.round(dry)}h of dry soil`);
  const hot = observedHours(i.episodes, HEAT, from, to);
  if (hot >= 0.5) add('glare', 0.3 + 0.4 * ramp(hot, 4), 'tree', `${Math.round(hot)}h of heat or glare`);
  const cold = observedHours(i.episodes, COLD, from, to);
  if (cold >= 0.5) add('frost', 0.35 + 0.45 * ramp(cold, 4), 'tree', `${Math.round(cold)}h of cold`);
  const wet = observedHours(i.episodes, ['too_wet'], from, to);
  if (wet >= 0.5) add('flood', 0.3 + 0.4 * ramp(wet, 6), 'tree', `${Math.round(wet)}h of waterlogged soil`);
  const humid = observedHours(i.episodes, ['high_humidity'], from, to);
  if (humid >= 1) add('mist', 0.25 + 0.3 * ramp(humid, 6), 'tree', `${Math.round(humid)}h of heavy, humid air`);
  const thriving = observedHours(i.episodes, ['thriving'], from, to);
  if (thriving >= 1) add('sun', 0.3 + 0.4 * ramp(thriving, 4), 'tree', `${Math.round(thriving)}h thriving`);
  if (i.canopy.refilling >= 0.2) add('new_leaves', 0.3 + 0.3 * i.canopy.refilling, 'tree', 'the canopy filling in');

  // Care: the same watering means different things (diffraction): relief after a thirst is vivid, a routine
  // drink is faint, water on wet soil leaves nothing
  const s = i.species.soilMoisture;
  for (const e of i.events) {
    if (e.timestamp < from || e.timestamp >= to) continue;
    if (e.type === 'watering') {
      const m = e.metadata;
      const before = m.conditionBefore ?? null;
      const soil = m.moistureBefore ?? null;
      if (before === 'too_wet' || (soil !== null && soil >= s.maxOptimal)) continue;
      if ((before && THIRST.includes(before)) || (soil !== null && soil < s.minOptimal)) add('rain', 0.85, 'care', before === 'very_dry' || before === 'hot_and_dry' ? 'after the long thirst' : 'a drink when dry');
      else add('rain', 0.3, 'care', 'a drink');
    } else if (e.type === 'pruning') add('new_shoots', 0.6, 'care', 'pruned');
    else if (e.type === 'repotting') add('new_ground', 0.65, 'care', 'repotted');
    else if (e.type === 'moved_location') add('new_light', 0.6, 'care', 'moved to a new spot');
  }

  // Attention: a hand on the leaves (never care, but it was lived)
  const activeMin = i.interactions
    .filter((x) => x.kind === 'pet' && x.startedAt >= from && x.startedAt < to)
    .reduce((a, x) => a + (Number(x.metadata.activeMs) || 0), 0) / MIN;
  if (activeMin >= 0.5) add('warm_hand', 0.25 + 0.35 * ramp(activeMin, 5), 'attention', `${Math.round(activeMin * 10) / 10} min of petting`);

  // The sky outside (context: a greenhouse tree hears the rain, it isn't wet)
  const skies = new Set(i.outsideToday.filter((o) => o.at >= from && o.at < to).map((o) => o.sky));
  if (skies.has('thunderstorm')) add('storm', 0.6, 'weather', 'a storm outside');
  if (skies.has('snow')) add('snow', 0.6, 'weather', 'snow outside');
  if (skies.has('rain') || skies.has('heavy_rain')) add('rain', 0.4, 'weather', 'rain outside');
  if (skies.has('fog')) add('mist', 0.35, 'weather', 'fog outside');

  // The visitors' day, as they remember it
  const h = i.habitat;
  if (h.visitsToday.count > 0) add('squirrel', 0.3 + 0.1 * Math.min(3, h.visitsToday.count) + (h.memory.stage === 'peeking' ? 0.15 : 0), 'squirrel', `the squirrel came ${h.visitsToday.count} ${h.visitsToday.count === 1 ? 'time' : 'times'}`);
  if (h.presence === 'sleeping') add('drey', 0.4, 'squirrel', 'the squirrel asleep in its drey');
  if (h.sloth && h.sloth.visitsToday.count > 0) add('sloth', 0.25 + 0.3 * ramp(h.sloth.visitsToday.minutes, 120), 'sloth', `the sloth stayed ${h.sloth.visitsToday.minutes} min`);
  if (h.dragonfly && h.dragonfly.visitsToday.count > 0) add('dragonfly', 0.25 + 0.05 * Math.min(4, h.dragonfly.visitsToday.count), 'dragonfly', `the dragonfly came ${h.dragonfly.visitsToday.count} ${h.dragonfly.visitsToday.count === 1 ? 'time' : 'times'}`);
  if (h.lucy && h.lucy.visitsToday.count > 0) add('lucy', 0.15, 'lucy', 'Lucy kept it company');

  // The people: a hike day (away all day), and tomorrow's (the last dream before dawn)
  const tomorrow = dayKey(addDays(i.dayStart, 1));
  if (i.hike?.day === i.night.key) add('boots', 0.55, 'hike', 'the hike today');
  else if (i.hike?.day === tomorrow) add('boots', 0.45, 'hike', 'the hike tomorrow', 'anticipation');
  if (i.weatherComing) add('wind_rising', 0.45, 'weather', 'the barometer falling', 'anticipation');
  return out;
}

// Who sleeps in or by the tree tonight
export function castOf(i: Pick<DreamDayInput, 'habitat' | 'dayStart' | 'hike'>): DreamCast[] {
  const cast: DreamCast[] = [];
  const hikeDetail = i.hike?.day === dayKey(i.dayStart) ? i.hike.detail ?? null : null;
  if (lucyDay(i.dayStart, hikeDetail).visits.some((v) => v.kind === 'night')) cast.push('lucy');
  if (i.habitat.sloth?.presence === 'sleeping') cast.push('sloth');
  if (i.habitat.presence === 'sleeping') cast.push('squirrel');
  return cast;
}
const CAST_MOTIF: Record<DreamCast, DreamMotif> = { lucy: 'lucy', sloth: 'sloth', squirrel: 'drey' };
const CAST_SOURCE: Record<DreamCast, DreamSource> = { lucy: 'lucy', sloth: 'sloth', squirrel: 'squirrel' };

// What the last nights left: per motif, its decayed strength and the nights it was dreamt (or planned, for a
// night not over yet)
export function motifMemory(past: DreamRecord[], before: string, at: number): Map<DreamMotif, { strength: number; nights: number }> {
  const c = C();
  const out = new Map<DreamMotif, { strength: number; nights: number }>();
  for (const r of past) {
    if (r.night >= before) continue;
    const ageDays = (at - r.startsAt) / DAY;
    if (ageDays > c.novelty.nights) continue;
    const motifs = r.outcome ? r.motifs.filter((m) => r.outcome!.dreamt.includes(m.motif)) : r.motifs;
    for (const m of motifs) {
      const was = out.get(m.motif) ?? { strength: 0, nights: 0 };
      out.set(m.motif, { strength: was.strength + m.salience * Math.exp(-ageDays / c.recurrence.tauDays), nights: was.nights + 1 });
    }
  }
  return out;
}

// Tonight's dream: the day's fragments, weighed by what the last nights were made of and by who sleeps here
export function composeDream(i: DreamDayInput & { past: DreamRecord[]; now: number }): DreamRecord {
  const c = C();
  const memory = motifMemory(i.past, i.night.key, i.night.startsAt);
  const cast = castOf(i);
  // Whoever sleeps beside the tree is in the dream even on a day it brought nothing else (and, like any
  // pleasure, habituates: Lucy by the pot every night is seldom dreamt; after nights away she is)
  const day = dayFragments(i);
  const castOnly: DreamFragment[] = cast
    .filter((who) => !day.some((f) => f.motif === CAST_MOTIF[who]))
    .map((who) => ({ motif: CAST_MOTIF[who], salience: 0.3, source: CAST_SOURCE[who], role: 'day', why: `${who === 'lucy' ? 'Lucy' : `the ${who}`} asleep beside it` }));
  const frags = [...day, ...castOnly].map((f) => {
    const m = memory.get(f.motif);
    let salience = f.salience;
    let why = f.why;
    if (WORRIES.includes(f.motif)) {
      if (m && m.strength >= c.recurrence.min) {
        salience += 0.1 * Math.min(3, m.strength);
        why = `${why}, again`;
      }
    } else if (m) salience *= Math.max(c.novelty.floor, 1 / (1 + c.novelty.step * m.nights));
    // Company: the day of whoever sleeps beside the tree weighs more
    if (!castOnly.includes(f) && cast.some((who) => CAST_MOTIF[who] === f.motif)) salience += c.castBoost;
    return { ...f, salience, why };
  });
  // A worry that keeps coming back, even on a day without it (until it fades)
  for (const [motif, m] of memory) {
    if (!WORRIES.includes(motif) || m.strength < c.recurrence.min || frags.some((f) => f.motif === motif)) continue;
    frags.push({ motif, salience: Math.min(c.recurrence.cap, 0.3 * m.strength), source: 'memory', role: 'memory', why: `came back (${m.nights} of the last nights)` });
  }
  const rounded = frags.map((f) => ({ ...f, salience: r2(Math.min(1, f.salience)) })).filter((f) => f.salience >= c.minSalience);
  const byWeight = (a: DreamFragment, b: DreamFragment) => b.salience - a.salience || a.motif.localeCompare(b.motif);
  const main = rounded.filter((f) => f.role !== 'anticipation').sort(byWeight).slice(0, c.maxMotifs);
  const ahead = rounded.filter((f) => f.role === 'anticipation').sort(byWeight).slice(0, 1);
  const motifs = [...main, ...ahead];
  return { night: i.night.key, startsAt: i.night.startsAt, endsAt: i.night.endsAt, composedAt: i.now, motifs, phases: planPhases(i.night, motifs), cast, outcome: null };
}

// Sleep cycles from the night's start to sunrise (lengths: stable rolls). The first is deep sleep only; then
// each ends in a dreaming phase that grows toward dawn. The day's strongest motif dreams first, the ones that
// came back in the middle of the night, tomorrow in the last dream before sunrise.
export function planPhases(night: Night, motifs: DreamFragment[]): DreamPhase[] {
  const c = C();
  if (!motifs.length) return [];
  const cycles: [number, number][] = [];
  for (let t = night.startsAt, n = 0; t < night.endsAt && n < 40; n++) {
    const len = (c.cycleMin.min + roll(`dream:${night.key}:cycle:${n}`) * (c.cycleMin.max - c.cycleMin.min)) * MIN;
    cycles.push([t, Math.min(night.endsAt, t + len)]);
    t += len;
  }
  const dreaming = cycles.slice(c.settleCycles);
  const windows = dreaming
    .map(([a, b], j) => {
      const share = c.dreamShare.first + (c.dreamShare.last - c.dreamShare.first) * (dreaming.length > 1 ? j / (dreaming.length - 1) : 1);
      return { from: Math.round(b - (b - a) * share), to: b };
    })
    .filter((p) => p.to - p.from >= c.minPhaseMin * MIN);
  if (!windows.length) return [];
  const ahead = motifs.find((m) => m.role === 'anticipation');
  const order = [...motifs.filter((m) => m.role === 'day'), ...motifs.filter((m) => m.role === 'memory')];
  return windows.map((w, j) => {
    if (ahead && (j === windows.length - 1 || !order.length)) return { ...w, motif: ahead.motif };
    const n = ahead ? windows.length - 1 : windows.length;
    return { ...w, motif: order[Math.min(order.length - 1, Math.floor((j * order.length) / Math.max(1, n)))].motif };
  });
}

const asleepIn = (condition: HealthCondition, modifiers: HealthModifier[]) => condition === 'sleeping' || modifiers.includes('sleeping');

// What was really dreamt: the phases (up to now) the tree slept through with trustworthy data. A phase
// asleep under a stress (dry soil, cold) still dreams, restlessly. No data: no dream.
export function dreamOutcome(r: DreamRecord, episodes: BehaviourEpisode[], now: number): DreamOutcome {
  const dreamt = new Set<DreamMotif>();
  let phases = 0;
  let restless = 0;
  for (const p of r.phases) {
    const mid = (p.from + p.to) / 2;
    if (mid > now) continue;
    const e = episodes.find((x) => x.startedAt <= mid && mid < (x.endedAt ?? x.lastSeenAt));
    if (!e || e.condition === 'sensor_uncertain' || !asleepIn(e.condition, e.modifiers)) continue;
    const end = e.endedAt ?? e.lastSeenAt;
    if (e.unobservedMs / Math.max(1, end - e.startedAt) > 0.5) continue;
    phases++;
    if (e.condition !== 'sleeping') restless++;
    dreamt.add(p.motif);
  }
  return { dreamt: r.motifs.map((m) => m.motif).filter((m) => dreamt.has(m)), phases, of: r.phases.length, restless: phases > 0 && restless * 2 >= phases, finishedAt: now };
}

// Nights in a row (up to and including `night`) that dreamt this motif
function streak(past: DreamRecord[], night: string, motif: DreamMotif): number {
  const by = new Map(past.map((r) => [r.night, r]));
  let n = 0;
  for (let key = night, guard = 0; guard < 60; guard++) {
    const r = by.get(key);
    if (!r?.outcome?.dreamt.includes(motif)) break;
    n++;
    key = dayKey(addDays(startOfDay(r.startsAt), -1)); // the evening before
  }
  return n;
}

export interface DreamInput extends Omit<DreamDayInput, 'night' | 'dayStart'> {
  condition: HealthCondition;
  modifiers: HealthModifier[];
  location: Location;
  past: DreamRecord[]; // the stored nights (the last weeks), any order
  now: number;
}

// The dream right now, last night's for the morning line, and what the collector should store
export function evaluateDreams(i: DreamInput): DreamState {
  const c = C();
  const { day, running, last } = nightsAround(i.now, i.location);
  const uncertain = i.condition === 'sensor_uncertain' || i.modifiers.includes('sensor_uncertain');
  const asleep = !uncertain && asleepIn(i.condition, i.modifiers);
  const restless = asleep && i.condition !== 'sleeping';
  const stored = new Map(i.past.map((r) => [r.night, r]));

  // Tonight: composed once as the night begins (the collector stores it; later evaluations read it back)
  let tonight = running ? stored.get(running.key) ?? null : null;
  let compose: DreamRecord | null = null;
  if (running && !tonight) {
    tonight = compose = composeDream({ ...i, night: running, dayStart: day });
  }

  // Last night: its outcome once over (stored at dawn)
  let lastRec = stored.get(last.key) ?? null;
  let finish: DreamState['finish'] = null;
  if (lastRec && !lastRec.outcome) {
    const outcome = dreamOutcome(lastRec, i.episodes, i.now);
    finish = { night: lastRec.night, outcome };
    lastRec = { ...lastRec, outcome };
  }
  let lastNight: DreamState['lastNight'] = null;
  if (lastRec?.outcome) {
    const o = lastRec.outcome;
    const top = lastRec.motifs.find((m) => o.dreamt.includes(m.motif) && m.role !== 'anticipation') ?? lastRec.motifs.find((m) => o.dreamt.includes(m.motif)) ?? null;
    const told = top && !o.restless && top.salience >= c.toldMin ? top.motif : null;
    const pastWith = [...i.past.filter((r) => r.night !== lastRec!.night), lastRec];
    lastNight = { key: lastRec.night, told, again: told ? streak(pastWith, lastRec.night, told) : 0, restless: o.restless, dreamt: o.dreamt };
  }

  // Right now: deep sleep, or one of tonight's dreaming phases (none when awake or without trustworthy data)
  let phase: DreamState['phase'] = 'none';
  let motif: DreamMotif | null = null;
  let phaseEndsAt: number | null = null;
  if (running && asleep && tonight) {
    const p = tonight.phases.find((x) => x.from <= i.now && i.now < x.to);
    if (p) {
      phase = 'dreaming';
      motif = p.motif;
      phaseEndsAt = p.to;
    } else {
      phase = 'deep';
      phaseEndsAt = tonight.phases.find((x) => x.from > i.now)?.from ?? running.endsAt;
    }
  } else if (running && asleep) phase = 'deep';

  const memory = motifMemory(i.past, running?.key ?? dayKey(addDays(day, 1)), i.now);
  const recurring = [...memory]
    .filter(([m, v]) => WORRIES.includes(m) && v.strength >= c.recurrence.min)
    .map(([m, v]) => ({ motif: m, strength: r2(v.strength), nights: v.nights }))
    .sort((a, b) => b.strength - a.strength);

  const why = !running
    ? lastNight
      ? `Last night: ${lastNight.dreamt.length ? lastNight.dreamt.join(', ') : 'dreamless'}${lastNight.restless ? ' (restless)' : ''}`
      : 'Awake: no dream'
    : uncertain
    ? 'No trustworthy data: a dreamless night'
    : !asleep
    ? 'Awake in the night: no dream'
    : !tonight?.motifs.length
    ? 'A deep, dreamless night (nothing weighed enough)'
    : `${phase === 'dreaming' ? `Dreaming of ${motif!.replace('_', ' ')}` : 'Deep sleep'}${restless ? ', restless' : ''}. Tonight: ${tonight.motifs.map((m) => `${m.motif} ${m.salience} (${m.why})`).join(', ')}${tonight.cast.length ? `; beside it: ${tonight.cast.join(', ')}` : ''}`;

  return {
    night: running ? { key: running.key, startsAt: running.startsAt, endsAt: running.endsAt } : null,
    asleep,
    phase,
    motif,
    phaseEndsAt,
    restless,
    cast: tonight?.cast ?? [],
    tonight,
    lastNight,
    recurring,
    compose,
    finish,
    why,
  };
}

// ---- The diary: the nights as they were stored ----


const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

// One line per finished night with a dream, at its end (sunrise); a motif back for 3+ nights in a row, a
// restless night, Lucy beside it. Nothing for a dreamless night (no data, or nothing weighed enough).
export function dreamDiary(records: DreamRecord[], since: number, now: number): DiaryItem[] {
  const items: DiaryItem[] = [];
  for (const r of records) {
    const o = r.outcome;
    if (!o || o.finishedAt > now || r.endsAt < since || !o.dreamt.length) continue;
    const top = r.motifs.find((m) => m.motif === o.dreamt[0])!;
    const details = [top.why, r.cast.includes('lucy') ? 'Lucy slept by the pot' : null, o.restless ? 'a restless night' : null].filter(Boolean);
    items.push({ at: r.endsAt, kind: 'dream', dream: o.restless ? 'restless' : 'dreamt', title: `${o.restless ? 'A restless night. Dreamt' : 'Dreamt'} of ${list(o.dreamt.map((m) => DREAM_WORDS[m]))}`, detail: details.join(' · ') });
    for (const m of o.dreamt) {
      const n = streak(records, r.night, m);
      if (n >= 3 && WORRIES.includes(m)) items.push({ at: r.endsAt + 1, kind: 'dream', dream: 'recurring', title: `${DREAM_WORDS[m][0].toUpperCase()}${DREAM_WORDS[m].slice(1)} came back in my dreams`, detail: `${n} nights in a row` });
    }
  }
  return items;
}

// Phases as the developer panel shows them
export const phaseText = (p: DreamPhase) => `${hhmm(p.from)}–${hhmm(p.to)} ${p.motif.replace('_', ' ')}`;

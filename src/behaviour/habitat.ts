import { APP_CONFIG } from '../config/appConfig';
import type { HealthCondition, HealthModifier } from '../health/healthTypes';
import { CONDITION_LABELS } from '../health/labels';
import { CONDITION_SEVERITY } from '../health/statePriority';
import type { BehaviourEpisode, DiaryItem, Interaction } from '../history/historyTypes';
import { seasonState } from '../perception/season';
import type { SpeciesProfile } from '../species';
import { sunState } from '../perception/sun';
import type { OutsideSky, PressureTendency } from '../telemetry/outsideWeather';
import type { DreyState, HabitatState, HabitatVisit, ReactionKind, SquirrelMemory, SquirrelStage, SquirrelTraces, VisitSpot } from './behaviourTypes';
import { stableVariant } from './speech';
import { dayKey, DAY, HOUR, hourFraction, hourOf as hourOfDay, MIN, hhmm, startOfDay } from '../lib/time';

// Habitat: how welcoming the tree has been as a place to be, and whether a visitor (the squirrel) is
// here right now. Evidence class "art": wild animals don't read soil probes, but they do behave like
// latches: slow to trust a place, quick to leave it. Derived from the stored episodes (nothing new is
// persisted), deterministic, and never read by health, mood, energy or speech.
//
//   comfortable / thriving (primary)            rises toward 1 (time constant riseHours, in OBSERVED time)
//   a stress (primary)                          falls toward 0 (fallHours by severity: critical leaves fast)
//   sleeping, recovering, very bright, unsure   held (nothing learned, nothing lost)
//   gaps between episodes, unobserved time      held
//
// A Schmitt trigger (enter / exit) on that value says whether visitors come at all. Who is visible right
// now then depends on the current state: calm → visiting; a passing mild/moderate stress → hiding in the
// leaves; critical → gone. Visits fall in deterministic slots of the day, so a refresh never reshuffles.
//
// On top of that (all derived, all art):
// - The DREY: welcoming time builds a nest in the crown over ~2 weeks; time not welcoming takes it apart
//   over days. With a built drey the squirrel sleeps in it at night.
// - SHELTER: rain, a storm or snow OUTSIDE (context) sends a visiting squirrel into the leaves; after rain
//   it comes out and shakes off. The habitat value never sees the weather.
// - CARE: after a needed watering on a calm, welcoming tree it comes to drink at the pot rim; after a
//   pruning it inspects the cut. One answer per care event; watering on wet soil gets none.
// - DIARY: visits, coming back after an absence, staying away, the drey built or abandoned.
//
// The squirrel is an individual, not a dice roll (all derived, all art):
// - TRUST in the place grows with welcoming time and gives its stages: traces (a nibbled leaf, a tail at
//   the pot: signs, no animal) → peeking (short peeks from the leaves, no play) → visiting → settled
//   (longer visits, it ventures down to the trunk and the pot rim). When the place stops being welcoming
//   trust breaks, and for a while it rebuilds slower: it comes back warily, peeking first again.
// - HABITS from its own past visits: a usual hour (visits gather around it) and a favourite spot. They are
//   taken from the habit-free visits, so a habit never feeds on itself.
// - BOLDNESS from trust and from play (petting during its visits). It only changes how it plays, never
//   whether or when it comes: more petting never brings more visits.


const WELCOMING: HealthCondition[] = ['comfortable', 'thriving'];
const HELD: HealthCondition[] = ['sleeping', 'recovering', 'very_bright', 'sensor_uncertain'];
const SHELTER_SKIES: OutsideSky[] = ['rain', 'heavy_rain', 'thunderstorm', 'snow'];
const DRINKS_AFTER: ReactionKind[] = ['watering_relief', 'watering_thanks', 'watering_gentle_ack'];

type Drift = { toward: 0 | 1; tauHours: number } | null;

function drift(condition: HealthCondition): Drift {
  const cfg = APP_CONFIG.habitat;
  if (HELD.includes(condition)) return null;
  if (condition === 'thriving') return { toward: 1, tauHours: cfg.riseHours.thriving };
  if (condition === 'comfortable') return { toward: 1, tauHours: cfg.riseHours.comfortable };
  const sev = CONDITION_SEVERITY[condition];
  return { toward: 0, tauHours: sev === 'critical' ? cfg.fallHours.critical : sev === 'moderate' ? cfg.fallHours.moderate : cfg.fallHours.mild };
}

export interface HabitatInput {
  episodes: BehaviourEpisode[]; // any order (the open one included)
  condition: HealthCondition; // current primary
  modifiers: HealthModifier[];
  isDay: boolean; // sun up: squirrels are diurnal
  season: { id: string; energy: number }; // blended seasonal energy: fewer visits at winter rest
  now: number;
  outside?: { sky: OutsideSky; rainEndedAt: number | null; pressureTendency?: PressureTendency | null } | null; // outside weather (context: shelter only)
  reaction?: { kind: ReactionKind; eventId: number; at: number; seasonal: string | null } | null; // recent care
  // Its memory of past visits: the tree's location (day and night of past slots; clock window without),
  // the season through the last weeks, and the petting sessions (play during its visits → boldness only)
  location?: { latitude: number | null; longitude: number | null };
  seasonAt?: (t: number) => { id: string; energy: number };
  interactions?: Interaction[];
}

// The blended seasonal energy at any time (the behaviour engine's, for past slots and the diary)
export const seasonEnergyAt = (latitude: number | null, species: SpeciesProfile) => (t: number) => {
  const s = seasonState(t, latitude);
  const rule = species.seasons[s.id];
  const other = s.blend ? species.seasons[s.blend.with] : null;
  const energy = other ? rule.energy + (other.energy - rule.energy) * s.blend!.amount : rule.energy;
  return { id: s.id, energy: Math.round(energy * 100) / 100 };
};

export type HabitatChange = { at: number; kind: 'welcoming' | 'left' | 'drey_started' | 'drey_built' | 'drey_gone' | 'traces' | 'wary_return' | 'settled' };

// ---- Shared by every wanderer (squirrel, dragonfly): one habitat mechanism, different inputs and numbers ----
// Exponential drift toward 0 or 1 over observed time.
export const driftToward = (value: number, toward: 0 | 1, dtHours: number, tauHours: number) => toward + (value - toward) * Math.exp(-dtHours / tauHours);
// Schmitt trigger: switches on above `enter`, off below `exit`, holds in between.
export const schmitt = (active: boolean, value: number, enter: number, exit: number) => (!active && value >= enter ? true : active && value < exit ? false : active);
export const dayKeyOf = dayKey; // the tree's day (its timezone)
// The deterministic visit window of the slot covering `now` (null: no visit in this slot, or not right now).
// `prefix` keeps each species' slots independent; the same day + slot always rolls the same.
export function slotWindow(prefix: string, now: number, slotMinutes: number, chance: number, visitMinutes: { min: number; max: number }) {
  const w = slotPlan(prefix, now, slotMinutes, chance, visitMinutes);
  return w && now >= w.startedAt && now < w.endsAt ? w : null;
}
// The visit planned for the slot covering `t`, wherever `t` falls in it (null: this slot holds none)
export function slotPlan(prefix: string, t: number, slotMinutes: number, chance: number, visitMinutes: { min: number; max: number }) {
  const slotMs = slotMinutes * MIN;
  const dayStart = startOfDay(t); // the tree's day
  const dayKey = dayKeyOf(t);
  const slot = Math.floor((t - dayStart) / slotMs);
  const roll = (salt: string, n = 1000) => stableVariant(`${prefix}:${dayKey}:${slot}:${salt}`, n) / n;
  if (roll('visit') >= chance) return null;
  const minutes = visitMinutes.min + Math.round(roll('len') * (visitMinutes.max - visitMinutes.min));
  const slotStart = dayStart + slot * slotMs;
  const startedAt = slotStart + Math.round(roll('offset') * Math.max(0, slotMs - minutes * MIN));
  return { id: `${dayKey}:${slot}`, dayKey, slot, slotStart, startedAt, endsAt: startedAt + minutes * MIN, roll };
}

// Replays the episodes into the habitat value, its latch and the drey. `trace` keeps the trajectory (for
// the diary); without it only the end state is returned.
export function replayHabitat(episodes: BehaviourEpisode[], now: number, trace = false) {
  const cfg = APP_CONFIG.habitat;
  const D = cfg.drey;
  const from = now - cfg.replayDays * DAY;
  const statsFrom = now - cfg.windowDays * DAY;
  let value = 0;
  let welcoming = false;
  let drey = 0;
  let dreyStage: DreyState['stage'] = 'none';
  let builtAt: number | null = null;
  let calmHours = 0;
  let stressHours = 0;
  let lastChangeAt: number | null = null;
  // The squirrel's trust in the place and its stage (see the header)
  const T = cfg.trust;
  let trust = 0;
  let brokenAt: number | null = null;
  let rising = false; // the value's last drift was toward 1
  let traces = false;
  let confident = false; // past the peeking stage
  let settled = false;
  let stage: SquirrelStage = 'none';
  const changes: HabitatChange[] = [];
  const points: { t: number; value: number; welcoming: boolean; trust: number; stage: SquirrelStage }[] = [];
  const sorted = [...episodes].filter((e) => (e.endedAt ?? now) > from && e.startedAt <= now).sort((a, b) => a.startedAt - b.startedAt);
  for (const e of sorted) {
    const d = drift(e.condition);
    const start = Math.max(e.startedAt, from);
    const end = Math.min(e.endedAt ?? now, now);
    const full = Math.max(1, Math.min(e.endedAt ?? now, now) - e.startedAt);
    const span = end - start;
    if (span <= 0) continue;
    // Unobserved time inside the episode counts for nothing (spread evenly: we don't know where it fell)
    const observed = span * Math.max(0, 1 - e.unobservedMs / full);
    const hours = observed / HOUR;
    if (d && end > statsFrom) {
      const share = (end - Math.max(start, statsFrom)) / span;
      if (d.toward === 1) calmHours += hours * share;
      else stressHours += hours * share;
    }
    // Walk in steps (≤ 1 h observed each) so the latches see their crossings
    const steps = Math.max(1, Math.ceil(hours));
    for (let i = 1; i <= steps; i++) {
      const t = start + (span * i) / steps;
      if (d) {
        value = driftToward(value, d.toward, hours / steps, d.tauHours);
        rising = d.toward === 1;
      }
      const was = welcoming;
      welcoming = schmitt(welcoming, value, cfg.enter, cfg.exit);
      if (was !== welcoming) {
        lastChangeAt = t;
        changes.push({ at: t, kind: welcoming ? 'welcoming' : 'left' });
        if (welcoming && brokenAt !== null) changes.push({ at: t, kind: 'wary_return' });
        if (!welcoming) {
          // Trust breaks: it has to be earned again, peeking first
          trust *= T.breakFactor;
          brokenAt = t;
          confident = false;
          settled = false;
        }
      }
      // Trust grows with welcoming time (held time included, like the drey), slower for a while after a
      // break; without a welcoming place it fades slowly
      const wary = brokenAt !== null && t - brokenAt < T.waryDays * DAY;
      trust = welcoming ? driftToward(trust, 1, hours / steps, T.riseDays * 24 * (wary ? T.waryFactor : 1)) : driftToward(trust, 0, hours / steps, T.fallDays * 24);
      traces = !welcoming && rising && schmitt(traces, value, T.tracesFrom, T.tracesExit);
      confident = schmitt(confident, trust, T.peekUntil, T.peekExit);
      settled = schmitt(settled, trust, T.settledFrom, T.settledExit);
      const before0 = stage;
      stage = welcoming ? (settled ? 'settled' : confident ? 'visiting' : 'peeking') : traces ? 'traces' : 'none';
      if (stage !== before0 && (stage === 'traces' || stage === 'settled')) changes.push({ at: t, kind: stage });
      // The drey grows with welcoming time (held time included: a sleeping tree is still a home)
      drey = driftToward(drey, welcoming ? 1 : 0, hours / steps, (welcoming ? D.riseDays : D.fallDays) * 24);
      const before = dreyStage;
      if (dreyStage === 'none' && drey >= D.startedEnter) dreyStage = 'started';
      if (dreyStage === 'started' && drey >= D.builtEnter) dreyStage = 'built';
      else if (dreyStage === 'built' && drey < D.builtExit) dreyStage = 'started';
      if (dreyStage === 'started' && drey < D.startedExit) dreyStage = 'none';
      if (dreyStage !== before) {
        if (dreyStage === 'built') builtAt = t;
        if (dreyStage === 'started' && before === 'none') changes.push({ at: t, kind: 'drey_started' });
        if (dreyStage === 'built') changes.push({ at: t, kind: 'drey_built' });
        if (dreyStage === 'none' && builtAt !== null) changes.push({ at: t, kind: 'drey_gone' });
      }
      if (trace) points.push({ t, value, welcoming, trust, stage });
    }
  }
  return {
    value: round2(value),
    welcoming,
    calmHours: round1(calmHours),
    stressHours: round1(stressHours),
    lastChangeAt,
    drey: { value: round2(drey), stage: dreyStage, builtAt: dreyStage === 'built' ? builtAt : null } as DreyState,
    trust: round2(trust),
    stage,
    brokenAt,
    changes,
    points,
  };
}

const SPOTS: VisitSpot[] = ['left_branch', 'right_branch', 'crown'];
const SETTLED_SPOTS: VisitSpot[] = [...SPOTS, 'trunk', 'pot_rim']; // at home in the tree, it ventures lower
const TRACES: SquirrelTraces[] = ['nibbled_leaf', 'tail_at_pot'];

// ---- The squirrel's habits: from its own past visits ----
export interface SquirrelHabits {
  usualHour: number | null; // centre of the 2-hour band it comes in most (recency-weighted)
  favouriteSpot: VisitSpot | null;
  count: number; // past visits remembered
}
const NO_HABITS: SquirrelHabits = { usualHour: null, favouriteSpot: null, count: 0 };
const hourOf = hourFraction;

// Habits as of `at`, from the habit-free visits before it (oldest first). Its usual hour is the band its
// visits fell in most: an individual quirk of its history, not a rule.
export function habitsFrom(visits: { startedAt: number; spot: VisitSpot }[], at: number): SquirrelHabits {
  const H = APP_CONFIG.habitat.habits;
  const bands = new Array<number>(12).fill(0);
  const spots = new Map<VisitSpot, number>();
  let count = 0;
  for (const v of visits) {
    if (v.startedAt >= at) break;
    const w = Math.exp(-(at - v.startedAt) / (H.recencyDays * DAY));
    bands[Math.floor(hourOf(v.startedAt) / 2)] += w;
    spots.set(v.spot, (spots.get(v.spot) ?? 0) + w);
    count++;
  }
  if (count < H.minVisits) return { ...NO_HABITS, count };
  let best = 0;
  for (let i = 1; i < bands.length; i++) if (bands[i] > bands[best]) best = i;
  let fav: VisitSpot | null = null;
  for (const [s, w] of spots) if (fav === null || w > spots.get(fav)!) fav = s;
  return { usualHour: best * 2 + 1, favouriteSpot: fav, count };
}

// Busiest in the morning and late afternoon, quieter at midday; fewer visits at winter rest
const chanceScaleAt = (now: number, seasonEnergy: number) => {
  const h = hourOfDay(now);
  return (h < 10 || h >= 16 ? 1.25 : 0.75) * Math.min(1, seasonEnergy);
};

// The visit planned for the slot covering `t` (wherever `t` falls in it). A pure function of the day, the
// slot, the habitat value, its stage, its habits and its trust. Without habits, at the visiting stage, it is
// exactly the plain slot visit.
function squirrelPlan(t: number, value: number, stage: SquirrelStage, habits: SquirrelHabits, trust: number, season: { id: string; energy: number }): HabitatVisit | null {
  const cfg = APP_CONFIG.habitat;
  const H = cfg.habits;
  const slotMs = cfg.slotMinutes * MIN;
  const slotStart = t - ((t - startOfDay(t)) % slotMs);
  const f = clamp((value - cfg.exit) / (1 - cfg.exit), 0, 1);
  // Its usual hour: visits gather around it
  const mid = hourOf(slotStart) + cfg.slotMinutes / 120;
  const habit = habits.usualHour === null ? 1 : Math.abs(mid - habits.usualHour) <= 1 ? H.nearHour : H.otherHours;
  const chance = (cfg.visitChance.min + (cfg.visitChance.max - cfg.visitChance.min) * f) * chanceScaleAt(slotStart, season.energy) * habit;
  const len = stage === 'peeking' ? cfg.trust.peekLength : stage === 'settled' ? cfg.trust.settledLength : 1;
  const w = slotPlan('habitat', t, cfg.slotMinutes, chance, { min: Math.max(2, Math.round(cfg.visitMinutes.min * len)), max: Math.round(cfg.visitMinutes.max * len) });
  if (!w) return null;
  const { dayKey, slot } = w;
  const pool = stage === 'settled' ? SETTLED_SPOTS : SPOTS;
  const rolled = pool[stableVariant(`habitat:${dayKey}:${slot}:spot`, pool.length)];
  const fav = !!habits.favouriteSpot && pool.includes(habits.favouriteSpot) && w.roll('fav') < H.favouriteBase + trust * H.favouritePerTrust;
  return {
    kind: 'squirrel',
    id: w.id,
    startedAt: w.startedAt,
    endsAt: w.endsAt,
    spot: fav ? habits.favouriteSpot! : rolled,
    // Autumn: caching for the cold months
    carrying: season.id === 'autumn' ? 'nut' : null,
    cause: 'slot',
    action: null,
  };
}
function squirrelVisitAt(now: number, value: number, stage: SquirrelStage, habits: SquirrelHabits, trust: number, season: { id: string; energy: number }) {
  const v = squirrelPlan(now, value, stage, habits, trust, season);
  return v && now >= v.startedAt && now < v.endsAt ? v : null;
}

// Who is out right now from the tree's state alone (shared by the live view and the diary)
function basePresence(welcoming: boolean, value: number, condition: HealthCondition, modifiers: HealthModifier[], isDay: boolean): { presence: 'none' | 'visiting' | 'hiding' | 'night'; why: string } {
  const sev = CONDITION_SEVERITY[condition];
  if (condition === 'sensor_uncertain' || modifiers.includes('sensor_uncertain')) return { presence: 'none', why: 'no trustworthy data: nobody shown (never a falsely healthy tree)' };
  if (!welcoming) return { presence: 'none', why: value > 0 ? `not welcoming yet (${value} < ${APP_CONFIG.habitat.enter})` : 'no calm history yet' };
  if (!isDay || condition === 'sleeping' || modifiers.includes('sleeping')) return { presence: 'night', why: 'night' };
  if (sev === 'critical' || condition === 'multiple_stress') return { presence: 'none', why: `${condition.replace(/_/g, ' ')}: visitors have fled` };
  if (WELCOMING.includes(condition) && !modifiers.some((m) => CONDITION_SEVERITY[m] === 'critical')) return { presence: 'visiting', why: 'welcoming and calm: visits come now and then' };
  return { presence: 'hiding', why: `${condition.replace(/_/g, ' ')}: tucked into the leaves, waiting it out` };
}

const dayTester = (location?: { latitude: number | null; longitude: number | null }) => (t: number) => sunState(t, location?.latitude ?? null, location?.longitude ?? null, 15).isDay;

// ---- Its life over the last weeks: every slot replayed (the same slots as the live view) ----
export interface PastVisit {
  startedAt: number;
  endsAt: number;
  spot: VisitSpot;
  stage: SquirrelStage;
  presence: 'visiting' | 'hiding';
}
export function squirrelLife(
  episodes: BehaviourEpisode[],
  now: number,
  r: ReturnType<typeof replayHabitat>,
  isDayAt: (t: number) => boolean,
  seasonAt: (t: number) => { id: string; energy: number }
) {
  const cfg = APP_CONFIG.habitat;
  const slotMs = cfg.slotMinutes * MIN;
  const sorted = [...episodes].sort((a, b) => a.startedAt - b.startedAt);
  let ei = 0;
  const episodeAt = (t: number) => {
    while (ei + 1 < sorted.length && sorted[ei + 1].startedAt <= t) ei++;
    const e = sorted[ei];
    return e && e.startedAt <= t && t < (e.endedAt ?? now) ? e : null;
  };
  let pi = 0;
  const stateAt = (t: number) => {
    while (pi + 1 < r.points.length && r.points[pi + 1].t <= t) pi++;
    const p = r.points[pi];
    return p && p.t <= t ? p : null;
  };
  const base: { startedAt: number; spot: VisitSpot }[] = []; // habit-free: what its habits are made of
  const visits: PastVisit[] = [];
  let day = -1;
  let habits = NO_HABITS;
  for (let t = Math.ceil((now - cfg.replayDays * DAY) / slotMs) * slotMs; t <= now; t += slotMs) {
    if (startOfDay(t) !== day) {
      day = startOfDay(t);
      habits = habitsFrom(base, day); // a day's habits come from the days before it
    }
    const s = stateAt(t);
    const ep = episodeAt(t);
    if (!s || !ep || !s.welcoming) continue;
    const p = basePresence(true, s.value, ep.condition, [], isDayAt(t)).presence;
    if (p === 'none' || p === 'night') continue;
    const season = seasonAt(t);
    const b = squirrelPlan(t, s.value, 'visiting', NO_HABITS, 0, season);
    if (b && b.startedAt <= now) base.push({ startedAt: b.startedAt, spot: b.spot });
    const v = squirrelPlan(t, s.value, s.stage, habits, s.trust, season);
    if (v && v.startedAt <= now) visits.push({ startedAt: v.startedAt, endsAt: v.endsAt, spot: v.spot, stage: s.stage, presence: p });
  }
  return { visits, habits: day === startOfDay(now) ? habits : habitsFrom(base, startOfDay(now)) };
}

// Boldness: trust, and play (petting sessions during its visits, recency-weighted). Only how it plays.
function boldnessOf(trust: number, visits: PastVisit[], interactions: Interaction[], now: number) {
  const H = APP_CONFIG.habitat.habits;
  let play = 0;
  for (const i of interactions) {
    if (i.kind !== 'pet') continue;
    if (visits.some((v) => v.presence === 'visiting' && v.stage !== 'peeking' && i.startedAt < v.endsAt && i.endedAt > v.startedAt)) play += Math.exp(-(now - i.endedAt) / (H.recencyDays * DAY));
  }
  return round2(clamp(0.5 * trust + (0.5 * play) / (play + H.playSessions), 0, 1));
}

export function evaluateHabitat({ episodes, condition, modifiers, isDay, season, now, outside = null, reaction = null, location, seasonAt, interactions = [] }: HabitatInput): HabitatState {
  const cfg = APP_CONFIG.habitat;
  const r = replayHabitat(episodes, now, true);
  const life = squirrelLife(episodes, now, r, dayTester(location), seasonAt ?? (() => season));
  const memory: SquirrelMemory = {
    trust: r.trust,
    stage: r.stage,
    brokenAt: r.brokenAt,
    usualHour: life.habits.usualHour,
    favouriteSpot: life.habits.favouriteSpot,
    boldness: boldnessOf(r.trust, life.visits, interactions, now),
    pastVisits: life.habits.count,
  };
  const base = basePresence(r.welcoming, r.value, condition, modifiers, isDay);
  let presence: HabitatState['presence'] = 'none';
  let visit: HabitatVisit | null = null;
  let why = base.why;
  const dayKey = dayKeyOf(now);

  if (base.presence === 'night') {
    // Asleep in its drey, if the tree has been a home long enough to build one
    if (r.drey.stage === 'built' && CONDITION_SEVERITY[condition] !== 'critical' && condition !== 'multiple_stress') {
      presence = 'sleeping';
      visit = { kind: 'squirrel', id: `drey:${dayKey}`, startedAt: now, endsAt: now + HOUR, spot: 'crown', carrying: null, cause: 'drey', action: null };
      why = 'night: asleep in its drey';
    } else {
      why = r.drey.stage === 'built' ? 'night: the drey is empty while the tree struggles' : 'night: asleep somewhere else (no drey here yet)';
    }
  } else if (base.presence !== 'none') {
    presence = base.presence;
    const peeking = r.stage === 'peeking';
    // Answers to care: a needed watering → drinks at the pot rim; a pruning → inspects the cut. Not while
    // it only peeks: it doesn't trust the place enough yet to come down
    const age = reaction ? now - reaction.at : Infinity;
    const careMin = !reaction
      ? 0
      : DRINKS_AFTER.includes(reaction.kind)
      ? cfg.careVisitMinutes.drinking
      : reaction.kind === 'care_pruning'
      ? reaction.seasonal === 'resting_prune'
        ? cfg.careVisitMinutes.inspectingOffSeason
        : cfg.careVisitMinutes.inspecting
      : 0;
    if (presence === 'visiting' && !peeking && reaction && careMin > 0 && age >= 0 && age < careMin * MIN) {
      const drinking = DRINKS_AFTER.includes(reaction.kind);
      visit = {
        kind: 'squirrel',
        id: `care:${reaction.eventId}`,
        startedAt: reaction.at,
        endsAt: reaction.at + careMin * MIN,
        spot: drinking ? 'pot_rim' : 'left_branch',
        carrying: null,
        cause: 'care',
        action: drinking ? 'drinking' : 'inspecting',
      };
      why = drinking ? 'came down to drink after the watering' : 'came to inspect the pruning';
    } else {
      visit = squirrelVisitAt(now, r.value, r.stage, life.habits, r.trust, season);
      if (visit && presence === 'visiting' && peeking) {
        presence = 'peeking';
        why = r.brokenAt !== null ? 'back, but warily: only peeking from the leaves' : 'new here: only peeking from the leaves';
      } else if (visit && presence === 'visiting' && r.stage === 'settled') why = 'at home in the tree';
      if (!visit) why += ' (none right now)';
    }
    // Shelter: rain, a storm or snow outside sends it into the leaves (the habitat value never sees weather).
    // A fast-falling barometer too, before the weather arrives (art: animals seem to feel it)
    const wet = !!outside && SHELTER_SKIES.includes(outside.sky);
    if (visit && outside && (wet || outside.pressureTendency === 'falling_fast')) {
      if (presence === 'visiting' || presence === 'peeking')
        why = wet ? `sheltering from the ${outside.sky === 'snow' ? 'snow' : outside.sky === 'thunderstorm' ? 'storm' : 'rain'} outside` : 'tucked into the leaves: the air feels like weather coming';
      presence = 'hiding';
      visit = { ...visit, action: null };
    } else if (visit && presence === 'visiting' && !visit.action && outside?.rainEndedAt != null && now - outside.rainEndedAt < cfg.shakeOffAfterRainMs) {
      visit = { ...visit, action: 'shake_off' };
      why = 'out again after the rain: shaking off';
    }
  }
  // Not here yet, but signs of it (the same sign all day)
  const uncertain = condition === 'sensor_uncertain' || modifiers.includes('sensor_uncertain');
  const traces = r.stage === 'traces' && !uncertain ? TRACES[stableVariant(`habitat:traces:${dayKey}`, TRACES.length)] : null;
  if (traces) why = `not here yet, but signs of it: ${traces.replace(/_/g, ' ')}`;

  const today = life.visits.filter((v) => v.presence === 'visiting' && v.startedAt >= startOfDay(now) && v.endsAt <= now);
  return {
    value: r.value,
    welcoming: r.welcoming,
    presence: visit ? presence : 'none',
    visit,
    traces,
    memory,
    drey: r.drey,
    visitsToday: r.welcoming ? { count: today.length, firstAt: today[0]?.startedAt ?? null } : { count: 0, firstAt: null },
    calmHours14d: r.calmHours,
    stressHours14d: r.stressHours,
    lastChangeAt: r.lastChangeAt,
    why,
  };
}

// ---- Diary: what the visitors did, derived from history (nothing stored) ----

export interface HabitatDiaryInput {
  episodes: BehaviourEpisode[];
  now: number;
  days: number; // diary range
  location: { latitude: number | null; longitude: number | null };
  seasonAt: (t: number) => { id: string; energy: number }; // the same blended season the behaviour uses
  windowsOut?: { from: number; to: number }[]; // filled with the visit windows (for the encounter diary)
}

const ABSENCE_DAYS = 7;
const TRACE_WORDS: Record<SquirrelTraces, string> = { nibbled_leaf: 'a nibbled leaf', tail_at_pot: 'a tail by the pot' };

export function habitatDiary({ episodes, now, days, location, seasonAt, windowsOut }: HabitatDiaryInput): DiaryItem[] {
  const r = replayHabitat(episodes, now, true);
  const since = now - days * DAY;
  const sorted = [...episodes].sort((a, b) => a.startedAt - b.startedAt);
  const episodeAt = (t: number) => sorted.find((e) => e.startedAt <= t && t < (e.endedAt ?? now)) ?? null;

  // Visits per day: the same life the live view replays (stages and habits included)
  const life = squirrelLife(episodes, now, r, dayTester(location), seasonAt);
  const visitsByDay = new Map<string, { first: number; count: number; peeks: boolean }>();
  for (const v of life.visits) {
    windowsOut?.push({ from: v.startedAt, to: v.endsAt });
    const key = dayKeyOf(v.startedAt);
    const d = visitsByDay.get(key);
    if (d) d.count++;
    else visitsByDay.set(key, { first: v.startedAt, count: 1, peeks: v.stage === 'peeking' });
  }

  const items: DiaryItem[] = [];
  let lastVisitDay: number | null = null;
  for (const { first, count, peeks } of [...visitsByDay.values()].sort((a, b) => a.first - b.first)) {
    const dayStart = startOfDay(first);
    const away = lastVisitDay !== null ? Math.round((dayStart - lastVisitDay) / DAY) : null;
    if (first >= since) {
      if (away !== null && away >= ABSENCE_DAYS) items.push({ at: first, kind: 'habitat', title: 'The squirrel came back', detail: `after ${away} days away`, habitat: 'returned' });
      if (peeks) items.push({ at: first, kind: 'habitat', title: 'A squirrel peeked out from the leaves', detail: `${count} peek${count > 1 ? 's' : ''} · first at ${hhmm(first)}`, habitat: 'peek' });
      else items.push({ at: first, kind: 'habitat', title: 'A squirrel visited', detail: `${count} visit${count > 1 ? 's' : ''} · first at ${hhmm(first)}`, habitat: 'visit' });
    }
    lastVisitDay = dayStart;
  }
  for (const c of r.changes) {
    if (c.at < since) continue;
    if (c.kind === 'left') {
      const ep = episodeAt(c.at - 1);
      items.push({ at: c.at, kind: 'habitat', title: 'The squirrels stayed away', detail: ep ? `while ${CONDITION_LABELS[ep.condition].toLowerCase()}` : undefined, habitat: 'left' });
    }
    if (c.kind === 'traces') items.push({ at: c.at, kind: 'habitat', title: `Signs of a squirrel: ${TRACE_WORDS[TRACES[stableVariant(`habitat:traces:${dayKeyOf(c.at)}`, TRACES.length)]]}`, detail: 'not here yet, but it has found the tree', habitat: 'traces' });
    if (c.kind === 'wary_return') items.push({ at: c.at, kind: 'habitat', title: 'The squirrel came back, warily', detail: 'peeking first: its trust has to grow again', habitat: 'wary' });
    if (c.kind === 'settled') items.push({ at: c.at, kind: 'habitat', title: 'The squirrel has made itself at home', detail: 'longer visits, down to the trunk and the pot', habitat: 'settled' });
    if (c.kind === 'drey_built') items.push({ at: c.at, kind: 'habitat', title: 'A squirrel built a drey in the crown', detail: 'after weeks of a welcoming tree', habitat: 'drey_built' });
    if (c.kind === 'drey_gone') items.push({ at: c.at, kind: 'habitat', title: 'The drey was abandoned', habitat: 'drey_gone' });
  }
  return items;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

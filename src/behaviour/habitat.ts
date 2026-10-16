import { APP_CONFIG } from '../config/appConfig';
import type { HealthCondition, HealthModifier } from '../health/healthTypes';
import { CONDITION_LABELS } from '../health/labels';
import { CONDITION_SEVERITY } from '../health/statePriority';
import type { BehaviourEpisode, DiaryItem } from '../history/historyTypes';
import { sunState } from '../perception/sun';
import type { OutsideSky } from '../telemetry/outsideWeather';
import type { DreyState, HabitatState, HabitatVisit, ReactionKind, VisitSpot } from './behaviourTypes';
import { stableVariant } from './speech';

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

const HOUR = 3600 * 1000;
const MIN = 60 * 1000;
const DAY = 24 * HOUR;

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
  outside?: { sky: OutsideSky; rainEndedAt: number | null } | null; // outside weather (context: shelter only)
  reaction?: { kind: ReactionKind; eventId: number; at: number; seasonal: string | null } | null; // recent care
}

export type HabitatChange = { at: number; kind: 'welcoming' | 'left' | 'drey_started' | 'drey_built' | 'drey_gone' };

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
  let stage: DreyState['stage'] = 'none';
  let builtAt: number | null = null;
  let calmHours = 0;
  let stressHours = 0;
  let lastChangeAt: number | null = null;
  const changes: HabitatChange[] = [];
  const points: { t: number; value: number; welcoming: boolean }[] = [];
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
      if (d) value = d.toward + (value - d.toward) * Math.exp(-hours / steps / d.tauHours);
      const was = welcoming;
      if (!welcoming && value >= cfg.enter) welcoming = true;
      else if (welcoming && value < cfg.exit) welcoming = false;
      if (was !== welcoming) {
        lastChangeAt = t;
        changes.push({ at: t, kind: welcoming ? 'welcoming' : 'left' });
      }
      // The drey grows with welcoming time (held time included: a sleeping tree is still a home)
      const toward = welcoming ? 1 : 0;
      drey = toward + (drey - toward) * Math.exp(-(hours / steps) / ((welcoming ? D.riseDays : D.fallDays) * 24));
      const before = stage;
      if (stage === 'none' && drey >= D.startedEnter) stage = 'started';
      if (stage === 'started' && drey >= D.builtEnter) stage = 'built';
      else if (stage === 'built' && drey < D.builtExit) stage = 'started';
      if (stage === 'started' && drey < D.startedExit) stage = 'none';
      if (stage !== before) {
        if (stage === 'built') builtAt = t;
        if (stage === 'started' && before === 'none') changes.push({ at: t, kind: 'drey_started' });
        if (stage === 'built') changes.push({ at: t, kind: 'drey_built' });
        if (stage === 'none' && builtAt !== null) changes.push({ at: t, kind: 'drey_gone' });
      }
      if (trace) points.push({ t, value, welcoming });
    }
  }
  return {
    value: round2(value),
    welcoming,
    calmHours: round1(calmHours),
    stressHours: round1(stressHours),
    lastChangeAt,
    drey: { value: round2(drey), stage, builtAt: stage === 'built' ? builtAt : null } as DreyState,
    changes,
    points,
  };
}

const SPOTS: VisitSpot[] = ['left_branch', 'right_branch', 'crown'];
const dayKeyOf = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

// The visit (if any) whose slot covers `now`. Pure function of the day, the slot and the habitat value.
function visitAt(value: number, chanceScale: number, season: string, now: number): HabitatVisit | null {
  const cfg = APP_CONFIG.habitat;
  const slotMs = cfg.slotMinutes * MIN;
  const d = new Date(now);
  const dayKey = dayKeyOf(now);
  d.setHours(0, 0, 0, 0);
  const slot = Math.floor((now - d.getTime()) / slotMs);
  const roll = (salt: string, n = 1000) => stableVariant(`habitat:${dayKey}:${slot}:${salt}`, n) / n;
  const f = clamp((value - cfg.exit) / (1 - cfg.exit), 0, 1);
  const chance = (cfg.visitChance.min + (cfg.visitChance.max - cfg.visitChance.min) * f) * chanceScale;
  if (roll('visit') >= chance) return null;
  const minutes = cfg.visitMinutes.min + Math.round(roll('len') * (cfg.visitMinutes.max - cfg.visitMinutes.min));
  const slotStart = d.getTime() + slot * slotMs;
  const startedAt = slotStart + Math.round(roll('offset') * Math.max(0, slotMs - minutes * MIN));
  const endsAt = startedAt + minutes * MIN;
  if (now < startedAt || now >= endsAt) return null;
  return {
    kind: 'squirrel',
    id: `${dayKey}:${slot}`,
    startedAt,
    endsAt,
    spot: SPOTS[stableVariant(`habitat:${dayKey}:${slot}:spot`, SPOTS.length)],
    // Autumn: caching for the cold months
    carrying: season === 'autumn' ? 'nut' : null,
    cause: 'slot',
    action: null,
  };
}

// Busiest in the morning and late afternoon, quieter at midday; fewer visits at winter rest
const chanceScaleAt = (now: number, seasonEnergy: number) => {
  const h = new Date(now).getHours();
  return (h < 10 || h >= 16 ? 1.25 : 0.75) * Math.min(1, seasonEnergy);
};

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

export function evaluateHabitat({ episodes, condition, modifiers, isDay, season, now, outside = null, reaction = null }: HabitatInput): HabitatState {
  const cfg = APP_CONFIG.habitat;
  const r = replayHabitat(episodes, now);
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
    // Answers to care: a needed watering → drinks at the pot rim; a pruning → inspects the cut
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
    if (presence === 'visiting' && reaction && careMin > 0 && age >= 0 && age < careMin * MIN) {
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
      visit = visitAt(r.value, chanceScaleAt(now, season.energy), season.id, now);
      if (!visit) why += ' (none right now)';
    }
    // Shelter: rain, a storm or snow outside sends it into the leaves (the habitat value never sees weather)
    if (visit && outside && SHELTER_SKIES.includes(outside.sky)) {
      if (presence === 'visiting') why = `sheltering from the ${outside.sky === 'snow' ? 'snow' : outside.sky === 'thunderstorm' ? 'storm' : 'rain'} outside`;
      presence = 'hiding';
      visit = { ...visit, action: null };
    } else if (visit && presence === 'visiting' && !visit.action && outside?.rainEndedAt != null && now - outside.rainEndedAt < cfg.shakeOffAfterRainMs) {
      visit = { ...visit, action: 'shake_off' };
      why = 'out again after the rain: shaking off';
    }
  }

  return {
    value: r.value,
    welcoming: r.welcoming,
    presence: visit ? presence : 'none',
    visit,
    drey: r.drey,
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
}

const ABSENCE_DAYS = 7;

export function habitatDiary({ episodes, now, days, location, seasonAt }: HabitatDiaryInput): DiaryItem[] {
  const cfg = APP_CONFIG.habitat;
  const r = replayHabitat(episodes, now, true);
  const since = now - days * DAY;
  const lookFrom = Math.max(now - cfg.replayDays * DAY, since - (ABSENCE_DAYS + 7) * DAY);
  const sorted = [...episodes].sort((a, b) => a.startedAt - b.startedAt);
  const episodeAt = (t: number) => sorted.find((e) => e.startedAt <= t && t < (e.endedAt ?? now)) ?? null;
  let pi = 0;
  const stateAt = (t: number) => {
    while (pi + 1 < r.points.length && r.points[pi + 1].t <= t) pi++;
    const p = r.points[pi];
    return p && p.t <= t ? p : null;
  };

  // Visits per day, from the same slots the live view uses
  const slotMs = cfg.slotMinutes * MIN;
  const visitsByDay = new Map<string, { first: number; count: number }>();
  const start = Math.ceil(lookFrom / slotMs) * slotMs;
  for (let t = start; t <= now; t += slotMs) {
    const s = stateAt(t);
    const ep = episodeAt(t);
    if (!s || !ep || !s.welcoming) continue;
    const isDay = sunState(t, location.latitude, location.longitude, 15).isDay;
    if (basePresence(s.welcoming, s.value, ep.condition, [], isDay).presence === 'none' || !isDay) continue;
    if (basePresence(s.welcoming, s.value, ep.condition, [], isDay).presence === 'night') continue;
    // Any minute of this slot inside its visit counts (visitAt answers for a moment: probe the slot)
    const season = seasonAt(t);
    let v: HabitatVisit | null = null;
    for (let m = 0; m < cfg.slotMinutes && !v; m += 2) v = visitAt(s.value, chanceScaleAt(t + m * MIN, season.energy), season.id, t + m * MIN);
    if (!v) continue;
    const key = dayKeyOf(v.startedAt);
    const d = visitsByDay.get(key);
    if (d) d.count++;
    else visitsByDay.set(key, { first: v.startedAt, count: 1 });
  }

  const hhmm = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const items: DiaryItem[] = [];
  let lastVisitDay: number | null = null;
  for (const { first, count } of [...visitsByDay.values()].sort((a, b) => a.first - b.first)) {
    const dayStart = new Date(first).setHours(0, 0, 0, 0);
    const away = lastVisitDay !== null ? Math.round((dayStart - lastVisitDay) / DAY) : null;
    if (first >= since) {
      if (away !== null && away >= ABSENCE_DAYS) items.push({ at: first, kind: 'habitat', title: 'The squirrel came back', detail: `after ${away} days away`, habitat: 'returned' });
      items.push({ at: first, kind: 'habitat', title: 'A squirrel visited', detail: `${count} visit${count > 1 ? 's' : ''} · first at ${hhmm(first)}`, habitat: 'visit' });
    }
    lastVisitDay = dayStart;
  }
  for (const c of r.changes) {
    if (c.at < since) continue;
    if (c.kind === 'left') {
      const ep = episodeAt(c.at - 1);
      items.push({ at: c.at, kind: 'habitat', title: 'The squirrels stayed away', detail: ep ? `while ${CONDITION_LABELS[ep.condition].toLowerCase()}` : undefined, habitat: 'left' });
    }
    if (c.kind === 'drey_built') items.push({ at: c.at, kind: 'habitat', title: 'A squirrel built a drey in the crown', detail: 'after weeks of a welcoming tree', habitat: 'drey_built' });
    if (c.kind === 'drey_gone') items.push({ at: c.at, kind: 'habitat', title: 'The drey was abandoned', habitat: 'drey_gone' });
  }
  return items;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

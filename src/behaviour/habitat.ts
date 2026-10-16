import { APP_CONFIG } from '../config/appConfig';
import type { HealthCondition, HealthModifier } from '../health/healthTypes';
import { CONDITION_SEVERITY } from '../health/statePriority';
import type { BehaviourEpisode } from '../history/historyTypes';
import type { HabitatState, HabitatVisit, VisitSpot } from './behaviourTypes';
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

const HOUR = 3600 * 1000;
const MIN = 60 * 1000;
const DAY = 24 * HOUR;

const WELCOMING: HealthCondition[] = ['comfortable', 'thriving'];
const HELD: HealthCondition[] = ['sleeping', 'recovering', 'very_bright', 'sensor_uncertain'];
// Not dangerous, but not settled either: a squirrel stays tucked in the leaves
const HIDING_CONDITIONS: HealthCondition[] = ['recovering', 'very_bright'];

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
}

// Replays the episodes of the window into the habitat value and its latch.
export function replayHabitat(episodes: BehaviourEpisode[], now: number) {
  const cfg = APP_CONFIG.habitat;
  const from = now - cfg.windowDays * DAY;
  let value = 0;
  let welcoming = false;
  let calmHours = 0;
  let stressHours = 0;
  let lastChangeAt: number | null = null;
  const sorted = [...episodes].filter((e) => (e.endedAt ?? now) > from && e.startedAt <= now).sort((a, b) => a.startedAt - b.startedAt);
  for (const e of sorted) {
    const d = drift(e.condition);
    const end = Math.min(e.endedAt ?? now, now);
    const full = Math.max(1, end - e.startedAt);
    const span = end - Math.max(e.startedAt, from);
    if (!d || span <= 0) continue;
    // Unobserved time inside the episode counts for nothing (spread evenly: we don't know where it fell)
    const observed = span * Math.max(0, 1 - e.unobservedMs / full);
    const hours = observed / HOUR;
    if (d.toward === 1) calmHours += hours;
    else stressHours += hours;
    // Walk in steps so the latch sees the crossing (≤ 1 h per step)
    const steps = Math.max(1, Math.ceil(hours));
    for (let i = 1; i <= steps; i++) {
      value = d.toward + (value - d.toward) * Math.exp(-hours / steps / d.tauHours);
      const was = welcoming;
      if (!welcoming && value >= cfg.enter) welcoming = true;
      else if (welcoming && value < cfg.exit) welcoming = false;
      if (was !== welcoming) lastChangeAt = Math.max(e.startedAt, from) + ((end - Math.max(e.startedAt, from)) * i) / steps;
    }
  }
  return { value: round2(value), welcoming, calmHours: round1(calmHours), stressHours: round1(stressHours), lastChangeAt };
}

const SPOTS: VisitSpot[] = ['left_branch', 'right_branch', 'crown'];

// The visit (if any) whose slot covers `now`. Pure function of the day, the slot and the habitat value.
function visitAt(value: number, chanceScale: number, season: string, now: number): HabitatVisit | null {
  const cfg = APP_CONFIG.habitat;
  const slotMs = cfg.slotMinutes * MIN;
  const d = new Date(now);
  const dayKey = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
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
  };
}

export function evaluateHabitat({ episodes, condition, modifiers, isDay, season, now }: HabitatInput): HabitatState {
  const r = replayHabitat(episodes, now);
  const uncertain = condition === 'sensor_uncertain' || modifiers.includes('sensor_uncertain');
  const asleep = condition === 'sleeping' || modifiers.includes('sleeping');
  const sev = CONDITION_SEVERITY[condition];

  // Who is visible right now, given the place has been welcoming
  let presence: HabitatState['presence'] = 'none';
  let why: string;
  if (uncertain) why = "no trustworthy data: nobody shown (never a falsely healthy tree)";
  else if (!r.welcoming) why = r.value > 0 ? `not welcoming yet (${r.value} < ${APP_CONFIG.habitat.enter})` : 'no calm history yet';
  else if (!isDay || asleep) why = 'night: squirrels are asleep in their dreys';
  else if (sev === 'critical' || condition === 'multiple_stress') why = `${condition.replace(/_/g, ' ')}: visitors have fled`;
  else if (WELCOMING.includes(condition) && !modifiers.some((m) => CONDITION_SEVERITY[m] === 'critical')) {
    presence = 'visiting';
    why = 'welcoming and calm: visits come now and then';
  } else {
    presence = 'hiding';
    why = `${condition.replace(/_/g, ' ')}: tucked into the leaves, waiting it out`;
  }

  // Busiest in the morning and late afternoon, quieter at midday; fewer visits at winter rest
  const h = new Date(now).getHours();
  const daily = h < 10 || h >= 16 ? 1.25 : 0.75;
  const visit = presence === 'none' ? null : visitAt(r.value, daily * Math.min(1, season.energy), season.id, now);
  if (presence !== 'none' && !visit) why += ' (none right now)';

  return { value: r.value, welcoming: r.welcoming, presence: visit ? presence : 'none', visit, calmHours14d: r.calmHours, stressHours14d: r.stressHours, lastChangeAt: r.lastChangeAt, why };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

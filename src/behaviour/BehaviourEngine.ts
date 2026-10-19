import { APP_CONFIG } from '../config/appConfig';
import type { HealthCondition, PlantHealthState, Severity } from '../health/healthTypes';
import { CONDITION_LABELS } from '../health/labels';
import { CONDITION_SEVERITY, SEVERITY_RANK, STRESS_CONDITIONS } from '../health/statePriority';
import type { BehaviourEpisode, Interaction, PlantEvent } from '../history/historyTypes';
import type { PerceptionState } from '../perception/perceptionTypes';
import type { SpeciesProfile } from '../species';
import type { SeasonalCurve, SeasonRule } from '../species/types';
import type {
  CareLine,
  CareReaction,
  Concern,
  SeasonalCare,
  DayLine,
  IntensityTier,
  MessageIntent,
  Mood,
  PlantBehaviourState,
  ReactionKind,
  RecoveryStage,
  MoodMemory,
  SlothMemory,
  TimeOfDay,
} from './behaviourTypes';
import { evaluateMood } from './mood';
import { evaluateCanopy } from './canopy';
import { evaluateDragonfly } from './dragonfly';
import { evaluateSloth } from './sloth';
import { evaluateLucy, lucyDayVisits } from './lucy';
import type { Window } from './familiarity';
import { applyEncounters } from './encounters';
import { evaluateVoice } from './voice';
import { evaluateHabitat, seasonEnergyAt } from './habitat';
import { computeRelationship } from './relationship';
import type { HikePlan } from './hike';
import { clockAt, HOUR, hourOf, MIN } from '../lib/time';

const THIRST: HealthCondition[] = ['thirsty', 'very_dry', 'hot_and_dry'];
const CALM: HealthCondition[] = ['comfortable', 'thriving', 'recovering', 'very_bright'];

// How long after a stress ends the tree is still a little subdued ("afterglow"), once comfortable.
const AFTERGLOW_MS = 2 * HOUR;

export interface BehaviourInput {
  health: PlantHealthState;
  perception: PerceptionState;
  episodes: BehaviourEpisode[]; // recent episodes, any order (the open one included)
  events: PlantEvent[]; // recent care events, any order
  interactions?: Interaction[]; // attention (petting sessions): relationship memory only, never mood/energy
  species: SpeciesProfile;
  now: number;
  // The visitors' memory (art): the tree's location (day and night of past squirrel visits), and the
  // sloth's loyalty from the last days of readings (the collector derives it; perception has only 24 h)
  location?: { latitude: number | null; longitude: number | null };
  // The air visitors' memory, derived once a day by the collector from stored readings: the sloth's loyalty,
  // and both their past visit windows (familiarity between the visitors)
  wanderers?: { sloth?: SlothMemory; history?: { sloth: Window[]; dragonfly: Window[] } };
  moodMemory?: MoodMemory | null; // where the mood was (persisted by the collector): it drifts from there
  hike?: HikePlan | null; // the week's hike pick (the collector plans it from the forecast): a day line, the boots
}

const CARE_REACTION: Partial<Record<PlantEvent['type'], ReactionKind>> = {
  pruning: 'care_pruning',
  fertilizing: 'care_fertilizing',
  repotting: 'care_repotting',
  moved_location: 'care_moved',
};

// Smooth yearly bump: 1 on the peak day, 0 beyond ± halfWidthDays.
function cycleValue(day: number, c: SeasonalCurve): number {
  const raw = Math.abs(day - c.peakDay) % 365;
  const d = Math.min(raw, 365 - raw);
  return d >= c.halfWidthDays ? 0 : round2(0.5 * (1 + Math.cos((Math.PI * d) / c.halfWidthDays)));
}

// The season as the tree lives it: its rule, energy blended across the boundary, its place in the yearly cycle.
function seasonalContext(perception: PerceptionState, species: SpeciesProfile): PlantBehaviourState['season'] {
  const s = perception.season;
  const rule = species.seasons[s.id];
  const other = s.blend ? species.seasons[s.blend.with] : null;
  const energy = other ? rule.energy + (other.energy - rule.energy) * s.blend!.amount : rule.energy;
  const c = species.seasonalCycle;
  return {
    id: s.id,
    key: s.key,
    stage: s.stage,
    growth: rule.growth,
    daylightTrend: s.daylightTrend,
    blend: s.blend,
    energy: round2(energy),
    cycle: { newGrowth: cycleValue(s.seasonalDay, c.newGrowth), yellowing: cycleValue(s.seasonalDay, c.yellowing), leafDrop: cycleValue(s.seasonalDay, c.leafDrop) },
  };
}

const GROWING: SeasonRule['growth'][] = ['flush', 'active'];

// What the season adds to a care action's meaning.
function seasonalCare(kind: ReactionKind, rule: SeasonRule): SeasonalCare | null {
  const growing = GROWING.includes(rule.growth);
  switch (kind) {
    case 'watering_relief':
      return rule.growth === 'active' ? 'growing_drink' : rule.growth === 'resting' ? 'resting_drink' : null;
    case 'watering_thanks':
    case 'watering_gentle_ack':
      return rule.growth === 'resting' ? 'resting_drink' : null;
    case 'watering_enough':
      return growing ? null : 'resting_wet';
    case 'care_pruning':
      return growing ? 'growing_prune' : 'resting_prune';
    case 'care_fertilizing':
      return rule.feeding ? 'in_season_feed' : 'off_season_feed';
    case 'care_repotting':
      return growing ? 'growing_repot' : 'resting_repot';
    default:
      return null;
  }
}
const SEASON_WHY: Record<SeasonalCare, string> = {
  resting_drink: 'during winter rest',
  growing_drink: 'in the summer growing season',
  resting_wet: 'while growth is slow',
  growing_prune: 'while growing',
  resting_prune: 'while growth is slow',
  in_season_feed: 'in the growing season',
  off_season_feed: 'outside the growing season',
  growing_repot: 'while growing',
  resting_repot: 'while growth is slow',
};

// Same human action, different history (and time of year) → different response.
function careReaction(events: PlantEvent[], health: PlantHealthState, species: SpeciesProfile, seasonRule: SeasonRule, now: number): CareReaction | null {
  const r = careReactionBase(events, health, species, now);
  if (!r) return null;
  const seasonal = seasonalCare(r.kind, seasonRule);
  return { ...r, seasonal, why: seasonal ? `${r.why}, ${SEASON_WHY[seasonal]}` : r.why };
}

function careReactionBase(events: PlantEvent[], health: PlantHealthState, species: SpeciesProfile, now: number): Omit<CareReaction, 'seasonal'> | null {
  const recent = [...events]
    .filter((e) => e.timestamp <= now && e.type !== 'manual_note')
    .sort((a, b) => b.timestamp - a.timestamp)[0];
  if (!recent) return null;
  const ageMin = (now - recent.timestamp) / MIN;

  if (recent.type === 'watering') {
    if (ageMin > APP_CONFIG.watering.reactionMinutes) return null;
    const m = recent.metadata;
    const before = m.conditionBefore ?? null;
    const soilBefore = m.moistureBefore ?? null;
    const soil = m.moistureAfter != null ? `soil ${soilBefore ?? '?'}% → ${m.moistureAfter}%` : `soil ${soilBefore ?? '?'}%`;
    const s = species.soilMoisture;
    const base = { eventId: recent.id, eventType: recent.type, at: recent.timestamp };

    // Already wet, or the pot is waterlogged now: never celebrate more water
    if (before === 'too_wet' || health.condition === 'too_wet' || (soilBefore !== null && soilBefore >= s.maxOptimal)) {
      return { ...base, kind: 'watering_enough', why: `watered while the soil was already wet (${soil})` };
    }
    if ((before && THIRST.includes(before)) || (soilBefore !== null && soilBefore < s.minOptimal)) {
      return { ...base, kind: 'watering_relief', why: `watered while ${before ? CONDITION_LABELS[before].toLowerCase() : 'dry'} (${soil})` };
    }
    if (before === 'recovering') return { ...base, kind: 'watering_gentle_ack', why: `watered while recovering (${soil})` };
    return { ...base, kind: 'watering_thanks', why: `watered while comfortable (${soil})` };
  }

  const kind = CARE_REACTION[recent.type];
  if (!kind || ageMin > 60) return null;
  return { kind, eventId: recent.id, eventType: recent.type, at: recent.timestamp, why: `${recent.type.replace('_', ' ')} ${Math.round(ageMin)} min ago` };
}

// A comfortable tree can still be watching one reading that's out of range (not long enough to be a condition).
function findConcern(health: PlantHealthState): Concern | null {
  const order = ['soil', 'temperature', 'humidity', 'light'] as const;
  const worst = order
    .map((id) => health.metrics.find((m) => m.id === id))
    .filter((m) => m && (m.tone === 'alert' || m.tone === 'caution'))
    .sort((a, b) => (a!.tone === 'alert' ? 0 : 1) - (b!.tone === 'alert' ? 0 : 1))[0];
  return worst ? { metric: worst.id as Concern['metric'], status: worst.status } : null;
}

// Tier from severity + OBSERVED duration: the state is felt more the longer it lasts, never max at once.
const TIER_HOURS: Record<Severity, [number, number]> = {
  none: [Infinity, Infinity],
  mild: [3, 8], // → moderate after 3h, strong after 8h
  moderate: [1, 4],
  critical: [0, 1], // starts moderate
};
function tierFor(severity: Severity, hours: number): IntensityTier {
  const [toModerate, toStrong] = TIER_HOURS[severity];
  return hours >= toStrong ? 'strong' : hours >= toModerate ? 'moderate' : 'mild';
}
const SEVERITY_BASE: Record<Severity, number> = { none: 0.3, mild: 0.4, moderate: 0.55, critical: 0.75 };

const STRESS_MOOD: Partial<Record<HealthCondition, Record<IntensityTier, Mood>>> = {
  thirsty: { mild: 'patient', moderate: 'uncomfortable', strong: 'tired' },
  very_dry: { mild: 'distressed', moderate: 'distressed', strong: 'distressed' },
  hot: { mild: 'uncomfortable', moderate: 'uncomfortable', strong: 'distressed' },
  hot_and_dry: { mild: 'distressed', moderate: 'distressed', strong: 'distressed' },
  cold: { mild: 'uncomfortable', moderate: 'uncomfortable', strong: 'distressed' },
  freezing_risk: { mild: 'distressed', moderate: 'distressed', strong: 'distressed' },
  too_wet: { mild: 'uneasy', moderate: 'uneasy', strong: 'tired' },
  too_dark: { mild: 'tired', moderate: 'tired', strong: 'tired' },
  dry_air: { mild: 'uncomfortable', moderate: 'uncomfortable', strong: 'tired' },
  high_humidity: { mild: 'uneasy', moderate: 'uneasy', strong: 'tired' },
  multiple_stress: { mild: 'overwhelmed', moderate: 'overwhelmed', strong: 'overwhelmed' },
};

const REACTION_MOOD: Record<ReactionKind, Mood> = {
  watering_relief: 'relieved',
  watering_enough: 'concerned',
  watering_gentle_ack: 'grateful',
  watering_thanks: 'content',
  care_pruning: 'grateful',
  care_fertilizing: 'grateful',
  care_repotting: 'uneasy',
  care_moved: 'watchful',
};

const INTENT: Record<HealthCondition, MessageIntent> = {
  thriving: 'joy',
  comfortable: 'content',
  thirsty: 'thirst',
  very_dry: 'very_dry',
  too_wet: 'overwatered',
  hot: 'heat',
  hot_and_dry: 'heat_and_drought',
  cold: 'cold',
  freezing_risk: 'freezing',
  too_dark: 'needs_light',
  very_bright: 'dazzled',
  dry_air: 'dry_air',
  high_humidity: 'humid_air',
  recovering: 'recovery',
  sleeping: 'sleep',
  multiple_stress: 'overwhelmed',
  sensor_uncertain: 'sensor_confused',
};

// Outside differs enough from the inside to be worth a word. Never about the tree's own state.
const COLD_OUTSIDE_C = 5;
const WARM_INSIDE_C = 15;
function outsideLine(p: PerceptionState): DayLine | null {
  const o = p.outside;
  if (!o) return null;
  if (o.sky === 'thunderstorm') return 'weather_storm';
  if (o.sky === 'rain' || o.sky === 'heavy_rain') return 'weather_rain';
  if (o.sky === 'snow') return 'weather_snow';
  if (o.sky === 'fog') return 'weather_fog';
  // Beyond the sky: bad air, then a fast-falling barometer (weather on its way, not here yet)
  if (o.air && ['poor', 'very_poor', 'extremely_poor'].includes(o.air.band)) return 'weather_hazy';
  if (o.pressureTendency === 'falling_fast') return 'weather_pressure_falling';
  const inside = p.readings.temperature;
  if (o.temperature !== null && inside !== null && o.temperature < COLD_OUTSIDE_C && inside >= WARM_INSIDE_C) return 'weather_cold_outside';
  return null;
}

// Time of day from the sun's real moments when known (morning until 3 h after sunrise, evening from 2 h
// before sunset), else from the clock.
const MORNING_AFTER_SUNRISE_MS = 3 * HOUR;
const EVENING_BEFORE_SUNSET_MS = 2 * HOUR;
function timeOfDay(p: PerceptionState, now: number): TimeOfDay {
  if (p.sun.phase === 'dawn') return 'morning'; // first light, sun not quite up yet
  if (!p.sun.isDay) return 'night';
  const { sunrise, sunset } = p.sun;
  if (sunrise != null && sunset != null) return now < sunrise + MORNING_AFTER_SUNRISE_MS ? 'morning' : now >= sunset - EVENING_BEFORE_SUNSET_MS ? 'evening' : 'day';
  const h = hourOf(now);
  return h < 11 ? 'morning' : h >= 17 ? 'evening' : 'day';
}

// Minutes from the nearest real sunrise / sunset, within its twilight window (the same window the sky uses)
const TWILIGHT = { beforeMin: 45, afterMin: 40 } as const;
function twilightOf(p: PerceptionState, now: number): PlantBehaviourState['twilight'] {
  for (const event of ['sunrise', 'sunset'] as const) {
    const at = p.sun[event];
    if (at == null) continue;
    const minutes = (now - at) / MIN;
    if (minutes >= -TWILIGHT.beforeMin && minutes <= TWILIGHT.afterMin) return { event, minutes: Math.round(minutes * 10) / 10 };
  }
  return { event: null, minutes: null };
}

// A real stress (moderate or critical), not mild discomfort like a humid night
const seriousStress = (c: HealthCondition) => STRESS_CONDITIONS.includes(c) && SEVERITY_RANK[CONDITION_SEVERITY[c]] >= SEVERITY_RANK.moderate;
const isStressEpisode = (e: BehaviourEpisode) => seriousStress(e.condition) || e.modifiers.some(seriousStress);

// "Given what is happening, what happened recently, and how the human has cared for the tree,
// how should the companion behave?" Deterministic: history, duration, context, relationship.
export function evaluateBehaviour({ health, perception, episodes, events, interactions = [], species, now, location, wanderers, moodMemory = null, hike = null }: BehaviourInput): PlantBehaviourState {
  const reasons: string[] = [];
  const condition = health.condition;

  // ---- Episode context: current, previous, how long ----
  const sorted = [...episodes].sort((a, b) => b.startedAt - a.startedAt);
  const open = sorted.find((e) => e.endedAt === null && e.condition === condition);
  const startedAt = open?.startedAt ?? now;
  const minutes = Math.round((now - startedAt) / MIN);
  const prevEpisode = sorted.find((e) => e !== open && e.startedAt <= startedAt) ?? null;
  const previousState = prevEpisode?.condition ?? null;
  reasons.push(`Health: ${CONDITION_LABELS[condition].toLowerCase()} for ${minutes < 90 ? `${minutes} min` : `${Math.round(minutes / 6) / 10}h`}`);
  if (previousState) reasons.push(`Before that: ${CONDITION_LABELS[previousState].toLowerCase()}`);

  const relationship = computeRelationship({ episodes, events, interactions, current: { condition, startedAt }, soilMoisture: perception.readings.soilMoisture, species, now });

  // ---- Intensity: severity × observed duration ----
  const s = health.stress;
  const stressHours =
    THIRST.includes(condition) ? s.dryHours : condition === 'too_wet' ? s.wetHours : condition === 'too_dark' ? s.lowLightHours : minutes / 60;
  const isStress = STRESS_CONDITIONS.includes(condition) || condition === 'multiple_stress';
  const intensityTier: IntensityTier = isStress ? tierFor(health.severity, stressHours) : 'mild';
  const expressionIntensity = round2(
    Math.min(1, (isStress ? SEVERITY_BASE[health.severity] + 0.3 * Math.min(1, stressHours / 6) : SEVERITY_BASE.none) * (0.6 + 0.4 * health.confidenceScore))
  );
  if (isStress) reasons.push(`Intensity ${intensityTier} (${health.severity} severity, ${Math.round(stressHours * 10) / 10}h observed)`);

  // ---- Recent care context (repotting, pruning, moving, fertilizing): lasting, fading effects ----
  const care = perception.care.context;
  const careEffects: string[] = [];
  let tier: IntensityTier = intensityTier;
  let intensity = expressionIntensity;
  if (care.settling > 0.3 && isStress && health.severity !== 'critical') {
    // Settling into a new pot: minor stress is expected, don't dramatise it
    if (tier === 'strong') tier = 'moderate';
    intensity = round2(intensity * (1 - 0.3 * care.settling));
    careEffects.push(`repotted ${Math.round(care.recentRepotting!.ageHours / 24 * 10) / 10} days ago: stress shown more gently (tier ${intensityTier} → ${tier})`);
  }
  if (care.relearningLight) careEffects.push(`moved ${Math.round(care.recentMove!.ageHours)}h ago: not judging the new spot's light as too dark yet`);
  if (care.recentFertilizing) careEffects.push(`fertilized ${Math.round(care.recentFertilizing.ageHours / 24 * 10) / 10} days ago: remembered, no health effect claimed`);

  // ---- Recovery progression + afterglow (previous state still colours the present) ----
  let recoveryStage: RecoveryStage | null = null;
  if (condition === 'recovering') {
    const done = s.recoveringForHours ?? 0;
    const left = s.recoveryRemainingHours ?? 0;
    const f = done + left > 0 ? done / (done + left) : 1;
    recoveryStage = f < 0.2 ? 'relief' : f < 0.65 ? 'perking' : 'settling';
    reasons.push(`Recovery ${Math.round(f * 100)}% → ${recoveryStage}`);
  }
  const prevWasHard = !!prevEpisode && (prevEpisode.condition === 'recovering' || STRESS_CONDITIONS.includes(prevEpisode.condition));
  const sincePrevEnd = prevEpisode?.endedAt != null ? now - prevEpisode.endedAt : Infinity;
  const afterglow = (condition === 'comfortable' || condition === 'thriving') && prevWasHard && sincePrevEnd < AFTERGLOW_MS;
  const glow = afterglow ? sincePrevEnd / AFTERGLOW_MS : 1; // 0 right after, 1 when it has passed
  if (afterglow) reasons.push(`Afterglow: ${previousState} ended ${Math.round(sincePrevEnd / MIN)} min ago, still settling`);

  // ---- Season: blended across boundaries, so nothing jumps on the 1st of the month ----
  const season = seasonalContext(perception, species);
  const seasonRule = species.seasons[season.id];

  // ---- Care reaction (diffraction) ----
  const reaction = condition === 'sensor_uncertain' || condition === 'freezing_risk' ? null : careReaction(events, health, species, seasonRule, now);
  if (reaction) reasons.push(`Recent care: ${reaction.why} → ${reaction.kind.replace(/_/g, ' ')}`);

  // ---- Energy: movement and liveliness ----
  const tod = timeOfDay(perception, now);
  const twilight = twilightOf(perception, now);
  let energy = 0.35 + 0.65 * (health.vitality / 100);
  if (condition === 'sleeping') energy = 0.15;
  else {
    if (tod === 'night') energy *= 0.6;
    else if (perception.sun.phase !== 'day') energy *= 0.85;
    if (isStress) energy *= 1 - 0.45 * expressionIntensity;
    if (recoveryStage) energy *= { relief: 0.55, perking: 0.7, settling: 0.85 }[recoveryStage];
    if (afterglow) energy *= 0.85 + 0.15 * glow;
    if (reaction?.kind === 'watering_relief') energy += reaction.seasonal === 'resting_drink' ? 0.05 : 0.1; // resting: drinks slowly
    if (reaction?.seasonal === 'growing_prune') energy += 0.05;
    if (season.energy !== 1) energy *= season.energy; // livelier in the spring flush, quieter at winter rest
    // Waking with the sun, winding down toward dusk (art: health and vitality are untouched)
    if (twilight.event === 'sunrise' && twilight.minutes! >= 0) energy *= 1.06;
    if (twilight.event === 'sunset' && twilight.minutes! <= 0) energy *= 0.9;
    if (care.settling > 0) {
      energy *= 1 - 0.25 * care.settling;
      careEffects.push(`settling after repotting: quieter (energy ×${round2(1 - 0.25 * care.settling)})`);
    }
  }
  if (care.calm > 0) careEffects.push(`pruned ${Math.round(care.recentPruning!.ageHours)}h ago: calmer, gentler movement`);
  energy = round2(Math.max(0.1, Math.min(1, energy)));

  // ---- Habitat (visitors): from episodes and the air; before mood (their company lifts it), nothing
  // they read depends on mood ----
  const habitat = evaluateHabitat({
    episodes,
    condition,
    modifiers: health.modifiers,
    isDay: perception.sun.isDay,
    season: { id: season.id, energy: season.energy },
    now,
    outside: perception.outside ? { sky: perception.outside.sky, rainEndedAt: perception.outside.rainEndedAt ?? null, pressureTendency: perception.outside.pressureTendency ?? null } : null,
    reaction: reaction ? { kind: reaction.kind, eventId: reaction.eventId, at: reaction.at, seasonal: reaction.seasonal } : null,
    location,
    seasonAt: seasonEnergyAt(location?.latitude ?? null, species),
    interactions,
    // The squirrel learns Lucy from her day plans (the household clock), and knows the air visitors from
    // their past visits
    lucyVisitsOn: lucyDayVisits,
    airHistory: wanderers?.history ?? null,
  });
  // ---- The dragonfly: the same habitat mechanism, reading the air of the last hours ----
  habitat.dragonfly = evaluateDragonfly({
    samples: perception.recent,
    outsideToday: perception.outsideToday ?? [],
    species,
    cadenceMs: perception.history.cadenceMs,
    condition,
    modifiers: health.modifiers,
    isDay: perception.sun.isDay,
    insideTemp: perception.readings.temperature,
    now,
  });
  if (habitat.dragonfly.active) reasons.push(`Dragonfly ${habitat.dragonfly.value}: ${habitat.dragonfly.why}`);
  // ---- The sloth: the same air-wanderer engine, warm, humid and still ----
  habitat.sloth = evaluateSloth({
    samples: perception.recent,
    outsideToday: perception.outsideToday ?? [],
    species,
    cadenceMs: perception.history.cadenceMs,
    condition,
    modifiers: health.modifiers,
    isDay: perception.sun.isDay,
    insideTemp: perception.readings.temperature,
    now,
    memory: wanderers?.sloth,
  });
  if (habitat.sloth.active) reasons.push(`Sloth ${habitat.sloth.value}: ${habitat.sloth.why}`);
  // ---- Lucy: the household dog by the pot (her own day, the outside weather; she stays close in stress) ----
  habitat.lucy = evaluateLucy({
    outsideToday: perception.outsideToday ?? [],
    rainEndedAt: perception.outside?.rainEndedAt ?? null,
    condition,
    modifiers: health.modifiers,
    hike: hike ? { today: hike.today, detail: hike.detail ?? null } : null,
    now,
  });
  if (habitat.lucy.presence !== 'none') reasons.push(`Lucy: ${habitat.lucy.why}`);
  // ---- Encounters: visitors in the tree together arrange themselves (art; nothing above reads it) ----
  const met = applyEncounters(habitat);
  if (met.length) reasons.push(`Encounters: ${met.map((e) => e.replace('_', ' + ')).join(', ')}`);

  // ---- Mood ----
  const concern = condition === 'comfortable' ? findConcern(health) : null;
  let mood: Mood;
  if (condition === 'sensor_uncertain') mood = 'confused';
  else if (condition === 'sleeping') mood = 'sleepy';
  else if (reaction) mood = reaction.seasonal === 'off_season_feed' || reaction.seasonal === 'resting_prune' ? 'patient' : REACTION_MOOD[reaction.kind];
  else if (recoveryStage) mood = recoveryStage === 'relief' ? 'relieved' : recoveryStage === 'perking' ? 'grateful' : 'content';
  else if (condition === 'thriving') mood = 'joyful';
  else if (condition === 'very_bright') mood = 'dazzled';
  else if (STRESS_MOOD[condition]) mood = STRESS_MOOD[condition]![tier];
  else if (concern) mood = health.metrics.some((m) => m.tone === 'alert') ? 'uneasy' : 'watchful';
  else if (care.recentMove && care.recentMove.ageHours < 6 && condition === 'comfortable') mood = 'watchful'; // taking in the new spot
  else if (afterglow && glow < 0.5) mood = 'relieved';
  else if (energy < 0.45) mood = 'tired';
  else mood = 'content';
  // Mood as its own layer: health anchors it (the mood above); the environment, petting and care, the
  // visitors and the outside weather nudge it inside the band health allows; it drifts with inertia
  const moodState = evaluateMood({
    base: mood,
    forced: condition === 'sensor_uncertain' || condition === 'sleeping' || !!reaction,
    condition,
    modifiers: health.modifiers,
    concern: !!concern,
    perception,
    species,
    interactions,
    events,
    habitat,
    twilight: { event: twilight.event, minutes: twilight.minutes },
    seasonEnergy: season.energy,
    memory: moodMemory,
    now,
  });
  if (moodState.label !== mood) reasons.push(`Mood ${moodState.label} (health alone: ${mood}): ${moodState.influences.filter((x) => x.source !== 'health').map((x) => x.why).join('; ')}`);
  mood = moodState.label;

  // ---- Responsiveness: how strongly care and touch show right now (never biology) ----
  const recentlyCared = relationship.hoursSinceCare !== null && relationship.hoursSinceCare < 1;
  const responsiveness = round2(
    condition === 'sensor_uncertain' ? 0.15 : condition === 'sleeping' ? 0.2 : Math.min(1, 0.4 + 0.4 * energy + (recentlyCared ? 0.2 : 0))
  );

  // ---- Message intent (structured; wording is chosen later) ----
  let messageIntent: MessageIntent = INTENT[condition];
  if (condition === 'comfortable') messageIntent = concern ? 'watchful' : afterglow ? 'afterglow' : 'content';
  if (reaction) messageIntent = reaction.kind;

  // ---- Time-of-day line (spoken at most once a day; the speech policy decides) ----
  let dayLine: DayLine | null = null;
  if (tod === 'morning' && previousState === 'sleeping' && minutes < 90 && CALM.includes(condition) && prevEpisode) {
    // A stressful night: stress late in the evening or during the night, or a night spent still recovering
    const nightStart = prevEpisode.startedAt;
    const serious =
      prevEpisode.modifiers.some(seriousStress) || sorted.some((e) => e !== open && (e.endedAt ?? now) > nightStart - 3 * HOUR && e.startedAt < now && isStressEpisode(e));
    // A dewy night (near-saturated air for hours): its only stress, and the short recovery as the air
    // dries at dawn is part of it, not a hard night
    const dewy = prevEpisode.modifiers.includes('high_humidity');
    dayLine = serious || (prevEpisode.modifiers.includes('recovering') && !dewy) ? 'morning_after_stress' : dewy ? 'morning_dewy' : 'morning_calm';
  } else if (condition === 'sleeping' && minutes < 60) {
    const dayStart = clockAt(now, 5);
    const today = sorted.filter((e) => e !== open && (e.endedAt ?? now) > dayStart);
    if (today.some((e) => e.condition === 'hot' || e.condition === 'hot_and_dry' || e.modifiers.includes('hot'))) dayLine = 'evening_after_heat';
    else if (today.some(isStressEpisode)) dayLine = 'evening_after_stress';
  }
  // First days of a new season (once per season; the speech policy keeps track)
  if (!dayLine && perception.season.progress < 0.1 && (tod === 'morning' || tod === 'day') && CALM.includes(condition) && !reaction) {
    dayLine = `season_${season.id}` as DayLine;
  }
  // The sun's real moments, once a day each, when calm and awake
  if (!dayLine && CALM.includes(condition) && !reaction && perception.sun.isDay) {
    if (twilight.event === 'sunrise' && twilight.minutes! >= 0) dayLine = 'sunrise_greeting';
    else if (twilight.event === 'sunset' && twilight.minutes! < 0) dayLine = 'sunset_line';
  }
  // Outside weather in contrast with a calm inside (context only: the sensors say how the tree is)
  if (!dayLine && tod !== 'night' && CALM.includes(condition) && !reaction) dayLine = outsideLine(perception);
  // The week's hike: the pick (again when the forecast moves it) and the day itself, by day when calm
  if (!dayLine && hike && perception.sun.isDay && CALM.includes(condition) && !reaction) {
    dayLine = hike.today ? 'hike_today' : hike.chosen ? 'hike_chosen' : hike.movedFrom ? 'hike_moved' : 'hike_picked';
  }
  if (dayLine) reasons.push(`Time of day: ${dayLine.replace(/_/g, ' ')}`);

  // ---- Care line (once a day while the context lasts; not during serious stress) ----
  let careLine: CareLine | null = null;
  if (!isStress || health.severity === 'mild') {
    if (care.settling > 0.3) careLine = 'settling_in';
    else if (care.recentMove && care.recentMove.ageHours < 24) careLine = 'new_spot';
    else if (care.calm > 0) careLine = 'new_shape';
  }
  careEffects.forEach((e) => reasons.push(`Care: ${e}`));

  reasons.push(`Mood ${mood}, energy ${energy}, responsiveness ${responsiveness}, intensity ${intensity}`);
  if (concern) reasons.push(`Watching: ${concern.metric} is ${concern.status.toLowerCase()} (not long enough to be a condition yet)`);
  if (relationship.observation) reasons.push(`Relationship: ${relationship.observation.id.replace(/_/g, ' ')}`);
  reasons.push(
    `Season: ${season.stage} ${season.id} (${season.growth}${perception.season.daylightHours !== null ? `, ${perception.season.daylightHours}h daylight, ${season.daylightTrend}` : ''})` +
      `${season.blend ? `, ${Math.round(season.blend.amount * 100)}% ${season.blend.with}` : ''}, energy ×${season.energy}`
  );
  if (reaction?.seasonal) reasons.push(`Season shapes the care reaction: ${reaction.seasonal.replace(/_/g, ' ')}`);
  if (perception.quality.insufficientHistory) reasons.push('Little history yet: staying cautious');
  if (health.modifiers.includes('sensor_uncertain')) reasons.push("Data overlay: biological state held while it can't be observed");

  // ---- Canopy over the last weeks (drawn only) ----
  const canopy = evaluateCanopy({ episodes, events, growth: season.growth, species, now });
  // ---- The day's thoughts (grounded in today's data; the speech policy spaces them) ----
  const voice = evaluateVoice({ health, perception, species, intent: messageIntent, timeOfDay: tod, season, relationship, habitat, canopy, now });
  if (voice.budget > 0) reasons.push(`Voice: ${voice.why}`);
  if (canopy.fullness < 0.985) reasons.push(`Canopy: ${canopy.reasons.join('; ')}`);
  if (habitat.welcoming || habitat.value > 0) reasons.push(`Habitat ${habitat.value}${habitat.welcoming ? ' (welcoming)' : ''}: ${habitat.presence === 'none' ? habitat.why : `squirrel ${habitat.presence}`} · trust ${habitat.memory.trust} (${habitat.memory.stage})`);

  return {
    primaryState: condition,
    modifiers: health.modifiers,
    previousState,
    episode: { id: open?.id ?? null, condition, startedAt, minutes },
    mood,
    moodState,
    energy,
    responsiveness,
    expressionIntensity: intensity,
    intensityTier: tier,
    recoveryStage,
    afterglow,
    timeOfDay: tod,
    season,
    dayLine,
    careLine,
    care: { settling: care.settling, calm: care.calm, relearningLight: care.relearningLight, effects: careEffects },
    messageIntent,
    reaction,
    concern,
    relationship,
    habitat,
    canopy,
    voice,
    twilight,
    ...(hike ? { hike } : {}),
    reasons,
    evaluatedAt: now,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

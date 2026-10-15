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
  TimeOfDay,
} from './behaviourTypes';
import { computeRelationship } from './relationship';

const HOUR = 3600 * 1000;
const MIN = 60 * 1000;
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

function timeOfDay(p: PerceptionState, now: number): TimeOfDay {
  const h = new Date(now).getHours();
  if (p.sun.phase === 'dawn') return 'morning'; // first light, sun not quite up yet
  if (!p.sun.isDay) return 'night';
  return h < 11 ? 'morning' : h >= 17 ? 'evening' : 'day';
}

// A real stress (moderate or critical), not mild discomfort like a humid night
const seriousStress = (c: HealthCondition) => STRESS_CONDITIONS.includes(c) && SEVERITY_RANK[CONDITION_SEVERITY[c]] >= SEVERITY_RANK.moderate;
const isStressEpisode = (e: BehaviourEpisode) => seriousStress(e.condition) || e.modifiers.some(seriousStress);

// "Given what is happening, what happened recently, and how the human has cared for the tree,
// how should the companion behave?" Deterministic: history, duration, context, relationship.
export function evaluateBehaviour({ health, perception, episodes, events, interactions = [], species, now }: BehaviourInput): PlantBehaviourState {
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
    if (care.settling > 0) {
      energy *= 1 - 0.25 * care.settling;
      careEffects.push(`settling after repotting: quieter (energy ×${round2(1 - 0.25 * care.settling)})`);
    }
  }
  if (care.calm > 0) careEffects.push(`pruned ${Math.round(care.recentPruning!.ageHours)}h ago: calmer, gentler movement`);
  energy = round2(Math.max(0.1, Math.min(1, energy)));

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
    const stressful =
      prevEpisode.modifiers.some((m) => m === 'recovering' || seriousStress(m)) ||
      sorted.some((e) => e !== open && (e.endedAt ?? now) > nightStart - 3 * HOUR && e.startedAt < now && isStressEpisode(e));
    dayLine = stressful ? 'morning_after_stress' : 'morning_calm';
  } else if (condition === 'sleeping' && minutes < 60) {
    const dayStart = new Date(now);
    dayStart.setHours(5, 0, 0, 0);
    const today = sorted.filter((e) => e !== open && (e.endedAt ?? now) > dayStart.getTime());
    if (today.some((e) => e.condition === 'hot' || e.condition === 'hot_and_dry' || e.modifiers.includes('hot'))) dayLine = 'evening_after_heat';
    else if (today.some(isStressEpisode)) dayLine = 'evening_after_stress';
  }
  // First days of a new season (once per season; the speech policy keeps track)
  if (!dayLine && perception.season.progress < 0.1 && (tod === 'morning' || tod === 'day') && CALM.includes(condition) && !reaction) {
    dayLine = `season_${season.id}` as DayLine;
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

  return {
    primaryState: condition,
    modifiers: health.modifiers,
    previousState,
    episode: { id: open?.id ?? null, condition, startedAt, minutes },
    mood,
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
    reasons,
    evaluatedAt: now,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

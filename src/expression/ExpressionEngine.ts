import type { Mood, PlantBehaviourState, ReactionKind } from '../behaviour/behaviourTypes';
import { renderMessage } from '../behaviour/messages';
import { decideSpeech, INITIAL_MESSAGE_MEMORY, SpeechDecision } from '../behaviour/speech';
import type { HealthCondition, HealthModifier, PlantHealthState, QualitativeState } from '../health/healthTypes';
import type { PerceptionState } from '../perception/perceptionTypes';
import type { Season } from '../perception/season';
import type { AvatarEffect, AvatarPresentation, ExpressionState, Foliage, GaugeTone, Gesture, SceneId, TouchKind, TouchResponse } from './expressionTypes';

type Look = Omit<AvatarPresentation, 'effects'> & { effects?: AvatarEffect[] };

const BASE: Look = {
  eyes: 'happy',
  mouth: 'smile',
  blush: 'normal',
  sweat: false,
  posture: 'normal',
  foliage: 'lush',
  foliageBlend: null,
  seasonalLeaves: { newGrowth: 0, yellowing: 0, leafDrop: 0 },
  soil: 'moist',
  gaze: 'around',
  gesture: { kind: 'look_around', everyMs: 14000 },
  filter: null,
  animation: 'animate-tree-breathe',
  halo: 'bg-[#81B29A]/15 blur-2xl',
};

const every = (kind: Gesture, s: number) => ({ kind, everyMs: s * 1000 });

// Epidermal level: each state has its own body, face, gaze, recurring gesture and details,
// so no two states read alike. Droop is separate (continuous, below).
const LOOKS: Record<HealthCondition, Partial<Look>> = {
  thriving: {
    eyes: 'joy', mouth: 'grin', blush: 'happy', posture: 'perky', foliage: 'vivid', gesture: every('wiggle', 9),
    animation: 'animate-tree-thrive', halo: 'bg-[#F2C14E]/25 blur-3xl animate-pulse-halo', effects: ['sprout', 'butterfly', 'pollen'],
  },
  comfortable: {},
  thirsty: {
    eyes: 'sad', mouth: 'parched', blush: 'pale', foliage: 'thirsty', soil: 'dry', gaze: 'down', gesture: every('sigh', 11),
    animation: 'animate-tree-sigh', halo: 'bg-[#D4A373]/15 blur-2xl',
  },
  very_dry: {
    eyes: 'pleading', mouth: 'parched', blush: 'pale', foliage: 'parched', soil: 'dry', gaze: 'up', gesture: every('tremble', 7),
    animation: 'animate-tree-wilt', halo: 'bg-[#D4A373]/25 blur-2xl', effects: ['water_badge', 'falling_leaves', 'cracks'],
  },
  too_wet: {
    eyes: 'worried', mouth: 'queasy', foliage: 'soaked', soil: 'wet', gaze: 'down', gesture: every('shake_off', 12),
    animation: 'animate-tree-queasy', halo: 'bg-[#5390D9]/15 blur-2xl', effects: ['puddle', 'drips'],
  },
  hot: {
    eyes: 'squint_hard', mouth: 'pant', blush: 'hot', sweat: true, gesture: every('fan', 8), filter: 'heat_shimmer',
    animation: 'animate-tree-pant', halo: 'bg-[#E07A5F]/20 blur-3xl', effects: ['hot_sun', 'heat_waves', 'sweat_drops'],
  },
  hot_and_dry: {
    eyes: 'squint_hard', mouth: 'pant', blush: 'hot', sweat: true, foliage: 'scorched', soil: 'dry', gaze: 'down', gesture: every('fan', 6),
    filter: 'heat_shimmer', animation: 'animate-tree-pant', halo: 'bg-[#E07A5F]/30 blur-3xl',
    effects: ['hot_sun', 'heat_waves', 'water_badge', 'falling_leaves', 'cracks', 'sweat_drops'],
  },
  cold: {
    eyes: 'worried', mouth: 'chatter', blush: 'cold', posture: 'shrink', foliage: 'frosted', gaze: 'center', gesture: every('shiver_burst', 9),
    filter: 'frost', animation: 'animate-shiver', halo: 'bg-[#7EB6E8]/30 blur-3xl', effects: ['snow', 'breath_vapor'],
  },
  freezing_risk: {
    eyes: 'wide', mouth: 'chatter', blush: 'cold', posture: 'shrink', foliage: 'frozen', soil: 'frozen', gaze: 'center',
    gesture: every('shiver_burst', 5), filter: 'frost', animation: 'animate-tree-stiff', halo: 'bg-[#7EB6E8]/45 blur-3xl',
    effects: ['snow', 'frost', 'icicles', 'breath_vapor'],
  },
  too_dark: {
    eyes: 'drowsy', mouth: 'flat', foliage: 'dim', gaze: 'toward_light', gesture: every('stretch_up', 10),
    animation: 'animate-tree-lean-light', halo: 'bg-[#FFC861]/20 blur-3xl scale-125 animate-lantern-glow', effects: ['lanterns'],
  },
  very_bright: {
    eyes: 'squint_soft', mouth: 'smile', foliage: 'vivid', gaze: 'away', gesture: every('shield', 10), filter: 'glare',
    animation: 'animate-tree-recoil', halo: 'bg-[#F9D776]/40 blur-3xl', effects: ['bright_sun', 'leaf_visor'],
  },
  dry_air: {
    eyes: 'heavy', mouth: 'pucker', foliage: 'curled', gesture: every('sigh', 15), animation: 'animate-tree-gust', effects: ['dry_wind'],
  },
  high_humidity: {
    eyes: 'heavy', mouth: 'flat', foliage: 'dewy', gaze: 'down', gesture: every('shake_off', 15),
    animation: 'animate-tree-heavy', halo: 'bg-[#90A4AE]/20 blur-3xl', effects: ['mist', 'condensation'],
  },
  recovering: {
    eyes: 'happy', mouth: 'smile', foliage: 'tender', gaze: 'up', gesture: every('stretch_up', 12),
    animation: 'animate-tree-perk', halo: 'bg-[#81B29A]/20 blur-3xl', effects: ['sprout', 'new_leaves'],
  },
  sleeping: {
    eyes: 'closed', mouth: 'sleep', gaze: 'center', gesture: every('nod_off', 16), animation: 'animate-tree-sleep',
    halo: 'bg-[#FFC861]/20 blur-3xl scale-125 animate-lantern-glow', effects: ['moon_zzz', 'lanterns', 'fireflies'],
  },
  multiple_stress: {
    eyes: 'swirl', mouth: 'wobble', blush: 'pale', foliage: 'thirsty', gesture: every('tremble', 8), filter: 'gloom',
    animation: 'animate-tree-wobble', halo: 'bg-[#6D597A]/20 blur-2xl', effects: ['gloom_cloud', 'sweat_drops'],
  },
  sensor_uncertain: {
    eyes: 'unsure', mouth: 'flat', blush: 'none', foliage: 'washed', gaze: 'search', gesture: every('tilt', 6), filter: 'desaturate',
    animation: 'animate-tree-tilt', halo: 'bg-[#90A4AE]/15 blur-2xl', effects: ['question'],
  },
};

// The whole screen takes on the state, the way night always did.
const SCENE: Record<HealthCondition, SceneId> = {
  thriving: 'golden',
  comfortable: 'calm',
  thirsty: 'parched',
  very_dry: 'drought',
  too_wet: 'sodden',
  hot: 'scorching',
  hot_and_dry: 'scorching',
  cold: 'chill',
  freezing_risk: 'frozen',
  too_dark: 'dim',
  very_bright: 'glare',
  dry_air: 'windy',
  high_humidity: 'fog',
  recovering: 'renewal',
  sleeping: 'night',
  multiple_stress: 'storm',
  sensor_uncertain: 'static',
};
const DARK_SCENES: SceneId[] = ['night', 'dim'];

// Calm states take on the season. Ficus is evergreen: the change is in the leaves' tone and growth, not colour.
const SEASONAL: HealthCondition[] = ['comfortable', 'thriving', 'sleeping'];
const SEASON_FOLIAGE: Record<Season, Foliage | null> = { spring: 'tender', summer: 'vivid', autumn: null, winter: 'deep' };

// When a modifier also affects the leaves, the foliage showing the worse problem wins.
const FOLIAGE_RANK: Foliage[] = ['lush', 'vivid', 'tender', 'deep', 'washed', 'dim', 'dewy', 'curled', 'thirsty', 'soaked', 'frosted', 'scorched', 'parched', 'frozen'];
const MODIFIER_FOLIAGE: Partial<Record<HealthModifier, Foliage>> = {
  thirsty: 'thirsty',
  very_dry: 'parched',
  cold: 'frosted',
  freezing_risk: 'frozen',
  dry_air: 'curled',
};

// Mood shapes the whole face in calm states; in stresses only the eyes, so each keeps its own mouth.
const MOOD_LED: HealthCondition[] = ['comfortable', 'thriving', 'recovering'];
const MOOD_EYES: HealthCondition[] = ['thirsty', 'too_wet', 'too_dark', 'dry_air', 'high_humidity'];
const MOOD_FACE: Partial<Record<Mood, Partial<Look>>> = {
  content: { eyes: 'happy', mouth: 'smile' },
  joyful: { eyes: 'joy', mouth: 'grin' },
  tired: { eyes: 'heavy', mouth: 'flat' },
  watchful: { eyes: 'alert', mouth: 'flat' },
  uneasy: { eyes: 'worried', mouth: 'flat' },
  relieved: { eyes: 'joy', mouth: 'smile', blush: 'happy' },
  grateful: { eyes: 'happy', mouth: 'smile', blush: 'happy' },
  patient: { eyes: 'sad', mouth: 'flat' },
  uncomfortable: { eyes: 'sad', mouth: 'frown' },
};

// Secondary conditions add their own cues on top of the primary look.
const MODIFIER_EFFECTS: Partial<Record<HealthModifier, AvatarEffect[]>> = {
  hot: ['heat_waves', 'sweat_drops'],
  cold: ['snow', 'breath_vapor'],
  freezing_risk: ['snow', 'frost', 'icicles'],
  very_dry: ['water_badge', 'cracks'],
  too_wet: ['puddle', 'drips'],
  very_bright: ['bright_sun'],
  dry_air: ['dry_wind'],
  high_humidity: ['mist', 'condensation'],
  sleeping: ['moon_zzz', 'lanterns'],
  recovering: ['sprout'],
  too_dark: ['lanterns'],
  sensor_uncertain: ['question'],
};

// Reactions to care override the face (diffraction made visible).
const REACTION_LOOK: Partial<Record<ReactionKind, Partial<Look>>> = {
  watering_relief: { eyes: 'joy', mouth: 'grin', blush: 'happy', soil: 'moist', gaze: 'up', gesture: every('wiggle', 6), halo: 'bg-[#5390D9]/25 blur-3xl' },
  watering_enough: { eyes: 'worried', mouth: 'queasy', blush: 'pale', soil: 'wet', gaze: 'down', gesture: every('shake_off', 9), halo: 'bg-[#5390D9]/20 blur-2xl' },
  watering_gentle_ack: { eyes: 'happy', mouth: 'smile', blush: 'happy', soil: 'moist', gaze: 'up' },
  watering_thanks: { eyes: 'happy', mouth: 'smile', soil: 'moist' },
  care_pruning: { eyes: 'joy', mouth: 'smile', blush: 'happy', gesture: every('shake_off', 10) },
  care_fertilizing: { eyes: 'joy', mouth: 'smile', blush: 'happy' },
  care_repotting: { eyes: 'worried', mouth: 'flat', gaze: 'down' },
  care_moved: { eyes: 'alert', mouth: 'gasp', gaze: 'search', gesture: every('look_around', 7) },
};

// How far each stressed state droops the canopy at full intensity (0 = relaxed, 1 = wilting).
const DROOP: Partial<Record<HealthCondition, number>> = {
  thirsty: 0.55,
  very_dry: 0.9,
  hot_and_dry: 0.85,
  too_wet: 0.45,
  hot: 0.4,
  multiple_stress: 0.55,
  too_dark: 0.2,
  dry_air: 0.15,
  high_humidity: 0.15,
  cold: 0.1,
  freezing_risk: 0.2,
};
const RECOVERY_DROOP = { relief: 0.35, perking: 0.18, settling: 0.06 } as const;

const GAUGE_TONE: Record<QualitativeState, GaugeTone> = { Thriving: 'thriving', Happy: 'happy', Okay: 'okay', Stressed: 'stressed', Critical: 'critical' };

// Petting: how a stroke registers in each state. Expressive choice (evidence class "art"): a finger on the
// screen never reaches the real tree, so this only colours the answer, it never changes the state.
const TOUCH: Record<TouchKind, Omit<TouchResponse, 'kind'>> = {
  lean_in: { give: 0.9, stiffness: 60, damping: 11, lean: 0.8, blink: 'soft_close' },
  gentle: { give: 0.6, stiffness: 70, damping: 13, lean: 0.4, blink: 'soft_close' },
  dry_rustle: { give: 0.3, stiffness: 160, damping: 15, lean: 0, blink: 'slow' },
  braced: { give: 0.2, stiffness: 190, damping: 20, lean: 0, blink: 'slow' },
  slow_stir: { give: 0.45, stiffness: 25, damping: 9, lean: 0.15, blink: 'none' },
  muted: { give: 0.12, stiffness: 120, damping: 20, lean: 0, blink: 'none' },
};
const TOUCH_KIND: Record<HealthCondition, TouchKind> = {
  thriving: 'lean_in',
  comfortable: 'lean_in',
  recovering: 'gentle',
  thirsty: 'dry_rustle',
  very_dry: 'dry_rustle',
  hot: 'dry_rustle',
  hot_and_dry: 'dry_rustle',
  dry_air: 'dry_rustle',
  very_bright: 'dry_rustle',
  too_wet: 'gentle',
  high_humidity: 'gentle',
  too_dark: 'gentle',
  multiple_stress: 'braced',
  cold: 'braced',
  freezing_risk: 'braced',
  sleeping: 'slow_stir',
  sensor_uncertain: 'muted',
};

function touchResponse(condition: HealthCondition, modifiers: HealthModifier[], b: PlantBehaviourState): TouchResponse {
  // Uncertainty wins over everything: without trustworthy data the tree never answers as if healthy
  let kind: TouchKind = modifiers.includes('sensor_uncertain') ? 'muted' : TOUCH_KIND[condition];
  if (kind !== 'muted' && condition !== 'sleeping' && modifiers.includes('sleeping')) kind = 'slow_stir';
  if (kind === 'lean_in' && (b.afterglow || b.concern)) kind = 'gentle';
  const t = TOUCH[kind];
  // Responsiveness scales how far it shows (never biology); the state picks the character
  const scale = 0.6 + 0.4 * b.responsiveness;
  return { kind, ...t, give: r2(t.give * scale), lean: r2(t.lean * scale) };
}

const TAP_LABEL: Record<Mood, string> = {
  joyful: '🌿 Joyful',
  content: '🍃 Content',
  tired: '😌 A bit tired',
  watchful: '👀 Watchful',
  relieved: '💧 Relieved',
  grateful: '🌱 Grateful',
  patient: '🍂 Waiting patiently',
  uncomfortable: '😣 Uncomfortable',
  distressed: '😟 Struggling',
  uneasy: '😕 Uneasy',
  concerned: '😕 Concerned',
  sleepy: '🌙 Sleeping',
  dazzled: '😎 Dazzled',
  overwhelmed: '😟 Overwhelmed',
  confused: '🤔 Unsure',
};

const RAIN_SECONDS = 60;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface ExpressionInput {
  behaviour: PlantBehaviourState;
  health: PlantHealthState;
  perception: Pick<PerceptionState, 'sun' | 'source' | 'season'>;
  speech?: SpeechDecision; // from the server's speech policy; previews decide fresh
  now: number;
}

// "How should the internal state show?" Turns behaviour into instructions for the avatar and the words.
export function expressBehaviour({ behaviour: b, health, perception, speech, now }: ExpressionInput): ExpressionState {
  const condition = b.primaryState;
  const modifiers = b.modifiers;
  const look: Look = { ...BASE, ...LOOKS[condition] };
  const effects = new Set<AvatarEffect>(look.effects ?? []);
  for (const m of modifiers) (MODIFIER_EFFECTS[m] ?? []).forEach((e) => effects.add(e));

  // Season: the calm states wear it (spring flush, glossy summer, yellowing in autumn, quiet winter green).
  // Gradual: the yearly cycle comes from behaviour (species curves), and near a boundary the
  // neighbouring season's tone is mixed in, so nothing changes overnight on the 1st of the month.
  const season = perception.season;
  const cycle = b.season.cycle;
  if (SEASONAL.includes(condition)) {
    const tone = condition === 'thriving' ? look.foliage : SEASON_FOLIAGE[season.id] ?? 'lush';
    look.foliage = tone;
    if (condition !== 'thriving' && season.blend) {
      const other = SEASON_FOLIAGE[season.blend.with] ?? 'lush';
      if (other !== tone) look.foliageBlend = { tone: other, amount: season.blend.amount };
    }
    look.seasonalLeaves = { newGrowth: cycle.newGrowth, yellowing: cycle.yellowing, leafDrop: condition === 'sleeping' ? 0 : cycle.leafDrop };
    if (cycle.newGrowth > 0.6 && condition === 'comfortable') effects.add('pollen');
  } else if (condition === 'recovering') {
    look.seasonalLeaves = { newGrowth: Math.max(0.7, cycle.newGrowth), yellowing: 0, leafDrop: 0 };
  }

  // Mood → face (subtle)
  if (MOOD_LED.includes(condition) && MOOD_FACE[b.mood]) Object.assign(look, MOOD_FACE[b.mood]);
  else if (MOOD_EYES.includes(condition) && MOOD_FACE[b.mood]?.eyes) look.eyes = MOOD_FACE[b.mood]!.eyes!;
  // Duration → visible need: a fresh thirst shows little; a long one shows the badge and loses leaves
  if (condition === 'thirsty' && b.intensityTier !== 'mild') effects.add('water_badge');
  if (condition === 'thirsty' && b.intensityTier === 'strong') effects.add('falling_leaves');
  if (modifiers.includes('thirsty') || modifiers.includes('very_dry')) look.soil = 'dry';
  for (const m of modifiers) {
    const f = MODIFIER_FOLIAGE[m];
    if (f && FOLIAGE_RANK.indexOf(f) > FOLIAGE_RANK.indexOf(look.foliage)) look.foliage = f;
  }
  if (modifiers.includes('too_wet')) look.soil = 'wet';
  if (modifiers.includes('sleeping') && condition !== 'sleeping' && (look.eyes === 'happy' || look.eyes === 'alert')) look.eyes = 'drowsy';
  if (b.concern?.metric === 'soil') look.soil = /Wet|Waterlogged/.test(b.concern.status) ? 'wet' : 'dry';
  // Sparkles only right after reaching thriving: no constant glitter
  if (condition === 'thriving' && b.episode.minutes < 60 && b.energy > 0.7) effects.add('sparkles');

  // Care reaction
  const r = b.reaction;
  let diffraction: string | null = null;
  if (r) {
    Object.assign(look, REACTION_LOOK[r.kind] ?? {});
    if (r.kind.startsWith('watering')) effects.delete('water_badge');
    if (r.kind === 'watering_relief' || r.kind === 'watering_gentle_ack' || r.kind === 'watering_thanks') {
      if ((now - r.at) / 1000 < RAIN_SECONDS) effects.add('rain');
      if (r.kind === 'watering_relief') effects.add('sprout');
    }
    if (r.kind === 'watering_enough') effects.add('puddle');
    // The season changes what the same care looks like
    const offSeason = r.seasonal === 'off_season_feed' || r.seasonal === 'resting_prune';
    if ((r.kind === 'care_pruning' || r.kind === 'care_fertilizing') && !offSeason) effects.add('sparkles');
    if (offSeason) Object.assign(look, { eyes: 'happy', mouth: 'flat', blush: 'normal', gesture: null });
    if (r.seasonal === 'growing_prune') look.seasonalLeaves = { ...look.seasonalLeaves, newGrowth: Math.max(0.6, look.seasonalLeaves.newGrowth) };
    if (r.seasonal === 'resting_drink') look.gesture = { kind: 'nod_off', everyMs: 14000 }; // drinks slowly, sleepily
    diffraction = `${r.why} → ${r.kind.replace(/_/g, ' ')}${r.seasonal ? ` (${r.seasonal.replace(/_/g, ' ')})` : ''}`;
  } else if (b.afterglow) {
    diffraction = `${b.previousState?.replace(/_/g, ' ')} ended recently → still settling (afterglow)`;
  }

  // Leaf droop: continuous, from state × intensity, easing off through recovery
  let leafDroop = (DROOP[condition] ?? 0) * (0.45 + 0.55 * b.expressionIntensity);
  if (b.recoveryStage) leafDroop = RECOVERY_DROOP[b.recoveryStage];
  if (b.afterglow) leafDroop = Math.max(leafDroop, 0.08);
  if (condition === 'thriving') leafDroop = -0.15;
  if (condition === 'sleeping') leafDroop = Math.max(leafDroop, 0.12); // relaxed, resting
  for (const m of modifiers) leafDroop = Math.max(leafDroop, (DROOP[m] ?? 0) * 0.5);
  if (r?.kind === 'watering_relief') leafDroop *= 0.6;
  leafDroop = r2(clamp(leafDroop, -0.2, 1));
  if (leafDroop >= 0.75) look.animation = look.animation === 'animate-tree-breathe' ? 'animate-tree-weak' : look.animation;

  // Energy → motion
  const e = b.energy;
  const sleeping = condition === 'sleeping';
  const motion = {
    swaySpeed: r2(sleeping ? 0.35 : 0.45 + 0.75 * e),
    swayAmount: r2(sleeping ? 0.2 : 0.3 + 0.9 * e),
    flutter: r2(sleeping ? 0.1 : 0.2 + 0.9 * e),
    blinkEveryMs: look.eyes === 'closed' ? null : Math.round(2600 + (1 - e) * 5000),
  };
  // Pruned recently: gentler movement for a few days
  if (b.care.calm > 0) {
    motion.swayAmount = r2(motion.swayAmount * (1 - 0.25 * b.care.calm));
    motion.flutter = r2(motion.flutter * (1 - 0.3 * b.care.calm));
  }
  if (look.animation === 'animate-tree-breathe' && e < 0.4) look.animation = 'animate-tree-breathe-slow';

  // Words: wording is chosen here, the speech policy decided whether it's said
  const s = speech ?? decideSpeech({ behaviour: b, severity: health.severity, memory: INITIAL_MESSAGE_MEMORY, now }).decision;
  const rendered = renderMessage({
    key: s.key,
    intent: b.messageIntent,
    variant: s.variant,
    concern: b.concern,
    observation: s.observation,
    dayLine: s.dayLine,
    careLine: s.careLine,
    modifiers,
    stress: health.stress,
    isEstimate: perception.source === 'weather_estimate',
    reactionWhy: r?.why ?? null,
    seasonalCare: r?.seasonal ?? null,
    season: perception.season.id,
  });
  let tip = rendered.tip;
  if (modifiers.includes('sensor_uncertain')) {
    const why = health.dataIssues[0] ?? 'no fresh reading';
    tip = health.breakdown.frozen
      ? `Not observed right now (${why}). Showing how I was at my last reading.`
      : `One of my sensors looks unreliable (${why}). I am not judging myself by it.`;
  }

  const frozen = health.breakdown.frozen && !health.isOverride;
  const mins = health.observation.unobservedMinutes;
  const gauge = frozen
    ? { label: mins < 1 ? 'Paused · no live data' : mins < 90 ? `Paused · ${mins} min without data` : `Paused · ${Math.round(mins / 60)}h without data`, tone: 'paused' as const }
    : { label: health.qualitative, tone: GAUGE_TONE[health.qualitative] };

  // Scene: the whole screen takes on the state. A night modifier (asleep while thirsty) still makes it night.
  let scene: SceneId = SCENE[condition];
  if (condition !== 'too_dark' && modifiers.includes('sleeping')) scene = 'night';
  if (r?.kind === 'watering_relief' || r?.kind === 'watering_gentle_ack') scene = 'renewal';
  const night = DARK_SCENES.includes(scene);
  const calmScene = scene === 'calm' || scene === 'golden' || scene === 'night' || scene === 'renewal';
  const avatar: AvatarPresentation = { ...look, effects: [...effects] };
  return {
    avatar,
    leafDroop,
    motion,
    reactionStrength: b.responsiveness,
    touch: touchResponse(condition, modifiers, b),
    atmosphere: {
      theme: night ? 'night' : 'day',
      phase: perception.sun.phase,
      scene,
      season: season.id,
      seasonStage: season.stage,
      intensity: r2(calmScene ? 0.5 : clamp(0.35 + 0.65 * b.expressionIntensity, 0, 1)),
    },
    gauge,
    tapLabel: TAP_LABEL[b.mood],
    message: {
      text: rendered.text,
      tip,
      visible: s.visible,
      intent: b.messageIntent,
      key: s.key,
      variant: s.variant,
      reason: s.reason,
      spokenAt: s.spokenAt,
      cooldownRemainingMs: Number.isFinite(s.cooldownRemainingMs) ? s.cooldownRemainingMs : null,
      onceStatus: s.onceStatus,
    },
    intensity: b.expressionIntensity,
    layers: { epidermal: describeBody(avatar, b, leafDroop, motion), wording: rendered.text, diffraction },
  };
}

// Plain-language description of the body language, for the developer panel.
function describeBody(a: AvatarPresentation, b: PlantBehaviourState, droop: number, m: ExpressionState['motion']): string[] {
  const mood = b.mood;
  const eyes: Record<AvatarPresentation['eyes'], string> = {
    happy: 'soft open eyes', joy: 'smiling closed eyes', closed: 'eyes closed (asleep)', drowsy: 'half-closed drowsy eyes',
    heavy: 'heavy eyelids', alert: 'alert eyes', sad: 'soft tired eyes', worried: 'concerned eyes',
    squint_hard: 'hard squint', squint_soft: 'gentle squint', unsure: 'one raised brow',
    pleading: 'big pleading eyes', wide: 'stiff wide eyes', swirl: 'dizzy eyes',
  };
  const out = [`${mood} mood`, eyes[a.eyes]];
  out.push(droop >= 0.7 ? `leaves wilting (${droop})` : droop >= 0.35 ? `clear droop (${droop})` : droop >= 0.12 ? `slight droop (${droop})` : droop < 0 ? 'lifted, perky leaves' : 'relaxed leaves');
  out.push(m.swayAmount < 0.4 ? 'almost still' : m.swaySpeed < 0.8 ? 'slow sway' : m.swaySpeed > 1.05 ? 'lively sway' : 'calm sway');
  if (a.posture === 'shrink') out.push('pulled in, shivering');
  if (a.foliage !== 'lush') out.push(`${a.foliage} foliage${a.foliageBlend ? ` turning ${a.foliageBlend.tone} (${Math.round(a.foliageBlend.amount * 100)}%)` : ''}`);
  // The season as the body shows it
  const s = b.season;
  const lv = a.seasonalLeaves;
  const signs = [lv.newGrowth >= 0.15 && 'fresh leaves', lv.yellowing >= 0.15 && 'some leaves yellowing', lv.leafDrop >= 0.15 && 'a few letting go'].filter(Boolean);
  out.push(
    `${s.stage} ${s.id}: ${s.growth === 'flush' ? 'growth spurt' : s.growth === 'active' ? 'growing' : s.growth === 'slowing' ? 'slowing down' : 'resting'}` +
      `${s.blend ? `, ${s.blend.with} ${s.blend.amount >= 0.25 ? 'close' : 'in the air'}` : ''}${signs.length ? ` (${signs.join(', ')})` : ''}`
  );
  if (a.gaze !== 'around') out.push(`looking ${a.gaze.replace('_', ' ')}`);
  if (a.gesture) out.push(`${a.gesture.kind.replace('_', ' ')} every ~${Math.round(a.gesture.everyMs / 1000)}s`);
  if (a.sweat) out.push('sweating');
  if (a.soil === 'wet') out.push('dark soaked soil');
  if (a.effects.length) out.push(`effects: ${a.effects.join(', ')}`);
  return out;
}

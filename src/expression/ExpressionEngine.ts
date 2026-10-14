import type { Mood, PlantBehaviourState, ReactionKind } from '../behaviour/behaviourTypes';
import { renderMessage } from '../behaviour/messages';
import { decideSpeech, INITIAL_MESSAGE_MEMORY, SpeechDecision } from '../behaviour/speech';
import type { HealthCondition, HealthModifier, PlantHealthState, QualitativeState } from '../health/healthTypes';
import type { PerceptionState } from '../perception/perceptionTypes';
import type { AvatarEffect, AvatarPresentation, ExpressionState, GaugeTone } from './expressionTypes';

type Look = Omit<AvatarPresentation, 'effects'> & { effects?: AvatarEffect[] };

const BASE: Look = {
  eyes: 'happy',
  mouth: 'smile',
  blush: 'normal',
  sweat: false,
  posture: 'normal',
  leaves: 'lush',
  soil: 'moist',
  animation: 'animate-tree-breathe',
  halo: 'bg-[#81B29A]/15 blur-2xl',
};

// Epidermal level: the immediate physical look of each state. Droop is separate (continuous, below).
const LOOKS: Record<HealthCondition, Partial<Look>> = {
  thriving: { eyes: 'joy', mouth: 'grin', blush: 'happy', posture: 'perky', animation: 'animate-tree-thrive', halo: 'bg-[#81B29A]/30 blur-3xl animate-pulse-halo', effects: ['sprout'] },
  comfortable: {},
  thirsty: { eyes: 'sad', mouth: 'frown', blush: 'pale', leaves: 'dry', soil: 'dry', halo: 'bg-[#D4A373]/15 blur-2xl' },
  very_dry: { eyes: 'sad', mouth: 'wobble', blush: 'pale', leaves: 'dry', soil: 'dry', animation: 'animate-tree-weak', halo: 'bg-[#D4A373]/25 blur-2xl', effects: ['water_badge'] },
  too_wet: { eyes: 'worried', mouth: 'wobble', soil: 'wet', halo: 'bg-[#5390D9]/15 blur-2xl', effects: ['puddle'] },
  hot: { eyes: 'squint_hard', mouth: 'pant', blush: 'hot', sweat: true, animation: 'animate-tree-pant', halo: 'bg-[#E07A5F]/20 blur-3xl', effects: ['hot_sun', 'heat_waves'] },
  hot_and_dry: { eyes: 'squint_hard', mouth: 'pant', blush: 'hot', sweat: true, leaves: 'dry', soil: 'dry', animation: 'animate-tree-pant', halo: 'bg-[#E07A5F]/30 blur-3xl', effects: ['hot_sun', 'heat_waves', 'water_badge'] },
  cold: { eyes: 'worried', mouth: 'chatter', blush: 'cold', posture: 'shrink', animation: 'animate-shiver', halo: 'bg-[#7EB6E8]/30 blur-3xl', effects: ['snow'] },
  freezing_risk: { eyes: 'worried', mouth: 'chatter', blush: 'cold', posture: 'shrink', animation: 'animate-shiver', halo: 'bg-[#7EB6E8]/45 blur-3xl', effects: ['snow', 'frost'] },
  too_dark: { eyes: 'drowsy', mouth: 'sleep', halo: 'bg-[#FFC861]/25 blur-3xl scale-125 animate-lantern-glow', effects: ['lanterns'] },
  very_bright: { eyes: 'squint_soft', mouth: 'smile', halo: 'bg-[#F9D776]/40 blur-3xl', effects: ['bright_sun'] },
  dry_air: { eyes: 'heavy', mouth: 'flat', effects: ['dry_wind'] },
  high_humidity: { eyes: 'heavy', mouth: 'flat', halo: 'bg-[#90A4AE]/20 blur-3xl', effects: ['mist'] },
  recovering: { eyes: 'happy', mouth: 'smile', halo: 'bg-[#81B29A]/20 blur-3xl', effects: ['sprout'] },
  sleeping: { eyes: 'closed', mouth: 'sleep', animation: 'animate-tree-breathe-slow', halo: 'bg-[#FFC861]/20 blur-3xl scale-125 animate-lantern-glow', effects: ['moon_zzz', 'lanterns'] },
  multiple_stress: { eyes: 'worried', mouth: 'frown', animation: 'animate-tree-weak', halo: 'bg-[#D97757]/20 blur-2xl' },
  sensor_uncertain: { eyes: 'unsure', mouth: 'flat', halo: 'bg-[#90A4AE]/15 blur-2xl', effects: ['question'] },
};

// Mood shapes the face (subtly) for states whose look isn't dominated by a physical reaction.
const MOOD_LED: HealthCondition[] = ['comfortable', 'thriving', 'recovering', 'thirsty', 'too_wet', 'too_dark', 'dry_air', 'high_humidity'];
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
  hot: ['heat_waves'],
  cold: ['snow'],
  freezing_risk: ['snow', 'frost'],
  very_dry: ['water_badge'],
  too_wet: ['puddle'],
  very_bright: ['bright_sun'],
  dry_air: ['dry_wind'],
  high_humidity: ['mist'],
  sleeping: ['moon_zzz', 'lanterns'],
  recovering: ['sprout'],
  too_dark: ['lanterns'],
  sensor_uncertain: ['question'],
};

// Reactions to care override the face (diffraction made visible).
const REACTION_LOOK: Partial<Record<ReactionKind, Partial<Look>>> = {
  watering_relief: { eyes: 'joy', mouth: 'grin', blush: 'happy', soil: 'moist', halo: 'bg-[#5390D9]/25 blur-3xl' },
  watering_enough: { eyes: 'worried', mouth: 'wobble', blush: 'pale', soil: 'wet', halo: 'bg-[#5390D9]/20 blur-2xl' },
  watering_gentle_ack: { eyes: 'happy', mouth: 'smile', blush: 'happy', soil: 'moist' },
  watering_thanks: { eyes: 'happy', mouth: 'smile', soil: 'moist' },
  care_pruning: { eyes: 'joy', mouth: 'smile', blush: 'happy' },
  care_fertilizing: { eyes: 'joy', mouth: 'smile', blush: 'happy' },
  care_repotting: { eyes: 'worried', mouth: 'flat' },
  care_moved: { eyes: 'alert', mouth: 'flat' },
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
  perception: Pick<PerceptionState, 'sun' | 'source'>;
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

  // Mood → face (subtle)
  if (MOOD_LED.includes(condition) && MOOD_FACE[b.mood]) Object.assign(look, MOOD_FACE[b.mood]);
  // Duration → visible need: a fresh thirst shows little; a long one shows the badge
  if (condition === 'thirsty' && b.intensityTier !== 'mild') effects.add('water_badge');
  if (modifiers.includes('thirsty') || modifiers.includes('very_dry')) {
    look.leaves = 'dry';
    look.soil = 'dry';
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
    if (r.kind === 'care_pruning' || r.kind === 'care_fertilizing') effects.add('sparkles');
    diffraction = `${r.why} → ${r.kind.replace(/_/g, ' ')}`;
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

  const night = [condition, ...modifiers].some((c) => c === 'sleeping' || c === 'too_dark');
  const avatar: AvatarPresentation = { ...look, effects: [...effects] };
  return {
    avatar,
    leafDroop,
    motion,
    reactionStrength: b.responsiveness,
    atmosphere: { theme: night ? 'night' : 'day', phase: perception.sun.phase },
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
    layers: { epidermal: describeBody(avatar, b.mood, leafDroop, motion), wording: rendered.text, diffraction },
  };
}

// Plain-language description of the body language, for the developer panel.
function describeBody(a: AvatarPresentation, mood: Mood, droop: number, m: ExpressionState['motion']): string[] {
  const eyes: Record<AvatarPresentation['eyes'], string> = {
    happy: 'soft open eyes', joy: 'smiling closed eyes', closed: 'eyes closed (asleep)', drowsy: 'half-closed drowsy eyes',
    heavy: 'heavy eyelids', alert: 'alert eyes', sad: 'soft tired eyes', worried: 'concerned eyes',
    squint_hard: 'hard squint', squint_soft: 'gentle squint', unsure: 'one raised brow',
  };
  const out = [`${mood} mood`, eyes[a.eyes]];
  out.push(droop >= 0.7 ? `leaves wilting (${droop})` : droop >= 0.35 ? `clear droop (${droop})` : droop >= 0.12 ? `slight droop (${droop})` : droop < 0 ? 'lifted, perky leaves' : 'relaxed leaves');
  out.push(m.swayAmount < 0.4 ? 'almost still' : m.swaySpeed < 0.8 ? 'slow sway' : m.swaySpeed > 1.05 ? 'lively sway' : 'calm sway');
  if (a.posture === 'shrink') out.push('pulled in, shivering');
  if (a.leaves === 'dry') out.push('dull, dry-looking leaves');
  if (a.sweat) out.push('sweating');
  if (a.soil === 'wet') out.push('dark soaked soil');
  if (a.effects.length) out.push(`effects: ${a.effects.join(', ')}`);
  return out;
}

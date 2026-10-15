import { APP_CONFIG } from '../config/appConfig';
import type { Severity } from '../health/healthTypes';
import type { CareLine, DayLine, IntensityTier, ObservationId, PlantBehaviourState } from './behaviourTypes';
import { messageKey, variantCount } from './messages';

// When the tree speaks, and when it stays quiet.
//
// - Something meaningful changed (new episode, care, a stronger tier, critical state): speak now.
// - A minor change within an episode waits for a short cooldown.
// - A line stays on screen for a while, then the tree falls silent (animation only).
// - Only strong/critical states are repeated, after a long cooldown, with a different variant.
// - Relationship observations: once per episode. Time-of-day lines: once per day. Season lines: once per season.
// - The variant is stable for an episode + message, so refreshing never reshuffles the words.
// The memory is persisted by the server, so browser refreshes and restarts don't replay anything.

const MIN = 60 * 1000;

export const SPEECH = {
  minGapMs: 10 * MIN, // between two non-urgent lines
  visibleMs: { quiet: 10 * MIN, mild: 20 * MIN, moderate: 30 * MIN, strong: 45 * MIN, critical: 60 * MIN },
  repeatMs: { strong: 2 * 60 * MIN, critical: 60 * MIN }, // only these are ever re-said
  reactionVisibleMs: APP_CONFIG.watering.reactionMinutes * MIN,
  maxOnceFlags: 60,
} as const;

export interface MessageMemory {
  version: 1;
  lastContext: string | null; // episode + message key + care event: "the same thing"
  lastEpisode: string | null;
  lastTier: IntensityTier | null;
  lastKey: string | null; // catalog key
  lastVariant: number | null;
  lastSpokenAt: number | null;
  repeats: number;
  lastObservation: { id: ObservationId; hours?: number } | null; // included in the line on screen
  lastDayLine: DayLine | null;
  lastCareLine?: CareLine | null;
  onceFlags: string[]; // "episode:observationId" already said
  dayLinesSaid: Partial<Record<DayLine | CareLine, string>>; // time-of-day / care line → local date it was said
}

export const INITIAL_MESSAGE_MEMORY: MessageMemory = {
  version: 1,
  lastContext: null,
  lastEpisode: null,
  lastTier: null,
  lastKey: null,
  lastVariant: null,
  lastSpokenAt: null,
  repeats: 0,
  lastObservation: null,
  lastDayLine: null,
  lastCareLine: null,
  onceFlags: [],
  dayLinesSaid: {},
};

export interface SpeechDecision {
  key: string; // catalog key, e.g. "thirst:moderate"
  variant: number;
  visible: boolean; // false = silence (animation only)
  spokenAt: number | null;
  reason: string;
  observation: { id: ObservationId; hours?: number } | null; // part of the line on screen
  dayLine: DayLine | null;
  careLine: CareLine | null;
  cooldownRemainingMs: number; // until it might speak about this again (0 = it may)
  onceStatus: string;
}

const TIER_RANK: Record<IntensityTier, number> = { mild: 0, moderate: 1, strong: 2 };
const QUIET_INTENTS = ['content', 'joy', 'afterglow', 'sleep', 'dazzled'];

// Small stable hash → variant index (same input, same variant; different episode, maybe different).
export function stableVariant(seed: string, count: number): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return (h >>> 0) % Math.max(1, count);
}

const localDate = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

export function decideSpeech({
  behaviour: b,
  severity,
  memory: m,
  now,
}: {
  behaviour: PlantBehaviourState;
  severity: Severity;
  memory: MessageMemory;
  now: number;
}): { decision: SpeechDecision; memory: MessageMemory } {
  const key = messageKey(b.messageIntent, b.intensityTier, b.recoveryStage);
  const episode = b.episode.id !== null ? `e${b.episode.id}` : `v:${b.primaryState}`;
  const context = `${episode}|${key}|${b.reaction?.eventId ?? ''}`;
  const critical = severity === 'critical';
  const quiet = QUIET_INTENTS.includes(b.messageIntent) || b.primaryState === 'sleeping';
  const visibleFor = b.reaction
    ? SPEECH.reactionVisibleMs
    : critical
    ? SPEECH.visibleMs.critical
    : quiet
    ? SPEECH.visibleMs.quiet
    : SPEECH.visibleMs[b.intensityTier];
  const repeatEvery = b.reaction || quiet ? null : critical ? SPEECH.repeatMs.critical : b.intensityTier === 'strong' ? SPEECH.repeatMs.strong : null;
  const sinceSpoken = m.lastSpokenAt !== null ? now - m.lastSpokenAt : Infinity;

  let next: MessageMemory = { ...m };
  let reason: string;
  let speakNow = false;
  let variant = m.lastVariant ?? 0;

  if (context !== m.lastContext) {
    const newEpisode = episode !== m.lastEpisode;
    const escalated = !newEpisode && m.lastTier !== null && TIER_RANK[b.intensityTier] > TIER_RANK[m.lastTier];
    const isNewCare = !!b.reaction && !(m.lastContext ?? '').endsWith(`|${b.reaction.eventId}`);
    const urgent = newEpisode || escalated || isNewCare || critical;
    if (urgent || sinceSpoken >= SPEECH.minGapMs) {
      speakNow = true;
      variant = stableVariant(`${episode}|${key}`, variantCount(key));
      reason = isNewCare
        ? 'responding to care'
        : newEpisode
        ? 'state changed'
        : escalated
        ? `getting stronger (${m.lastTier} → ${b.intensityTier})`
        : critical
        ? 'critical: always speaks'
        : 'something changed, cooldown passed';
      next = { ...next, lastContext: context, lastEpisode: episode, lastTier: b.intensityTier, lastKey: key, repeats: 0 };
    } else {
      reason = `minor change: waiting ${Math.ceil((SPEECH.minGapMs - sinceSpoken) / MIN)} min (cooldown)`;
    }
  } else if (sinceSpoken < visibleFor) {
    reason = 'same thought, still showing';
  } else if (repeatEvery !== null && sinceSpoken >= repeatEvery) {
    speakNow = true;
    variant = (m.lastVariant ?? 0) + 1; // say it differently this time
    reason = `${critical ? 'critical' : 'strong'} state persists: reminding (${next.repeats + 1}×)`;
    next = { ...next, repeats: next.repeats + 1 };
  } else {
    reason = quiet ? 'calm and nothing new: silent' : 'already said: silent until something changes';
  }

  let observation = speakNow ? null : m.lastObservation;
  let dayLine = speakNow ? null : m.lastDayLine;
  let careLine = speakNow ? null : m.lastCareLine ?? null;
  if (speakNow) {
    const obs = b.relationship.observation;
    const flag = obs ? `${episode}:${obs.id}` : null;
    if (obs && flag && !m.onceFlags.includes(flag)) {
      observation = obs;
      next.onceFlags = [...m.onceFlags, flag].slice(-SPEECH.maxOnceFlags);
    }
    // Season lines are said once per season, the others once per day
    const stamp = b.dayLine?.startsWith('season_') ? b.season.key : localDate(now);
    if (b.dayLine && m.dayLinesSaid[b.dayLine] !== stamp) {
      dayLine = b.dayLine;
      next.dayLinesSaid = { ...m.dayLinesSaid, [b.dayLine]: stamp };
    }
    if (b.careLine && (next.dayLinesSaid[b.careLine] ?? m.dayLinesSaid[b.careLine]) !== localDate(now)) {
      careLine = b.careLine;
      next.dayLinesSaid = { ...next.dayLinesSaid, [b.careLine]: localDate(now) };
    }
    next = { ...next, lastSpokenAt: now, lastVariant: variant, lastObservation: observation, lastDayLine: dayLine, lastCareLine: careLine };
  }

  const spokenAt = next.lastContext === context ? next.lastSpokenAt : null;
  const visible = spokenAt !== null && now - spokenAt < visibleFor;
  const nextAllowed = context === next.lastContext && repeatEvery !== null && spokenAt !== null ? spokenAt + repeatEvery : null;
  const obs = b.relationship.observation;
  return {
    decision: {
      key,
      variant: context === next.lastContext ? next.lastVariant ?? variant : stableVariant(`${episode}|${key}`, variantCount(key)),
      visible,
      spokenAt,
      reason,
      observation: visible ? observation : null,
      dayLine: visible ? dayLine : null,
      careLine: visible ? careLine : null,
      cooldownRemainingMs: nextAllowed ? Math.max(0, nextAllowed - now) : spokenAt !== null && context === next.lastContext ? Infinity : 0,
      onceStatus: obs ? `${obs.id}: ${next.onceFlags.includes(`${episode}:${obs.id}`) ? 'already said this episode' : 'not said yet'}` : 'no observation',
    },
    memory: next,
  };
}

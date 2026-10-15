import React from 'react';
import { Sparkles } from 'lucide-react';
import type { PlantBehaviourState } from '../../behaviour/behaviourTypes';
import type { ExpressionState } from '../../expression/expressionTypes';
import { CONDITION_LABELS } from '../../health/labels';
import type { PlantEvent } from '../../history/historyTypes';
import { ago, clock, duration, Row, Section } from './debugUi';

interface Props {
  behaviour: PlantBehaviourState | null;
  expression: ExpressionState | null;
  recentEvents: PlantEvent[];
  previewing: boolean;
}

const mins = (ms: number | null) => (ms === null ? 'until something changes' : ms <= 0 ? 'may speak again' : `${Math.ceil(ms / 60000)} min`);

// Why the tree looks and speaks the way it does: health + history + care → behaviour → expression.
export const BehaviourDebugPanel: React.FC<Props> = ({ behaviour: b, expression: x, recentEvents, previewing }) => {
  if (!b || !x) return <Section title="Behaviour debug">Waiting for the first evaluation…</Section>;
  const lastEvent = recentEvents[0] ?? null;
  const rel = b.relationship;
  const m = x.message;

  return (
    <div className="space-y-3" id="behaviour-debug-panel">
      <h3 className="sans text-xs font-bold uppercase tracking-wider text-[#2D332A] flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-[#D49B53]" /> Behaviour debug
        {previewing && <span className="normal-case font-medium text-[#8F5E24]">(preview: no history, care or speech memory)</span>}
      </h3>

      <Section title="Inputs">
        <Row label="Health condition" value={CONDITION_LABELS[b.primaryState]} strong />
        <Row label="Modifiers" value={b.modifiers.length ? b.modifiers.map((md) => CONDITION_LABELS[md]).join(', ') : '–'} />
        <Row label="Previous state" value={b.previousState ? CONDITION_LABELS[b.previousState] : '–'} />
        <Row label="Episode duration" value={`${duration(b.episode.minutes)}${b.episode.id !== null ? ` (episode #${b.episode.id})` : ''}`} />
        <Row label="Recent event" value={lastEvent ? `${lastEvent.type.replace('_', ' ')} ${ago(lastEvent.timestamp)}` : '–'} />
        <Row label="Time of day" value={b.timeOfDay} />
      </Section>

      <Section title="Behaviour">
        <Row label="Mood" value={b.mood} strong />
        <Row label="Energy" value={b.energy} />
        <Row label="Responsiveness" value={b.responsiveness} />
        <Row label="Intensity" value={`${b.expressionIntensity} · tier ${b.intensityTier}`} />
        <Row label="Recovery stage" value={b.recoveryStage ?? (b.afterglow ? 'afterglow (recently recovered)' : '–')} />
        <Row label="Reaction (diffraction)" value={b.reaction ? b.reaction.kind : '–'} />
        {b.reasons.map((r) => (
          <p key={r} className="sans text-[10.5px] text-[#2D332A]/60">• {r}</p>
        ))}
      </Section>

      <Section title="Speech">
        <Row label="Message intent" value={b.messageIntent} strong />
        <Row label="Catalog key · variant" value={`${m.key} · #${m.variant}`} />
        <Row label="Speaking now" value={m.visible ? 'yes' : 'no (silent)'} tone={m.visible ? undefined : 'muted'} />
        <Row label="Why" value={m.reason} />
        <Row label="Last spoken" value={m.spokenAt ? `${clock(m.spokenAt)} (${ago(m.spokenAt)})` : '–'} />
        <Row label="Cooldown remaining" value={mins(m.cooldownRemainingMs)} />
        <Row label="Once-per-episode" value={m.onceStatus} />
        <Row label="Time-of-day line" value={b.dayLine ?? '–'} />
        <p className="serif italic text-sm text-[#2D332A] pt-1">“{m.text}”</p>
      </Section>

      <Section title="Expression">
        <p className="sans text-[11px] text-[#2D332A]/85">{x.layers.epidermal.join(' · ')}</p>
        <Row label="Face" value={`${x.avatar.eyes} eyes · ${x.avatar.mouth} mouth`} />
        <Row label="Leaf droop" value={x.leafDroop} />
        <Row label="Sway speed / amount" value={`${x.motion.swaySpeed} / ${x.motion.swayAmount}`} />
        <Row label="Leaf flutter · blink every" value={`${x.motion.flutter} · ${x.motion.blinkEveryMs ? `${(x.motion.blinkEveryMs / 1000).toFixed(1)}s` : 'eyes closed'}`} />
        <Row label="Reaction strength" value={x.reactionStrength} />
        <Row label="Touch (petting)" value={`${x.touch.kind.replace('_', ' ')} · give ${x.touch.give} · lean ${x.touch.lean} · blink ${x.touch.blink.replace('_', ' ')}`} />
        <Row label="Effects" value={x.avatar.effects.join(', ') || '–'} />
        <Row label="Atmosphere" value={`${x.atmosphere.theme} (${x.atmosphere.phase.replace('_', ' ')})`} />
        <p className="sans text-[10px] font-semibold text-[#2D332A]/45 uppercase tracking-wider pt-1">Diffraction</p>
        <p className="sans text-[11px] text-[#2D332A]/85">{x.layers.diffraction ?? 'none: no recent care or recovery shaping this moment'}</p>
      </Section>

      <Section title="Relationship memory">
        <Row label="Last care" value={rel.lastCareAt ? ago(rel.lastCareAt) : '–'} />
        <Row label="Thirst episodes (30 days)" value={`${rel.thirstEpisodes30d} · watered within 6h: ${rel.thirstAnsweredWithin6h}`} />
        <Row label="Typical thirst before watering" value={rel.typicalThirstHoursBeforeWatering !== null ? `${rel.typicalThirstHoursBeforeWatering}h` : '–'} />
        <Row label="Waterings today" value={rel.wateringsToday} />
        <Row label="Waterings on wet soil (7 days)" value={rel.overwateringEvents7d} />
        <Row label="Typical recovery" value={rel.typicalRecoveryHours !== null ? `${rel.typicalRecoveryHours}h` : '–'} />
        <Row label="Observation" value={rel.observation ? rel.observation.id.replace(/_/g, ' ') : '–'} />
        <Row label="Petting sessions (7 days, attention)" value={`${rel.attention?.petSessions7d ?? 0}${rel.attention?.lastPetAt ? ` · last ${ago(rel.attention.lastPetAt)}` : ''}`} />
      </Section>
    </div>
  );
};

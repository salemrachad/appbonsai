import React from 'react';
import { Sparkles } from 'lucide-react';
import type { DreamFragment, PlantBehaviourState } from '../../behaviour/behaviourTypes';
import { APP_CONFIG } from '../../config/appConfig';
import { dreamScene } from '../../behaviour/messages';
import { phaseText } from '../../behaviour/dreams';
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

// A dream motif's weight as it was reached: intensity × novelty + recurrence + company (older nights: the total)
const weight = (f: DreamFragment) =>
  `${f.motif.replace('_', ' ')} ${f.salience}${f.parts ? ` = ${f.parts.intensity} × ${f.parts.novelty.toFixed(2)} + ${f.parts.recurrence} + ${f.parts.company}` : ''} · ${f.source}${f.role !== 'day' ? ` (${f.role})` : ''} · ${f.why}${f.out ? ` → ${f.out}` : ''}`;

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
        <Row label="Outside (context, never health)" value={x.atmosphere.weather ? x.atmosphere.weather.label : 'unknown / stale'} />
        <Row label="Dragonfly (the air of the last hours)" value={b.habitat?.dragonfly ? `${b.habitat.dragonfly.value} · ${b.habitat.dragonfly.active ? 'active' : 'not active'} · ${b.habitat.dragonfly.visitsToday.count} visits today${b.habitat.dragonfly.visit?.route ? ` · route: ${b.habitat.dragonfly.visit.route.map((x) => x.perch.replace("_", " ") + (x.mode === "hovering" ? " (hover)" : "")).join(" → ")}` : ""} — ${b.habitat.dragonfly.why}` : '–'} />
        <Row label="Lucy (household clock, outside weather)" value={b.habitat?.lucy ? `${b.habitat.lucy.presence.replace('_', ' ')} · ${b.habitat.lucy.visitsToday.count} visits (${b.habitat.lucy.visitsToday.minutes} min) today · weather ${Object.entries(b.habitat.lucy.weather).filter(([, on]) => on).map(([k]) => k).join(', ') || 'calm'}${b.habitat.lucy.visit ? ` · settle ${b.habitat.lucy.visit.settle} · until ${new Date(b.habitat.lucy.visit.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''} — ${b.habitat.lucy.why}` : '–'} />
        <Row label="Sloth (warm, humid, still air)" value={b.habitat?.sloth ? `${b.habitat.sloth.value} · ${b.habitat.sloth.active ? 'active' : 'not active'} · ${b.habitat.sloth.visitsToday.count} visits (${b.habitat.sloth.visitsToday.minutes} min) today${b.habitat.sloth.visit ? ` · grip ${b.habitat.sloth.visit.grip.replace(/_/g, ' ')}` : ''} — ${b.habitat.sloth.why}` : '–'} />
        <Row label="Encounters (visitors together)" value={x.encounters?.length ? x.encounters.map((e) => e.replace('_', ' + ')).join(', ') : '–'} />
        <Row label="Thoughts of the day" value={b.voice ? (b.voice.budget > 0 ? `${b.voice.budget} today, ≥ ${Math.round(b.voice.gapMs / 60000)} min apart · true now: ${b.voice.musings.map((x) => x.id.replace(/_/g, ' ')).join(', ') || '–'}` : b.voice.why) : '–'} />
        <Row label="Canopy (last weeks, drawn only)" value={b.canopy ? `${Math.round(b.canopy.fullness * 100)}% · ${b.canopy.trend}${b.canopy.refilling ? ` · fresh tips ${Math.round(b.canopy.refilling * 100)}%` : ''} — ${b.canopy.reasons.join('; ')}` : '–'} />
      </Section>

      <Section title="Behaviour">
        <Row label="Mood" value={b.mood} strong />
        {/* Older servers send no mood layer */}
        {b.moodState && (
          <>
            <Row
              label="· feeling (valence · arousal)"
              value={`${b.moodState.valence} · ${b.moodState.arousal} → drifting to ${b.moodState.target.valence} · ${b.moodState.target.arousal}${b.moodState.forced ? ' (event mood)' : ''}`}
            />
            <Row label="· anchor (health)" value={`${b.moodState.base} · ceiling ${b.moodState.ceiling}`} />
            <Row
              label="· nudges"
              value={b.moodState.influences.filter((x) => x.source !== 'health').map((x) => `${x.source} ${x.v >= 0 ? '+' : ''}${x.v}/${x.a >= 0 ? '+' : ''}${x.a} (${x.why})`).join(' · ') || 'none'}
            />
          </>
        )}
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
        <Row label="Touch (petting)" value={`${x.touch.kind.replace('_', ' ')} · give ${x.touch.give} · lean ${x.touch.lean} · blink ${x.touch.blink.replace('_', ' ')} · familiarity ${x.touch.familiarity} · settles to ${x.touch.habituation.floor} at ${x.touch.habituation.settlePerSec}/s`} />
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
        <Row label="Petting sessions (7 days, attention)" value={`${rel.attention?.petSessions7d ?? 0}${rel.attention?.lastPetAt ? ` · last ${ago(rel.attention.lastPetAt)}` : ''} · familiarity ${rel.attention?.familiarity ?? 0}`} />
      </Section>

      {b.habitat && (
        <Section title="Habitat (visitors · art, never health)">
          <Row label="Welcoming" value={`${b.habitat.value} · ${b.habitat.welcoming ? 'yes' : 'no'}${b.habitat.lastChangeAt ? ` (since ${ago(b.habitat.lastChangeAt)})` : ''}`} strong />
          <Row label="Observed (14 days)" value={`${b.habitat.calmHours14d}h calm · ${b.habitat.stressHours14d}h stress`} />
          <Row
            label="Right now"
            value={b.habitat.visit ? `squirrel ${b.habitat.presence} · ${b.habitat.visit.spot.replace('_', ' ')} · until ${clock(b.habitat.visit.endsAt)}` : b.habitat.why}
          />
          {/* Older servers send no memory */}
          {b.habitat.memory && (
            <>
              <Row label="Squirrel trust" value={`${b.habitat.memory.trust} · ${b.habitat.memory.stage}${b.habitat.traces ? ` (${b.habitat.traces.replace(/_/g, ' ')})` : ''}${b.habitat.memory.brokenAt ? ` · broken ${ago(b.habitat.memory.brokenAt)}` : ''}`} />
              <Row
                label="Squirrel habits"
                value={`${b.habitat.memory.usualHour !== null ? `around ${b.habitat.memory.usualHour}:00` : 'no usual hour yet'} · ${b.habitat.memory.favouriteSpot?.replace('_', ' ') ?? 'no favourite spot'} · boldness ${b.habitat.memory.boldness} · ${b.habitat.memory.pastVisits} past visits`}
              />
            </>
          )}
          {b.habitat.sloth?.memory && (
            <Row label="Sloth loyalty" value={`${b.habitat.sloth.memory.loyalty} · ${b.habitat.sloth.memory.homeBranch?.replace('_', ' ') ?? 'no home branch'} · ${b.habitat.sloth.memory.daysWithIt} days with it (14)`} />
          )}
          {x.visitor && x.visitor.id.startsWith('preview') && <Row label="Shown" value={`preview: squirrel ${x.visitor.mode}`} />}
        </Section>
      )}

      {b.dream && (
        <Section title="Dreams (the night · art, never health)">
          <p className="sans text-[10.5px] text-[#2D332A]/55">
            Not a latch, so no hysteresis: tonight is weighed once when the night begins (intensity × novelty + recurrence + company), then plays on a fixed timeline.
            {previewing && ' Previewing: this is the browser’s re-run without the stored nights, not the real night.'}
          </p>
          <Row label="Night" value={b.dream.night ? `${b.dream.night.key} · ${clock(b.dream.night.startsAt)} → sunrise ${clock(b.dream.night.endsAt)}` : 'by day'} strong />
          <Row
            label="Now"
            value={
              b.dream.phase === 'dreaming' && b.dream.motif
                ? `dreaming of ${dreamScene(b.dream.motif, b.dream.with)}${b.dream.restless ? ' (restless)' : ''} · until ${b.dream.phaseEndsAt ? clock(b.dream.phaseEndsAt) : '?'}`
                : b.dream.phase === 'deep'
                ? `deep sleep${b.dream.phaseEndsAt ? ` · next dream ${clock(b.dream.phaseEndsAt)}` : ''}`
                : b.dream.why
            }
          />
          {b.dream.tonight && (
            <>
              {b.dream.tonight.motifs.length ? (
                b.dream.tonight.motifs.map((f) => <Row key={f.motif} label="Tonight" value={weight(f)} />)
              ) : (
                <Row label="Tonight" value="nothing weighed enough: a deep, dreamless night" />
              )}
              {(b.dream.tonight.alsoRan ?? []).map((f) => <Row key={`out-${f.motif}`} label="Left out" value={weight(f)} tone="muted" />)}
              <Row label="Beside it" value={b.dream.tonight.cast.length ? b.dream.tonight.cast.join(', ') : 'nobody'} />
              <Row
                label="Timeline"
                value={
                  b.dream.tonight.phases.length ? (
                    <span className="flex flex-col items-end">
                      {b.dream.tonight.phases.map((p) => (
                        <span key={p.from} className={p.from <= b.evaluatedAt && b.evaluatedAt < p.to ? 'font-bold' : undefined}>
                          {p.from <= b.evaluatedAt && b.evaluatedAt < p.to ? '● ' : ''}
                          {phaseText(p)}
                        </span>
                      ))}
                    </span>
                  ) : (
                    '–'
                  )
                }
              />
            </>
          )}
          <Row
            label="Last night"
            value={
              b.dream.lastNight
                ? `${b.dream.lastNight.key} · ${b.dream.lastNight.dreamt.length ? b.dream.lastNight.dreamt.join(', ') : 'dreamless'}${b.dream.lastNight.restless ? ' · restless' : ''} · morning line: ${
                    b.dream.lastNight.told ? `“${dreamScene(b.dream.lastNight.told, b.dream.lastNight.toldWith)}”${b.dream.lastNight.again > 1 ? ` again ×${b.dream.lastNight.again}` : ''}` : 'nothing told'
                  }`
                : 'no stored night'
            }
          />
          <Row
            label="Recurring worries"
            value={
              b.dream.recurring.length
                ? b.dream.recurring.map((r) => `${r.motif.replace('_', ' ')} ${r.strength} (${r.nights} nights)`).join(' · ')
                : `none (a worry recurs at strength ≥ ${APP_CONFIG.dreams.recurrence.min}, fading τ ${APP_CONFIG.dreams.recurrence.tauDays} days)`
            }
          />
          {x.dream && x.dream.key.startsWith('preview') && <Row label="Shown" value={`preview: ${x.dream.motif ? dreamScene(x.dream.motif, x.dream.with) : '–'}`} />}
        </Section>
      )}
    </div>
  );
};

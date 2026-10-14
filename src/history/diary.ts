import { CONDITION_LABELS } from '../health/labels';
import type { HealthCondition } from '../health/healthTypes';
import type { BehaviourEpisode, DiaryItem, PlantEvent } from './historyTypes';

// Calm, narrative titles for the plant diary (History). One line per meaningful change.
function episodeTitle(c: HealthCondition, prev: HealthCondition | null): string {
  switch (c) {
    case 'thirsty': return 'Started getting thirsty';
    case 'very_dry': return 'Soil became very dry';
    case 'too_wet': return 'Soil stayed soggy';
    case 'hot': return 'Started feeling the heat';
    case 'hot_and_dry': return 'Hot and drying out';
    case 'cold': return 'Got chilly';
    case 'freezing_risk': return 'Dangerously cold';
    case 'too_dark': return 'Too dim for a while';
    case 'very_bright': return 'Very bright light';
    case 'dry_air': return 'Air turned dry';
    case 'high_humidity': return 'Very humid air';
    case 'recovering': return prev ? `Recovering from ${CONDITION_LABELS[prev].toLowerCase()}` : 'Recovering';
    case 'sleeping': return 'Fell asleep';
    case 'multiple_stress': return 'Several stresses at once';
    case 'sensor_uncertain': return 'Lost touch with the sensor';
    case 'thriving': return 'Thriving';
    case 'comfortable':
      return prev === 'sleeping' ? 'Woke up' : prev === 'recovering' ? 'Comfortable again' : prev === 'sensor_uncertain' ? 'Sensor back' : 'Comfortable';
  }
}

const EVENT_TITLE: Record<PlantEvent['type'], string> = {
  watering: 'Watered',
  pruning: 'Pruned',
  fertilizing: 'Fertilized',
  repotting: 'Repotted',
  moved_location: 'Moved to a new spot',
  manual_note: 'Note',
};

// Episodes + care events → diary lines, newest first.
export function buildDiary(episodes: BehaviourEpisode[], events: PlantEvent[], gapMs: number): DiaryItem[] {
  const items: DiaryItem[] = [];
  const eps = [...episodes].sort((a, b) => a.startedAt - b.startedAt);
  for (let i = 0; i < eps.length; i++) {
    const e = eps[i];
    const prev = eps[i - 1];
    if (prev && prev.endedAt !== null && e.startedAt - prev.endedAt > gapMs) {
      items.push({ at: prev.endedAt, kind: 'episode_gap', title: 'Not observed', detail: 'App or sensor was off' });
    }
    const contiguousPrev = prev && (prev.endedAt === null || e.startedAt - prev.endedAt <= gapMs) ? prev.condition : null;
    const mods = e.modifiers.filter((m) => m !== e.condition).map((m) => CONDITION_LABELS[m].toLowerCase());
    const unobservedMin = Math.round((e.unobservedMs ?? 0) / 60000);
    const details = [mods.length ? `with ${mods.join(', ')}` : '', unobservedMin >= 5 ? `${unobservedMin} min not observed` : ''].filter(Boolean);
    items.push({
      at: e.startedAt,
      kind: 'episode_start',
      title: episodeTitle(e.condition, contiguousPrev),
      detail: details.length ? details.join(' · ') : undefined,
      condition: e.condition,
    });
  }
  for (const ev of events) {
    const m = ev.metadata;
    const soil = m.moistureBefore != null && m.moistureAfter != null ? `soil ${m.moistureBefore}% → ${m.moistureAfter}%` : null;
    const by =
      ev.type !== 'watering' ? null : m.source === 'manual' ? (m.confirmedBySensor ? 'logged by you, confirmed by the sensor' : 'logged by you') : 'detected by the soil sensor';
    items.push({
      at: ev.timestamp,
      kind: 'event',
      title: EVENT_TITLE[ev.type],
      detail: [soil, by, ev.note].filter(Boolean).join(' · ') || undefined,
      eventType: ev.type,
    });
  }
  return items.sort((a, b) => b.at - a.at);
}

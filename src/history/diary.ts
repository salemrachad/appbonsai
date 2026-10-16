import { CONDITION_LABELS } from '../health/labels';
import type { HealthCondition } from '../health/healthTypes';
import type { OutsideObservation } from '../telemetry/outsideWeather';
import type { BehaviourEpisode, DiaryItem, PlantEvent, WeatherSpellKind } from './historyTypes';
import { hhmm } from '../lib/time';

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

const SPELL_TITLE: Record<WeatherSpellKind, string> = {
  rain: 'Rain outside',
  storm: 'Storm outside',
  snow: 'Snow outside',
  fog: 'Fog outside',
  frost: 'Frost outside',
};
const SPELL_JOIN_MS = 45 * 60 * 1000; // observations further apart than this start a new spell

function spellKind(o: OutsideObservation): WeatherSpellKind | null {
  if (o.sky === 'thunderstorm') return 'storm';
  if (o.sky === 'drizzle' || o.sky === 'rain' || o.sky === 'heavy_rain') return 'rain';
  if (o.sky === 'snow') return 'snow';
  if (o.temperature !== null && o.temperature <= 0) return 'frost';
  if (o.sky === 'fog') return 'fog';
  return null;
}


// Outside weather → one diary line per notable spell (rain, storm, snow, fog, frost). Context only.
export function weatherSpells(observations: OutsideObservation[]): DiaryItem[] {
  const items: DiaryItem[] = [];
  let spell: { kind: WeatherSpellKind; from: number; to: number; min: number | null } | null = null;
  const close = () => {
    if (!spell) return;
    const range = spell.to - spell.from >= 20 * 60 * 1000 ? `${hhmm(spell.from)}–${hhmm(spell.to)}` : `around ${hhmm(spell.from)}`;
    const detail = spell.kind === 'frost' && spell.min !== null ? `${range} · down to ${Math.round(spell.min)}°C` : range;
    items.push({ at: spell.from, kind: 'weather', title: SPELL_TITLE[spell.kind], detail, weather: spell.kind });
    spell = null;
  };
  for (const o of [...observations].sort((a, b) => a.at - b.at)) {
    const kind = spellKind(o);
    if (spell && (kind !== spell.kind || o.at - spell.to > SPELL_JOIN_MS)) close();
    if (!kind) continue;
    const t = o.temperature;
    if (!spell) spell = { kind, from: o.at, to: o.at, min: t };
    else spell = { ...spell, to: o.at, min: t === null ? spell.min : spell.min === null ? t : Math.min(spell.min, t) };
  }
  close();
  return items;
}

// Episodes + care events (+ outside weather spells) → diary lines, newest first.
export function buildDiary(episodes: BehaviourEpisode[], events: PlantEvent[], gapMs: number, outside: OutsideObservation[] = []): DiaryItem[] {
  const items: DiaryItem[] = [...weatherSpells(outside)];
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

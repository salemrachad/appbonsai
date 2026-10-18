import type { BehaviourEpisode, Interaction, PlantEvent } from '../history/historyTypes';
import { APP_CONFIG } from '../config/appConfig';
import type { SpeciesProfile } from '../species';
import type { HealthCondition } from '../health/healthTypes';
import type { RelationshipContext } from './behaviourTypes';
import { DAY, HOUR, startOfDay } from '../lib/time';

const THIRST: HealthCondition[] = ['thirsty', 'very_dry', 'hot_and_dry'];

const median = (xs: number[]) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const startOfToday = startOfDay; // the tree's day

export interface RelationshipInput {
  episodes: BehaviourEpisode[]; // any order
  events: PlantEvent[]; // any order
  interactions?: Interaction[]; // attention sessions, any order
  current: { condition: HealthCondition; startedAt: number };
  soilMoisture: number | null;
  species: SpeciesProfile;
  now: number;
}

// Familiarity with the caretaker's hand, 0 (neutral) … 1. Built from the DAYS someone petted the tree,
// so a long session or fifty quick ones count the same as one stroke that day. Each day fades with
// familiarityTauDays and stops counting after the window: absence only returns it to neutral, never below.
function familiarity(pets: Interaction[], now: number): number {
  const { familiarityTauDays: tau, familiaritySaturation: sat, familiarityWindowDays: window } = APP_CONFIG.attention;
  const today = startOfToday(now);
  const days = new Set<number>();
  for (const p of pets) {
    const d = startOfToday(p.startedAt);
    if (d > today - window * DAY && d <= today) days.add(d);
  }
  let weight = 0;
  for (const d of days) weight += Math.exp(-Math.round((today - d) / DAY) / tau);
  return Math.round((1 - Math.exp(-weight / sat)) * 100) / 100;
}

// Memory of how care usually goes. Observational and plant-centred: it never scores or blames.
export function computeRelationship({ episodes, events, interactions = [], current, soilMoisture, species, now }: RelationshipInput): RelationshipContext {
  const waterings = events.filter((e) => e.type === 'watering').sort((a, b) => a.timestamp - b.timestamp);
  const care = events.filter((e) => e.type !== 'manual_note' && e.timestamp <= now);
  const lastCareAt = care.length ? Math.max(...care.map((e) => e.timestamp)) : null;

  // Thirst episodes in the last 30 days and how soon water followed
  const thirst = episodes.filter((e) => THIRST.includes(e.condition) && e.startedAt >= now - 30 * DAY);
  const delays: number[] = [];
  for (const ep of thirst) {
    const end = ep.endedAt ?? now;
    const w = waterings.find((x) => x.timestamp >= ep.startedAt && x.timestamp <= end + 30 * 60 * 1000);
    if (w) delays.push((w.timestamp - ep.startedAt) / HOUR);
  }
  const answeredWithin6h = delays.filter((d) => d <= 6).length;
  const usuallyNoticesThirst = thirst.length >= 3 && answeredWithin6h / thirst.length >= 0.7;

  const wateringsToday = waterings.filter((w) => w.timestamp >= startOfToday(now)).length;
  const overwatering7d = waterings.filter(
    (w) =>
      w.timestamp >= now - 7 * DAY &&
      (w.metadata.conditionBefore === 'too_wet' || (w.metadata.moistureBefore ?? 0) >= species.soilMoisture.maxOptimal)
  ).length;

  const recoveries = episodes.filter((e) => e.condition === 'recovering' && e.endedAt !== null && e.startedAt >= now - 30 * DAY);
  const typicalRecoveryHours = median(recoveries.map((e) => (e.endedAt! - e.startedAt) / HOUR));

  // One gentle observation, most relevant first (structured: wording lives in messages.ts)
  let observation: RelationshipContext['observation'] = null;
  const currentHours = (now - current.startedAt) / HOUR;
  if (THIRST.includes(current.condition) && current.startedAt < startOfToday(now) && currentHours >= 6) {
    observation = { id: 'thirsty_since_yesterday', hours: Math.round(currentHours) };
  } else if (wateringsToday >= 2 && soilMoisture !== null && soilMoisture >= species.soilMoisture.maxOptimal) {
    observation = { id: 'lots_of_water_today' };
  } else if (THIRST.includes(current.condition) && usuallyNoticesThirst) {
    observation = { id: 'usually_notices_thirst' };
  } else if (current.condition === 'recovering' && typicalRecoveryHours !== null) {
    observation = { id: 'typical_recovery', hours: Math.max(1, Math.round(typicalRecoveryHours)) };
  }

  // Attention: remembered, never scored. No streaks, no "you were away" and no reward for frequency.
  const pets = interactions.filter((i) => i.kind === 'pet' && i.startedAt <= now);
  const attention = {
    petSessions7d: pets.filter((i) => i.endedAt >= now - 7 * DAY).length,
    lastPetAt: pets.length ? Math.max(...pets.map((i) => i.endedAt)) : null,
    familiarity: familiarity(pets, now),
  };

  return {
    lastCareAt,
    hoursSinceCare: lastCareAt !== null ? Math.round(((now - lastCareAt) / HOUR) * 10) / 10 : null,
    thirstEpisodes30d: thirst.length,
    thirstAnsweredWithin6h: answeredWithin6h,
    typicalThirstHoursBeforeWatering: delays.length ? Math.round(median(delays)! * 10) / 10 : null,
    usuallyNoticesThirst,
    wateringsToday,
    overwateringEvents7d: overwatering7d,
    typicalRecoveryHours: typicalRecoveryHours !== null ? Math.round(typicalRecoveryHours * 10) / 10 : null,
    observation,
    attention,
  };
}

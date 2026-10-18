import type { PlantHealthState } from '../health/healthTypes';
import type { PerceptionState } from '../perception/perceptionTypes';
import type { SpeciesProfile } from '../species';
import type { CanopyState, HabitatState, Musing, MusingId, PlantBehaviourState, RelationshipContext, VoiceState } from './behaviourTypes';
import { ENCOUNTER_PAIRS } from './encounters';
import { stableVariant } from './speech';
import { DAY, dayKey, HOUR, hourOf } from '../lib/time';

// The tree's voice for the day: how many thoughts it has to share, and which ones are true right now.
//
// Living Art: personality comes from real patterns, never filler. So
// - the BUDGET (thoughts per day) follows the tree's energy: vitality × the growth phase of the season
//   (a thriving summer day ≈ 10, a calm autumn day ≈ 6, a winter rest day ≈ 4). Only calm, awake states
//   muse; a stressed tree keeps talking about its stress, an asleep one is silent;
// - every CANDIDATE is grounded in today's measured data (soil and its trend, light, air inside vs out,
//   the day length, the squirrel, the canopy). No data, no thought;
// - the speech policy spreads them over the daylight hours, says each at most once a day, and never
//   interrupts something more important. Wording lives in messages.ts (by id, with facts).

const MUSING_INTENTS: PlantBehaviourState['messageIntent'][] = ['joy', 'content', 'afterglow'];
const SEASON_VOICE: Record<SpeciesProfile['seasons'][keyof SpeciesProfile['seasons']]['growth'], number> = { flush: 1, active: 1, slowing: 0.7, resting: 0.4 };

export interface VoiceInput {
  health: PlantHealthState;
  perception: PerceptionState;
  species: SpeciesProfile;
  intent: PlantBehaviourState['messageIntent'];
  timeOfDay: PlantBehaviourState['timeOfDay'];
  season: PlantBehaviourState['season'];
  relationship: RelationshipContext;
  habitat: HabitatState;
  canopy: CanopyState;
  now: number;
}

const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;

export function evaluateVoice({ health, perception: p, species, intent, timeOfDay, season, relationship, habitat, canopy, now }: VoiceInput): VoiceState {
  const calm = MUSING_INTENTS.includes(intent) && timeOfDay !== 'night' && !health.modifiers.includes('sensor_uncertain');
  const f = Math.max(0, Math.min(1, (health.vitality - 50) / 50)) * SEASON_VOICE[season.growth];
  const budget = calm ? Math.max(1, Math.min(10, Math.round(1 + 9 * f))) : 0;
  // Spread over the useful daylight: roughly evenly, never closer than 40 minutes
  const daylight = p.season.daylightHours ?? 12;
  const gapMs = Math.round(Math.max(40, Math.min(180, (daylight * 60) / (budget + 1)))) * 60 * 1000;
  if (!calm) return { budget, gapMs, musings: [], why: 'not musing: the tree has something more important to say, or is resting' };

  const out: Musing[] = [];
  const add = (id: MusingId, facts: Musing['facts'], weight: number) => out.push({ id, facts, weight });
  const r = p.readings;
  const soil = species.soilMoisture;
  const thirstyAt = species.latches.thirsty.enter;

  // ---- Soil & water ----
  if (r.soilMoisture !== null && r.soilMoisture >= soil.minOptimal && r.soilMoisture <= soil.maxOptimal) {
    // A prediction only when the dry-down segment is evidence enough (high/medium confidence)
    const dry = p.trends.soilDryDown;
    const rate = dry && dry.confidence !== 'low' ? dry.perHour : null; // %/h, negative = drying
    if (rate !== null && rate < -0.05) {
      const hours = (r.soilMoisture - thirstyAt) / -rate;
      add('soil_steady', { soil: r0(r.soilMoisture), hoursToThirsty: r1(hours) }, 3);
    } else add('soil_steady', { soil: r0(r.soilMoisture), hoursToThirsty: -1 }, 2);
  }
  const lastWater = p.care.lastWatering?.timestamp ?? null;
  if (lastWater !== null && r.soilMoisture !== null && r.soilMoisture >= soil.minOptimal) {
    const days = (now - lastWater) / DAY;
    if (days >= 2) add('days_since_water', { days: r0(days) }, 2);
    // Settled after a drink: 3 to 24 hours after a watering, the soil back in its optimal range
    const since = now - lastWater;
    if (since >= 3 * HOUR && since <= DAY && r.soilMoisture <= soil.maxOptimal) add('settled_after_drink', { soil: r0(r.soilMoisture), hours: r0(since / HOUR) }, 2);
  }

  // ---- Light & the day ----
  const light = p.light;
  if (light.peak !== null && (timeOfDay === 'day' || timeOfDay === 'evening') && hourOf(now) >= 13 && light.peak >= species.light.usefulMinPercent) {
    if (r.lightPercent === null || r.lightPercent < light.peak * 0.8) add('brightest_hour', { peak: r0(light.peak) }, 2);
  }
  if (light.usefulShare !== null && light.observedDaylightMin >= 180 && light.usefulShare >= species.light.usefulShareTarget * 100) {
    add('good_light_day', { usefulHours: r1(light.usefulMin / 60) }, 2);
  }
  const change = p.season.daylightChangeMinPerWeek;
  if (change !== null && Math.abs(change) >= 5 && timeOfDay === 'morning') {
    add(change < 0 ? 'days_shorter' : 'days_longer', { minPerDay: Math.max(1, r0(Math.abs(change) / 7)), daylight: r1(daylight) }, 1);
  }

  if (r.lightPercent !== null && timeOfDay !== 'evening' && r.lightPercent >= species.light.usefulMinPercent) {
    add('light_now', { light: r0(r.lightPercent) }, 1);
  }

  // ---- Air & the greenhouse ----
  if (timeOfDay === 'morning' && r.humidity !== null && r.humidity >= species.humidity.maxOptimal) {
    add('humid_morning', { rh: r0(r.humidity), fog: p.air?.glassMayFog ? 1 : 0 }, 2);
  }
  if (r.temperature !== null && timeOfDay === 'day') {
    const today = p.recent.filter((s) => s.t >= now - 12 * HOUR && s.temp !== null).map((s) => s.temp!);
    if (today.length >= 30 && r.temperature >= Math.max(...today) - 0.2 && r.temperature >= species.temperature.minOptimal) add('warmest_hour', { temp: r1(r.temperature) }, 1);
  }
  // Evening: cooling down (at least 2 °C below two hours ago)
  if (timeOfDay === 'evening' && r.temperature !== null) {
    const then = p.recent.find((s) => s.t >= now - 2 * HOUR && s.temp !== null);
    if (then && then.t <= now - 90 * 60 * 1000 && then.temp! - r.temperature >= 2) add('evening_cooling', { from: r1(then.temp!), to: r1(r.temperature) }, 2);
  }
  // A cool, still fine morning (within 2 °C above the optimal minimum)
  if (timeOfDay === 'morning' && r.temperature !== null && r.temperature >= species.temperature.minOptimal && r.temperature <= species.temperature.minOptimal + 2) {
    add('cool_morning', { temp: r1(r.temperature) }, 1);
  }
  // Gentle air: humidity in its optimal range for the last hour, and the VPD optimal now
  const lastHour = p.recent.filter((s) => s.t >= now - HOUR && s.hum !== null);
  if (
    r.vpd !== null &&
    r.vpd >= species.vpd.minOptimal &&
    r.vpd <= species.vpd.maxOptimal &&
    lastHour.length >= 20 &&
    lastHour.every((s) => s.hum! >= species.humidity.minOptimal && s.hum! <= species.humidity.maxOptimal)
  ) {
    add('air_gentle', { rh: r0(r.humidity ?? lastHour[lastHour.length - 1].hum!), vpd: Math.round(r.vpd * 100) / 100 }, 1);
  }
  if (p.air && p.outside?.temperature != null && r.temperature !== null && r.temperature - p.outside.temperature >= 5) {
    add('warmer_than_outside', { inside: r0(r.temperature), outside: r0(p.outside.temperature) }, 2);
  }

  // ---- Life around it ----
  if (habitat.visitsToday.count > 0 && habitat.presence === 'none') add('squirrel_came', { count: habitat.visitsToday.count, firstAt: habitat.visitsToday.firstAt ?? now }, 3);
  const df = habitat.dragonfly;
  if (df && df.visitsToday.count > 0 && df.presence === 'none') add('dragonfly_came', { count: df.visitsToday.count, firstAt: df.visitsToday.firstAt ?? now }, 2);
  const sl = habitat.sloth;
  if (sl && sl.visitsToday.count > 0 && sl.presence === 'none') add('sloth_came', { count: sl.visitsToday.count, minutes: sl.visitsToday.minutes }, 2);
  // Lucy lying by the pot, settled (not while she walks about or sits up): a quiet line, once a day
  const lu = habitat.lucy;
  if (lu?.visit && (lu.presence === 'down' || lu.presence === 'sleeping') && lu.visit.kind !== 'night') add('lucy_here', { count: Math.max(1, lu.visitsToday.count) }, 2);
  // Two visitors sharing the tree right now (rare: only while it happens, once a day)
  const met = habitat.encounters?.[0];
  if (met) add('visitors_met', { pair: ENCOUNTER_PAIRS.indexOf(met) }, 3);
  if (canopy.trend === 'refilling' && canopy.refilling > 0.1) add('new_tips', { fullness: r0(canopy.fullness * 100) }, 2);
  if (habitat.drey.stage === 'started') add('drey_growing', {}, 1);
  void relationship;

  // Today's order: weight first, then a stable per-day shuffle so different days lead with different topics
  const day = dayKey(now);
  out.sort((a, b) => b.weight - a.weight || stableVariant(`${day}:${a.id}`, 997) - stableVariant(`${day}:${b.id}`, 997));
  return { budget, gapMs, musings: out, why: `${budget} thoughts today (vitality ${health.vitality}, ${season.growth} season); ${out.length} true right now` };
}

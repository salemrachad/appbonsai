import type { SpeciesProfile } from '../species';
import type { OutsideObservation, OutsideSky } from '../telemetry/outsideWeather';
import type { PerceptionSample } from './perceptionTypes';
import { sunState } from './sun';

// "How much useful light did the tree get today?" from the relative LDR % (never lux), accumulated
// over the local calendar day. Only observed time counts: hours without data are reported as missing,
// never as darkness. Night readings never enter it.

const MIN = 60 * 1000;
const SLOT_MIN = 5; // resolution of the expected-daylight calculation

export interface DailyLight {
  date: string; // local YYYY-MM-DD
  since: number; // start of what is counted: local midnight, or a move to a new spot today
  expectedDaylightTotalMin: number; // useful-daylight window for the whole day (sun high enough)
  expectedDaylightSoFarMin: number;
  observedDaylightMin: number; // daylight time actually covered by readings
  missingDaylightMin: number; // expected so far, but no data (server/sensor away)
  usefulMin: number; // daylight at/above light.usefulMinPercent
  lowMin: number; // daylight at/below light.lowMaxPercent
  usefulShare: number | null; // useful / observed (%)
  greyMin: number; // observed daylight under a grey outside sky (overcast, fog, rain, snow, storm)
  explainedMin: number; // daylight that counted as useful/in-between only because the sky explained it
  peak: number | null; // strongest relative light seen in daylight
  average: number | null; // time-weighted average daylight %
  coverage: number | null; // observed / expected so far
  score: number | null; // 0-100 light health for today; null = not enough daylight observed yet
  confidence: 'high' | 'medium' | 'low';
  reasoning: string[];
}

const localDate = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const h1 = (min: number) => Math.round((min / 60) * 10) / 10;

// Which 5-minute slots of a day have the sun high enough for light to matter (cached per day/place).
const slotCache = new Map<string, boolean[]>();
function daylightSlots(dayStart: number, lat: number | null, lon: number | null, deg: number): boolean[] {
  const key = `${dayStart}|${lat}|${lon}|${deg}`;
  let slots = slotCache.get(key);
  if (!slots) {
    slots = [];
    for (let m = 0; m < 24 * 60; m += SLOT_MIN) slots.push(sunState(dayStart + (m + SLOT_MIN / 2) * MIN, lat, lon, deg).lightExpected);
    if (slotCache.size > 64) slotCache.clear();
    slotCache.set(key, slots);
  }
  return slots;
}

// Weather mode has radiation, not an LDR %: put it on the same relative scale.
function percentOf(s: PerceptionSample, species: SpeciesProfile): number | null {
  if (s.light !== null) return s.light;
  if (s.radiation === null) return null;
  const r = species.radiation;
  return s.radiation < r.minCritical ? 5 : s.radiation < r.minWarning ? 18 : s.radiation <= r.maxOptimal ? 45 : s.radiation <= r.maxWarning ? 75 : 95;
}

export interface DailyLightInput {
  samples: PerceptionSample[]; // oldest first, may include earlier days
  species: SpeciesProfile;
  location: { latitude: number | null; longitude: number | null };
  cadenceMs: number; // a reading represents at most this much time
  movedAt: number | null; // a move to a new spot: only light since then counts for that day
  now: number;
  outside?: OutsideObservation[]; // outside weather today (any order): a grey sky explains dim light
}

const SKY_MATCH_BEFORE_MS = 30 * MIN; // an observation describes the sky for this long after it…
const SKY_MATCH_AFTER_MS = 15 * MIN; // …and a little before

// The outside sky at time t (nearest earlier observation, else a slightly later one). null = unknown.
export function skyAt(observations: OutsideObservation[], t: number): OutsideSky | null {
  let best: OutsideObservation | null = null;
  for (const o of observations) {
    const d = t - o.at;
    if (d >= 0 ? d > SKY_MATCH_BEFORE_MS : -d > SKY_MATCH_AFTER_MS) continue;
    if (!best || Math.abs(t - o.at) < Math.abs(t - best.at)) best = o;
  }
  return best?.sky ?? null;
}

export function computeDailyLight({ samples, species, location, cadenceMs, movedAt, now, outside = [] }: DailyLightInput): DailyLight {
  const L = species.light;
  const dayStart = startOfDay(now);
  const since = movedAt !== null && movedAt > dayStart ? movedAt : dayStart;
  const slots = daylightSlots(dayStart, location.latitude, location.longitude, species.lightExpectedAboveSunDeg);
  const slotsSoFar = slots.slice(0, Math.floor((now - dayStart) / (SLOT_MIN * MIN)));
  const sinceSlot = Math.floor((since - dayStart) / (SLOT_MIN * MIN));
  const expectedTotal = slots.filter(Boolean).length * SLOT_MIN;
  const expectedSoFar = slotsSoFar.filter((v, i) => v && i >= sinceSlot).length * SLOT_MIN;

  let observed = 0;
  let useful = 0;
  let low = 0;
  let weighted = 0;
  let peak: number | null = null;
  let grey = 0;
  let explained = 0;
  const today = samples.filter((s) => s.t >= since && s.t <= now);
  for (let i = 0; i < today.length; i++) {
    const s = today[i];
    if (!s.lightExpected) continue; // night, dawn, dusk: never part of the day's light
    const pct = percentOf(s, species);
    if (pct === null) continue;
    const end = Math.min(today[i + 1]?.t ?? now, s.t + cadenceMs, now);
    const min = Math.max(0, end - s.t) / MIN;
    observed += min;
    weighted += pct * min;
    // Relative to the sky as well as the sun: under cloud the same LDR % is a fair share of what there was.
    // Only the LDR is scaled (weather-mode radiation already includes the clouds); unknown sky = clear.
    const sky = s.light !== null ? skyAt(outside, s.t) : null;
    const f = sky ? L.skyFactor[sky] : 1;
    if (f < 1) grey += min;
    if (pct >= L.usefulMinPercent * f) {
      useful += min;
      if (pct < L.usefulMinPercent) explained += min;
    } else if (pct <= L.lowMaxPercent * f) low += min;
    else if (pct <= L.lowMaxPercent) explained += min;
    peak = peak === null ? pct : Math.max(peak, pct);
  }

  const missing = Math.max(0, expectedSoFar - observed);
  const coverage = expectedSoFar > 0 ? Math.min(1, observed / expectedSoFar) : null;
  const usefulShare = observed > 0 ? (useful / observed) * 100 : null;
  const reasoning: string[] = [];
  let score: number | null = null;
  if (expectedSoFar === 0) {
    reasoning.push(expectedTotal === 0 ? 'No useful daylight expected today.' : 'The sun is not high enough yet today: nothing to judge.');
  } else if (observed < L.minObservedMinutes) {
    reasoning.push(`Only ${h1(observed)}h of daylight observed so far (need ${h1(L.minObservedMinutes)}h before judging the day).`);
  } else {
    const effective = (useful + L.lowCountsAs * low) / observed;
    score = Math.round(35 + 65 * Math.min(1, effective / L.usefulShareTarget));
    reasoning.push(
      `${h1(useful)}h of useful light out of ${h1(observed)}h observed (${Math.round(usefulShare!)}%; ${Math.round(L.usefulShareTarget * 100)}% or more counts as a good light day).`
    );
  }
  if (expectedSoFar > 0) reasoning.push(`Observed ${h1(observed)} of ${h1(expectedSoFar)} expected daylight hours so far (${h1(expectedTotal)}h today in total).`);
  if (missing >= 30) reasoning.push(`${h1(missing)}h of daylight not observed: counted as unknown, not as darkness.`);
  if (since > dayStart) reasoning.push('Moved to a new spot today: only light since the move counts.');
  if (grey >= 15) {
    reasoning.push(
      `${h1(grey)}h under a grey sky outside: light judged against what the sky allowed` +
        (explained >= 5 ? ` (${h1(explained)}h of dim light explained by the clouds, not counted as too dark).` : '.')
    );
  }

  const confidence: DailyLight['confidence'] = coverage === null || coverage >= 0.8 ? 'high' : coverage >= 0.4 ? 'medium' : 'low';
  return {
    date: localDate(now),
    since,
    expectedDaylightTotalMin: expectedTotal,
    expectedDaylightSoFarMin: expectedSoFar,
    observedDaylightMin: Math.round(observed),
    missingDaylightMin: Math.round(missing),
    usefulMin: Math.round(useful),
    lowMin: Math.round(low),
    usefulShare: usefulShare === null ? null : Math.round(usefulShare),
    greyMin: Math.round(grey),
    explainedMin: Math.round(explained),
    peak: peak === null ? null : Math.round(peak),
    average: observed > 0 ? Math.round(weighted / observed) : null,
    coverage: coverage === null ? null : Math.round(coverage * 100) / 100,
    score,
    confidence,
    reasoning,
  };
}

import { ComfortRange, SpeciesProfile } from '../species';
import type { PerceptionState } from '../perception/perceptionTypes';
import {
  HealthCondition,
  PenaltyItem,
  QualitativeState,
  ScoreComponent,
  ScoreId,
  Severity,
  VitalityBreakdown,
} from './healthTypes';
import { CONDITION_LABELS } from './labels';
import { HOUR } from '../lib/time';

// 0-100 health score for a value against a species range: 100 inside optimal,
// sliding through the warning band (65-100) and critical band (25-65), low beyond.
// Too much counts as much as too little: 100% soil moisture is not 100 health.
export function scoreAgainstRange(value: number, range: ComfortRange): number {
  if (value >= range.minOptimal && value <= range.maxOptimal) return 100;

  if (value < range.minOptimal) {
    if (value >= range.minWarning) {
      return Math.round(65 + ((value - range.minWarning) / (range.minOptimal - range.minWarning)) * 35);
    }
    if (value >= range.minCritical) {
      return Math.round(25 + ((value - range.minCritical) / (range.minWarning - range.minCritical)) * 40);
    }
    return Math.round(Math.max(0, range.minCritical > 0 ? value / range.minCritical : 0) * 25);
  }

  if (value <= range.maxWarning) {
    return Math.round(65 + ((range.maxWarning - value) / (range.maxWarning - range.maxOptimal)) * 35);
  }
  if (value <= range.maxCritical) {
    return Math.round(25 + ((range.maxCritical - value) / (range.maxCritical - range.maxWarning)) * 40);
  }
  return 15;
}

const SCORE_LABEL: Record<ScoreId, string> = {
  moisture: 'Moisture',
  temperature: 'Temperature',
  humidity: 'Humidity',
  light: 'Light',
  stability: 'Stability',
};

// Step 1: turn perceived conditions into health scores (never raw percentages).
export function healthScores(p: PerceptionState, species: SpeciesProfile): ScoreComponent[] {
  const r = p.readings;
  const w = species.weights;
  const comp = (id: ScoreId, score: number | null, note: string): ScoreComponent => ({
    id,
    label: SCORE_LABEL[id],
    score,
    weight: w[id],
    note,
  });
  const s = species.soilMoisture;
  const t = species.temperature;
  const h = species.humidity;

  const moisture =
    r.soilMoisture === null
      ? comp('moisture', null, 'no reading')
      : comp('moisture', scoreAgainstRange(r.soilMoisture, s), `${r.soilMoisture}% soil · optimal ${s.minOptimal}–${s.maxOptimal}%`);

  // Temperature: the current reading, and the hours spent outside the optimal range recently (decayed
  // degree-hours from perception.exposure). The worse of the two, so sustained heat lingers and fades.
  let temperature: ScoreComponent;
  if (r.temperature === null) temperature = comp('temperature', null, 'not reported');
  else {
    const current = scoreAgainstRange(r.temperature, t);
    const e = p.exposure?.temperature ?? null;
    const x = species.environment.temperatureExposure;
    const penalty = e ? Math.min(x.maxPenalty, (e.heatDegreeHours + e.coldDegreeHours) * x.scorePerDegreeHour) : 0;
    const exposureScore = Math.round(100 - penalty);
    temperature = comp(
      'temperature',
      Math.min(current, exposureScore),
      `${r.temperature}°C · optimal ${t.minOptimal}–${t.maxOptimal}°C` +
        (penalty >= 1 ? ` · recent exposure ${Math.round((e!.heatDegreeHours + e!.coldDegreeHours) * 10) / 10} °C·h (−${Math.round(penalty)})` : '')
    );
  }

  const humidity =
    r.humidity === null
      ? comp('humidity', null, 'not reported')
      : comp('humidity', scoreAgainstRange(r.humidity, h), `${r.humidity}% RH · optimal ${h.minOptimal}–${h.maxOptimal}%`);

  // Light: today's accumulated daylight exposure (perception.light), never one reading and never the night.
  // Its weight follows how much of today's daylight was actually observed.
  let light: ScoreComponent;
  const isSensor = p.source === 'esp32_sensor';
  const hasLight = isSensor ? r.lightPercent !== null : r.radiation !== null;
  const day = p.light;
  if (!hasLight && day.score === null) {
    light = comp('light', null, 'not reported');
  } else if (day.score === null) {
    light = comp('light', null, `neutral — ${day.reasoning[0] ?? 'nothing to judge yet'}`);
  } else {
    light = comp('light', day.score, `today: ${day.reasoning[0]} Confidence ${day.confidence}.`);
    light.weight = w.light * { high: 1, medium: 0.7, low: 0.4 }[day.confidence];
  }

  // Stability: big swings in a short time are stressful even inside the comfort range.
  let stability: ScoreComponent;
  const window = p.recent.filter((x) => x.t >= p.at - species.vitality.stabilityWindowHours * HOUR);
  if (p.history.minutes < 60 || window.length < 5) {
    stability = comp('stability', null, 'neutral — not enough history yet');
  } else {
    const range = (xs: number[]) => (xs.length ? Math.max(...xs) - Math.min(...xs) : 0);
    const tempSwing = range(window.flatMap((x) => (x.temp !== null ? [x.temp] : [])));
    const humSwing = range(window.flatMap((x) => (x.hum !== null ? [x.hum] : [])));
    const tempPenalty = Math.min(40, Math.max(0, tempSwing - species.vitality.comfortableTempSwing) * 5);
    const humPenalty = Math.min(30, Math.max(0, humSwing - species.vitality.comfortableHumiditySwing) * 1.5);
    stability = comp(
      'stability',
      Math.round(100 - tempPenalty - humPenalty),
      `swing over ${species.vitality.stabilityWindowHours}h: ${Math.round(tempSwing * 10) / 10}°C, ${Math.round(humSwing)}% RH`
    );
  }

  return [moisture, temperature, humidity, light, stability];
}

export interface VitalityInput {
  components: ScoreComponent[];
  stresses: { condition: HealthCondition; hours: number }[]; // active stresses with OBSERVED duration
  recovery: { severity: Severity; observedHours: number; requiredHours: number } | null;
  previous: { vitality: number; at: number } | null;
  frozen: boolean; // no fresh data: keep vitality as it was
  species: SpeciesProfile;
  now: number;
}

// Steps 2-5: weighted base → duration penalties → recovery → gradual change.
export function computeVitality({ components, stresses, recovery, previous, frozen, species, now }: VitalityInput): VitalityBreakdown {
  // 2. Weighted base of the available scores
  let sum = 0;
  let weight = 0;
  for (const c of components) {
    if (c.score === null) continue;
    sum += c.score * c.weight;
    weight += c.weight;
  }
  const weightedBase = weight > 0 ? Math.round((sum / weight) * 10) / 10 : previous?.vitality ?? 70;

  // 3. Duration penalties: brief stress costs little, prolonged stress costs more
  const durationPenalties: PenaltyItem[] = [];
  for (const s of stresses) {
    const rule = species.stressPenalties[s.condition];
    if (!rule) continue;
    const hours = Math.max(0, s.hours);
    const points = Math.min(rule.max, hours * rule.perHour);
    if (points > 0.05) {
      durationPenalties.push({
        label: `${CONDITION_LABELS[s.condition]} duration`,
        points: Math.round(points * 10) / 10,
        detail: `${Math.round(hours * 10) / 10}h × ${rule.perHour}/h (max ${rule.max})`,
      });
    }
  }
  const counted = stresses.filter((s) => species.stressPenalties[s.condition]).length;
  const combinedMultiplier =
    counted >= 2 ? Math.min(species.combinedStress.maxMultiplier, 1 + species.combinedStress.perExtraStress * (counted - 1)) : 1;
  const combinedExtra = stresses.some((s) => s.condition === 'hot_and_dry') ? species.combinedStress.hotAndDryExtra : 0;
  const penaltyTotal = durationPenalties.reduce((a, p) => a + p.points, 0) * combinedMultiplier + combinedExtra;

  // 4. Recovery: the tree needs time after stress; the dip fades over the recovery window
  let recoveryModifier = 0;
  if (recovery && recovery.severity !== 'none') {
    const elapsed = recovery.observedHours;
    const remaining = Math.max(0, 1 - elapsed / recovery.requiredHours);
    recoveryModifier = Math.round(species.recovery.vitalityPenaltyBySeverity[recovery.severity] * remaining * 10) / 10;
  }

  const target = clamp(weightedBase - penaltyTotal - recoveryModifier, 5, 100);

  // 5. Gradual change towards the target (declines faster than it recovers)
  let final: number;
  let smoothing: VitalityBreakdown['smoothing'] = null;
  if (frozen && previous) {
    final = previous.vitality;
  } else if (!previous) {
    final = target;
  } else {
    const minutes = Math.min(15, Math.max(0, (now - previous.at) / 60000)); // a long gap doesn't jump
    const tauHours = target < previous.vitality ? species.vitality.declineHours : species.vitality.riseHours;
    const alpha = 1 - Math.exp(-minutes / 60 / tauHours);
    final = previous.vitality + (target - previous.vitality) * alpha;
    smoothing = { tauHours, minutes: Math.round(minutes * 10) / 10, alpha: Math.round(alpha * 10000) / 10000 };
  }

  return {
    components,
    weightedBase,
    durationPenalties,
    combinedMultiplier,
    combinedExtra,
    recoveryModifier,
    target: Math.round(target * 10) / 10,
    previous: previous?.vitality ?? null,
    smoothing,
    final: clamp(final, 5, 100),
    frozen,
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function qualitativeFor(vitality: number, species: SpeciesProfile): QualitativeState {
  const b = species.vitalityBands;
  if (vitality >= b.thriving) return 'Thriving';
  if (vitality >= b.happy) return 'Happy';
  if (vitality >= b.okay) return 'Okay';
  if (vitality >= b.stressed) return 'Stressed';
  return 'Critical';
}

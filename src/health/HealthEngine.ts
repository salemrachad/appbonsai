import { APP_CONFIG } from '../config/appConfig';
import type { PerceivedReadings, PerceptionState } from '../perception/perceptionTypes';
import type { LatchId, LatchRule, SpeciesProfile } from '../species';
import { CouplingMemory, HealthCondition, LatchDebug, ObservationStatus, PlantHealthState, Severity, StressSummary } from './healthTypes';
import { describeRule, INITIAL_LATCH, LatchState, stepLatch } from './hysteresis';
import { INITIAL_COUPLING, interpretEnvironment, updateCouplingBaseline } from './environment';
import { assessMetrics, lightLevel } from './metrics';
import {
  COMBINED_CONDITIONS,
  CONDITION_SEVERITY,
  IMPLIED_BY,
  rankConditions,
  SEVERITY_RANK,
  STRESS_CONDITIONS,
} from './statePriority';
import { computeVitality, healthScores, qualitativeFor } from './vitality';

const HOUR = 3600 * 1000;
const MIN = 60 * 1000;

// What the health model remembers between evaluations. Saved by the server after every evaluation
// (SQLite meta) and restored on start, so a restart doesn't turn the bonsai into a new plant.
export interface HealthMemory {
  version: number;
  at: number | null; // last evaluation
  lastLiveAt: number | null; // last evaluation with fresh, trustworthy data
  lastLiveReadingAt: number | null; // timestamp of the reading behind it
  vitality: number | null; // unrounded
  latches: Record<LatchId, LatchState>;
  uncertainty: LatchState; // data-uncertainty hysteresis (overlay → primary)
  recovery: { from: HealthCondition; severity: Severity; endedAt: number; requiredHours: number; observedMs: number } | null;
  // Long-term learning (optional: older saved memories load without it, no version bump or replay)
  environment?: { coupling: CouplingMemory };
}

export const HEALTH_MEMORY_VERSION = 4;

const LATCH_IDS: LatchId[] = [
  'thirsty',
  'very_dry',
  'too_wet',
  'hot',
  'cold',
  'freezing_risk',
  'dry_air',
  'high_humidity',
  'low_daily_light',
  'very_bright',
  'night_rest',
  'thriving',
];
const STRESS_LATCHES: LatchId[] = ['thirsty', 'very_dry', 'too_wet', 'hot', 'cold', 'freezing_risk', 'dry_air', 'high_humidity', 'low_daily_light'];

// Which condition each latch produces.
const LATCH_CONDITION: Record<LatchId, HealthCondition> = {
  thirsty: 'thirsty',
  very_dry: 'very_dry',
  too_wet: 'too_wet',
  hot: 'hot',
  cold: 'cold',
  freezing_risk: 'freezing_risk',
  dry_air: 'dry_air',
  high_humidity: 'high_humidity',
  low_daily_light: 'too_dark',
  very_bright: 'very_bright',
  night_rest: 'sleeping',
  thriving: 'thriving',
};

// Data uncertainty is about the data, not biology, so its rule lives in appConfig (not the species).
const UNCERTAINTY_RULE: LatchRule = {
  direction: 'above',
  enter: 0.5,
  exit: 0.5,
  enterAfterMin: APP_CONFIG.continuity.uncertainPrimaryAfterMin,
  exitAfterMin: APP_CONFIG.continuity.uncertainExitAfterMin,
};

export function initialHealthMemory(): HealthMemory {
  return {
    version: HEALTH_MEMORY_VERSION,
    at: null,
    lastLiveAt: null,
    lastLiveReadingAt: null,
    vitality: null,
    latches: Object.fromEntries(LATCH_IDS.map((id) => [id, { ...INITIAL_LATCH }])) as Record<LatchId, LatchState>,
    uncertainty: { ...INITIAL_LATCH },
    recovery: null,
  };
}

// Weather mode has radiation, not an LDR %: map its level onto the same relative scale.
const LEVEL_AS_PERCENT = { very_dark: 5, low: 18, good: 45, bright: 75, very_bright: 95 } as const;

export interface HealthInput {
  perception: PerceptionState;
  species: SpeciesProfile;
  memory: HealthMemory;
  tempUnit?: 'C' | 'F';
}

// Suspicious sensors are left out of the biology: they lower confidence, they don't create stress.
function trustedReadings(p: PerceptionState): PerceivedReadings {
  const s = p.quality.suspect;
  const r = p.readings;
  return {
    ...r,
    soilMoisture: s.soil ? null : r.soilMoisture,
    lightPercent: s.light ? null : r.lightPercent,
    radiation: s.light ? null : r.radiation,
    temperature: s.air ? null : r.temperature,
    humidity: s.air ? null : r.humidity,
    vpd: s.air ? null : r.vpd,
  };
}

// PerceptionState + species + memory → biological condition, vitality, and the updated memory.
// The only place that decides how the plant is doing. It never decides personality or dialogue.
//
// Gap policy (appConfig.continuity):
//   short gap   → continuous: hysteresis timers keep running
//   no fresh data (any length) → state held, vitality frozen, durations and recovery paused;
//                 shown as a "sensor_uncertain" overlay, promoted to the primary state only after
//                 uncertainPrimaryAfterMin. Unobserved time never counts as confirmed stress.
export function evaluatePlantHealth({ perception: p, species, memory: stored, tempUnit = 'C' }: HealthInput): {
  state: PlantHealthState;
  memory: HealthMemory;
} {
  const memory = stored.version === HEALTH_MEMORY_VERSION ? stored : initialHealthMemory();
  const now = p.at;
  const fresh = !!p.telemetry;
  const live = fresh && p.quality.confidence !== 'low';
  const continuous = memory.at !== null && now - memory.at <= p.history.gapMs;
  // Observed time = time between consecutive real readings at the normal cadence. A reading repeated
  // during an outage adds nothing, and a gap longer than the cadence is unobserved, not stress.
  const readingAt = p.telemetry?.timestamp ?? null;
  const readingStep = live && readingAt !== null && memory.lastLiveReadingAt !== null ? readingAt - memory.lastLiveReadingAt : 0;
  const observedMs = readingStep > 0 && readingStep <= p.history.cadenceMs ? readingStep : 0;
  const unobservedDeltaMs = memory.at !== null ? Math.max(0, now - memory.at - observedMs) : 0;
  const pm: PerceptionState = { ...p, readings: trustedReadings(p) };
  // Derived environmental metrics: the coupling baseline learns from live, confident segments only
  const coupling = updateCouplingBaseline(memory.environment?.coupling ?? INITIAL_COUPLING, p, live, species);
  const environment = interpretEnvironment(p, coupling, species);
  const r = pm.readings;

  // ---- Hysteresis latches ----
  const level = lightLevel(pm, species);
  const lightValue = p.source === 'esp32_sensor' ? r.lightPercent : level ? LEVEL_AS_PERCENT[level] : null;
  const hasLightSensor = lightValue !== null || !fresh; // no fresh data: hold, don't assume darkness

  const inputs: Record<LatchId, { value: number | null; gate?: boolean; gateReason?: string }> = {
    thirsty: { value: r.soilMoisture },
    very_dry: { value: r.soilMoisture },
    too_wet: { value: r.soilMoisture },
    hot: { value: r.temperature },
    cold: { value: r.temperature },
    freezing_risk: { value: r.temperature },
    dry_air: { value: r.humidity },
    high_humidity: { value: r.humidity },
    // Too dark = today's observed daylight mostly dim (share of useful light), never one reading
    low_daily_light: {
      value: p.quality.suspect.light ? null : p.light.usefulShare,
      gate: p.sun.lightExpected && p.light.score !== null && !p.care.context.relearningLight,
      gateReason: !p.sun.lightExpected
        ? 'daylight not expected (night, dawn or dusk)'
        : p.care.context.relearningLight
        ? 'recently moved: re-learning the light of the new spot'
        : 'not enough daylight observed yet today',
    },
    very_bright: { value: lightValue, gate: p.sun.isDay, gateReason: 'sun is down' },
    // Without a light sensor, night itself means rest
    night_rest: { value: hasLightSensor ? lightValue : 0, gate: !p.sun.isDay, gateReason: 'sun is up' },
    thriving: { value: memory.vitality, gate: true },
  };

  const latches = {} as Record<LatchId, LatchState>;
  for (const id of LATCH_IDS) {
    if (id === 'thriving') continue;
    const inp = inputs[id];
    const before = memory.latches[id] ?? INITIAL_LATCH;
    // While nothing trustworthy is measured, every latch is held exactly as it was
    const after = fresh ? stepLatch(before, species.latches[id], { value: inp.value, now, continuous, gate: inp.gate }) : { ...before, pendingSince: null };
    latches[id] = before.active && after.active ? { ...after, observedMs: (before.observedMs ?? 0) + observedMs } : after;
  }
  // Starting up in the dark at night: rest right away (sleep isn't a stress, no need to wait it out)
  const rest = species.latches.night_rest;
  if (fresh && !latches.night_rest.active && inputs.night_rest.gate && inputs.night_rest.value !== null && inputs.night_rest.value < rest.enter && p.history.minutes <= rest.enterAfterMin) {
    latches.night_rest = { ...latches.night_rest, active: true, since: latches.night_rest.pendingSince ?? now, pendingSince: null, observedMs: 0 };
  }

  // ---- Biological conditions ----
  const active = new Set<HealthCondition>();
  for (const id of LATCH_IDS) if (id !== 'thriving' && latches[id].active) active.add(LATCH_CONDITION[id]);
  if (active.has('hot') && (active.has('thirsty') || active.has('very_dry'))) active.add('hot_and_dry');
  const distinctStresses = [...active].filter(
    (c) => STRESS_CONDITIONS.includes(c) && !COMBINED_CONDITIONS.includes(c) && !(c === 'thirsty' && active.has('very_dry'))
  );
  if (distinctStresses.length >= 3) active.add('multiple_stress');

  // ---- Recovery: a stress ended and healthy conditions must persist (observed) for a while ----
  let recovery = memory.recovery ? { ...memory.recovery, observedMs: memory.recovery.observedMs ?? 0 } : null;
  for (const id of STRESS_LATCHES) {
    const before = memory.latches[id];
    const cond = LATCH_CONDITION[id];
    if (!before?.active || latches[id].active) continue;
    if (inputs[id].gate === false) continue; // light stress "ending" because night fell is not recovery
    const severity = CONDITION_SEVERITY[cond];
    const running = recovery && recovery.observedMs < recovery.requiredHours * HOUR;
    const keep = running && SEVERITY_RANK[recovery!.severity] > SEVERITY_RANK[severity];
    const sev = keep ? recovery!.severity : severity;
    recovery = {
      from: keep ? recovery!.from : cond,
      severity: sev,
      endedAt: now,
      requiredHours: species.recovery.hoursBySeverity[sev as 'mild' | 'moderate' | 'critical'] ?? 1,
      observedMs: 0,
    };
  }
  const anyStress = STRESS_LATCHES.some((id) => latches[id].active);
  if (recovery && !anyStress && recovery.endedAt !== now) recovery.observedMs += observedMs;
  const recoveryRunning = !!recovery && recovery.observedMs < recovery.requiredHours * HOUR;
  if (recoveryRunning && !anyStress) active.add('recovering');
  if (recovery && !recoveryRunning && !anyStress) recovery = null;

  // ---- Vitality (observed durations only; frozen without fresh data) ----
  const obsH = (id: LatchId) => (latches[id].observedMs ?? 0) / HOUR;
  const stresses: { condition: HealthCondition; hours: number }[] = [];
  for (const c of active) {
    if (!STRESS_CONDITIONS.includes(c)) continue;
    if (c === 'hot_and_dry') stresses.push({ condition: c, hours: Math.min(obsH('hot'), Math.max(obsH('thirsty'), obsH('very_dry'))) });
    else if (c === 'too_dark') stresses.push({ condition: c, hours: obsH('low_daily_light') });
    else if (c === 'thirsty' && active.has('very_dry')) continue; // very_dry already counts
    else stresses.push({ condition: c, hours: obsH(c as LatchId) });
  }
  const components = healthScores(pm, species);
  for (const c of components) {
    const suspect = (c.id === 'moisture' && p.quality.suspect.soil) || (c.id === 'light' && p.quality.suspect.light) || ((c.id === 'temperature' || c.id === 'humidity') && p.quality.suspect.air);
    if (suspect) c.note = 'left out — sensor reading looks suspicious';
  }
  const breakdown = computeVitality({
    components,
    stresses,
    recovery: recoveryRunning && !anyStress && recovery ? { severity: recovery.severity, observedHours: recovery.observedMs / HOUR, requiredHours: recovery.requiredHours } : null,
    previous: memory.vitality !== null && memory.at !== null ? { vitality: memory.vitality, at: memory.at } : null,
    frozen: !fresh,
    species,
    now,
  });
  const vitality = breakdown.final;

  // Thriving: no stress, no recovery, vitality high for a while (its own hysteresis)
  latches.thriving = fresh
    ? stepLatch(memory.latches.thriving ?? INITIAL_LATCH, species.latches.thriving, {
        value: vitality,
        now,
        continuous,
        gate: !anyStress && !active.has('recovering') && live,
      })
    : { ...(memory.latches.thriving ?? INITIAL_LATCH), pendingSince: null };

  // ---- Data uncertainty: an overlay first, the primary state only after a meaningful outage ----
  const uncertainNow = !live;
  const uncertainty = stepLatch(memory.uncertainty ?? INITIAL_LATCH, UNCERTAINTY_RULE, { value: uncertainNow ? 1 : 0, now, continuous });
  const lastLiveAt = live ? now : memory.lastLiveAt;
  // Never observed, or unobserved longer than a long gap: nothing biological to hold on to
  const nothingKnown = lastLiveAt === null || now - lastLiveAt > APP_CONFIG.history.episodeGapMs;
  const uncertainPrimary = uncertainNow && (uncertainty.active || nothingKnown);
  const observation: ObservationStatus = {
    status: !uncertainNow ? 'live' : uncertainPrimary ? 'unknown' : 'unobserved',
    lastLiveAt,
    unobservedMinutes: uncertainNow && lastLiveAt !== null ? Math.round((now - lastLiveAt) / MIN) : 0,
    unobservedDeltaMs,
  };

  // ---- Primary condition + modifiers ----
  const ranked = rankConditions(active);
  const biological: HealthCondition = ranked[0] ?? (latches.thriving.active ? 'thriving' : 'comfortable');
  const condition: HealthCondition = uncertainPrimary ? 'sensor_uncertain' : biological;
  const implied = IMPLIED_BY[condition] ?? [];
  const modifiers = ranked.filter((c) => c !== condition && !implied.includes(c) && !COMBINED_CONDITIONS.includes(c));
  if (uncertainNow && !uncertainPrimary) modifiers.push('sensor_uncertain'); // overlay on the held biological state

  const sinceOf = (id: LatchId) => latches[id].since ?? now;
  const activeSince: Partial<Record<HealthCondition, number>> = {};
  for (const c of active) {
    if (c === 'hot_and_dry') activeSince[c] = Math.max(sinceOf('hot'), Math.min(latches.thirsty.active ? sinceOf('thirsty') : now, latches.very_dry.active ? sinceOf('very_dry') : now));
    else if (c === 'too_dark') activeSince[c] = sinceOf('low_daily_light');
    else if (c === 'recovering' && recovery) activeSince[c] = recovery.endedAt;
    else if (c === 'sleeping') activeSince[c] = sinceOf('night_rest');
    else if (c !== 'multiple_stress') activeSince[c] = sinceOf(c as LatchId);
  }
  if (latches.thriving.active) activeSince.thriving = sinceOf('thriving');
  if (uncertainPrimary) activeSince.sensor_uncertain = lastLiveAt ?? now;

  const lastWatering = p.care.lastWatering;
  const stress: StressSummary = {
    dryHours: Math.max(latches.thirsty.active ? obsH('thirsty') : 0, latches.very_dry.active ? obsH('very_dry') : 0),
    wetHours: latches.too_wet.active ? obsH('too_wet') : 0,
    lowLightHours: latches.low_daily_light.active ? obsH('low_daily_light') : 0,
    hoursSinceWatering: lastWatering ? (now - lastWatering.timestamp) / HOUR : null,
    recoveringFrom: active.has('recovering') ? recovery?.from ?? null : null,
    recoveringForHours: active.has('recovering') && recovery ? recovery.observedMs / HOUR : null,
    recoveryRemainingHours: active.has('recovering') && recovery ? Math.max(0, recovery.requiredHours - recovery.observedMs / HOUR) : null,
  };

  const units: Partial<Record<LatchId, string>> = {
    thirsty: '%', very_dry: '%', too_wet: '%', hot: '°C', cold: '°C', freezing_risk: '°C', dry_air: '%', high_humidity: '%',
    low_daily_light: '% of daylight useful', very_bright: '% light', night_rest: '% light', thriving: ' vitality',
  };
  const hysteresis: LatchDebug[] = LATCH_IDS.map((id) => {
    const inp = id === 'thriving' ? { value: memory.vitality, gate: !anyStress && !active.has('recovering') && live } : inputs[id];
    const gated = !fresh
      ? 'no fresh data — held'
      : inp.gate === false
      ? id === 'thriving'
        ? 'stress, recovery or uncertain data'
        : inputs[id].gateReason ?? 'not applicable'
      : null;
    return {
      id,
      active: latches[id].active,
      since: latches[id].since,
      pendingSince: latches[id].pendingSince,
      observedMinutes: latches[id].active ? Math.round((latches[id].observedMs ?? 0) / MIN) : null,
      value: inp.value === null ? null : Math.round(inp.value * 10) / 10,
      rule: describeRule(species.latches[id], units[id]),
      gated,
    };
  });
  hysteresis.push({
    id: 'data_uncertain',
    active: uncertainty.active,
    since: uncertainty.since,
    pendingSince: uncertainty.pendingSince,
    observedMinutes: null,
    value: uncertainNow ? 1 : 0,
    rule: `primary after ${UNCERTAINTY_RULE.enterAfterMin} min without trustworthy data · back after ${UNCERTAINTY_RULE.exitAfterMin} min of good data`,
    gated: null,
  });

  const state: PlantHealthState = {
    condition,
    modifiers,
    vitality: Math.round(vitality),
    qualitative: qualitativeFor(vitality, species),
    severity: CONDITION_SEVERITY[condition],
    scores: Object.fromEntries(components.map((c) => [c.id, c.score])) as PlantHealthState['scores'],
    confidence: p.quality.confidence,
    confidenceScore: p.quality.score,
    dataIssues: p.quality.issues,
    metrics: assessMetrics(p, species, tempUnit, { soil: environment.coupling.note ? [environment.coupling.note] : [] }),
    environment,
    stress,
    activeSince,
    observation,
    breakdown,
    hysteresis,
    evaluatedAt: now,
    isOverride: false,
  };

  return {
    state,
    memory: {
      version: HEALTH_MEMORY_VERSION,
      at: now,
      lastLiveAt,
      lastLiveReadingAt: live ? readingAt : memory.lastLiveReadingAt,
      vitality,
      latches,
      uncertainty,
      recovery,
      environment: { coupling },
    },
  };
}

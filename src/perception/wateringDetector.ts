import { APP_CONFIG } from '../config/appConfig';

// Detects a watering from consecutive live soil readings. Pure: the collector feeds it one
// reading at a time and persists nothing here.
//
// A watering is a rise of `minRisePct` above the recent baseline (lowest reading in the rise window),
// reached in one jump or accumulated over several readings, then CONFIRMED by the next reading(s)
// staying up. Rejected:
//   - spikes: the next reading falls back
//   - probe out of the soil: baseline ≈ 0%, or a big sudden drop just before the rise (pulled + reinserted)
//   - anything while detection is suppressed (probe calibration)
// Rises within the cooldown after a watering extend that watering instead of creating a new one.

export type WateringConfig = Pick<
  typeof APP_CONFIG.watering,
  'minRisePct' | 'riseWindowMs' | 'confirmReadings' | 'confirmTolerancePct' | 'probeOutMaxPct' | 'probeDropPct' | 'saturatedPct' | 'cooldownMs'
>;

export interface SoilReading {
  t: number;
  soil: number; // % used by the app
  raw: number | null; // ADC, evidence only
}

export interface WateringEvidence {
  method: 'single_jump' | 'accumulated_rise';
  moistureBefore: number;
  moistureAfter: number;
  rawBefore: number | null;
  rawAfter: number | null;
  accumulatedRise: number;
  risingReadings: number; // readings from the baseline to the threshold crossing
  confirmationReadings: number;
  baselineAt: number;
  crossedAt: number; // when the rise crossed the threshold (event time)
  detectedAt: number; // when it was confirmed
}

interface Candidate {
  baseline: SoilReading;
  peak: SoilReading;
  crossedAt: number;
  risingReadings: number;
  confirmations: number;
  context: unknown; // caller's context at the moment of the rise (e.g. health condition before watering)
}

export interface DetectorState {
  window: SoilReading[]; // continuous recent readings, oldest first
  pending: Candidate | null;
  session: { at: number; until: number; peak: SoilReading } | null; // the last watering, during its cooldown
  suppressedUntil: number;
}

export const INITIAL_DETECTOR: DetectorState = { window: [], pending: null, session: null, suppressedUntil: 0 };

export type DetectorOutput =
  | { kind: 'none'; saturated?: boolean }
  | { kind: 'suppressed' }
  | { kind: 'candidate'; rise: number }
  | { kind: 'rejected'; reason: 'spike' | 'probe_out' | 'probe_reinserted'; detail: string }
  | { kind: 'watering'; evidence: WateringEvidence; context: unknown }
  | { kind: 'session_extended'; peak: SoilReading };

export function stepWateringDetector(
  state: DetectorState,
  r: SoilReading,
  { gapMs, context = null, cfg = APP_CONFIG.watering }: { gapMs: number; context?: unknown; cfg?: WateringConfig }
): { state: DetectorState; out: DetectorOutput } {
  const last = state.window[state.window.length - 1];
  // A data gap breaks continuity: nothing before it can be a baseline
  let window = last && r.t - last.t > gapMs ? [] : state.window.filter((x) => x.t >= r.t - cfg.riseWindowMs);
  let pending = last && r.t - last.t > gapMs ? null : state.pending;
  let session = state.session && r.t < state.session.until ? state.session : null;
  const next = (out: DetectorOutput, w = [...window, r]): { state: DetectorState; out: DetectorOutput } => ({
    state: { window: w, pending, session, suppressedUntil: state.suppressedUntil },
    out,
  });

  // Probe being handled for calibration: keep only the latest reading as a fresh start
  if (r.t < state.suppressedUntil) {
    pending = null;
    return next({ kind: 'suppressed' }, [r]);
  }

  // Watering session in progress: more water, same watering
  if (session) {
    if (r.soil > session.peak.soil) {
      session = { ...session, peak: r, until: r.t + cfg.cooldownMs };
      return next({ kind: 'session_extended', peak: r });
    }
    return next({ kind: 'none' });
  }

  // Confirm or reject a pending rise
  if (pending) {
    const stillUp = r.soil >= pending.baseline.soil + cfg.minRisePct - cfg.confirmTolerancePct;
    if (!stillUp) {
      const detail = `soil ${pending.baseline.soil}% → ${pending.peak.soil}% → ${r.soil}%`;
      pending = null;
      return next({ kind: 'rejected', reason: 'spike', detail });
    }
    const peak = r.soil > pending.peak.soil ? r : pending.peak;
    pending = { ...pending, peak, confirmations: pending.confirmations + 1 };
    if (pending.confirmations < cfg.confirmReadings) return next({ kind: 'candidate', rise: peak.soil - pending.baseline.soil });
    const c = pending;
    const evidence: WateringEvidence = {
      method: c.risingReadings > 1 ? 'accumulated_rise' : 'single_jump',
      moistureBefore: c.baseline.soil,
      moistureAfter: c.peak.soil,
      rawBefore: c.baseline.raw,
      rawAfter: c.peak.raw,
      accumulatedRise: Math.round((c.peak.soil - c.baseline.soil) * 10) / 10,
      risingReadings: c.risingReadings,
      confirmationReadings: c.confirmations,
      baselineAt: c.baseline.t,
      crossedAt: c.crossedAt,
      detectedAt: r.t,
    };
    pending = null;
    session = { at: c.crossedAt, until: r.t + cfg.cooldownMs, peak: c.peak };
    return next({ kind: 'watering', evidence, context: c.context });
  }

  // Look for a rise above the recent baseline
  if (window.length === 0) return next({ kind: 'none' });
  let baseline = window[0];
  for (const x of window) if (x.soil <= baseline.soil) baseline = x; // latest of the lowest readings
  const rise = r.soil - baseline.soil;
  if (rise < cfg.minRisePct) return next({ kind: 'none', saturated: baseline.soil >= cfg.saturatedPct && r.soil >= cfg.saturatedPct });

  // Pulled out (reads ~0% in air) and pushed back in
  if (baseline.soil <= cfg.probeOutMaxPct) {
    return next({ kind: 'rejected', reason: 'probe_out', detail: `rise from ${baseline.soil}% (probe out of the soil?)` }, [r]);
  }
  const seq = [...window, r];
  for (let i = 1; i < seq.length; i++) {
    if (seq[i - 1].soil - seq[i].soil >= cfg.probeDropPct) {
      return next(
        { kind: 'rejected', reason: 'probe_reinserted', detail: `soil fell ${seq[i - 1].soil}% → ${seq[i].soil}% in one reading, then rose` },
        [r]
      );
    }
  }

  const risingReadings = window.length - window.indexOf(baseline);
  pending = { baseline, peak: r, crossedAt: r.t, risingReadings, confirmations: 0, context };
  if (cfg.confirmReadings <= 0) return stepWateringDetector({ window, pending, session, suppressedUntil: state.suppressedUntil }, r, { gapMs, context, cfg });
  return next({ kind: 'candidate', rise });
}

export function suppressDetection(state: DetectorState, until: number): DetectorState {
  return { ...state, pending: null, window: state.window.slice(-1), suppressedUntil: Math.max(state.suppressedUntil, until) };
}

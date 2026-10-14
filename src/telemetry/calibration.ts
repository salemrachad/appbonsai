import { APP_CONFIG } from '../config/appConfig';

// Sensor calibration: how raw ADC values are interpreted as percentages. Owned by the local
// server (SQLite). Changing it changes interpretation only: stored raw telemetry is never rewritten.

export interface SoilCalibration {
  dryRaw: number; // raw ADC with the bonsai soil dry enough that you'd water → 0%
  wetRaw: number; // raw ADC after a thorough watering and draining → 100%
  savedAt: number;
  method: 'guided' | 'migrated' | 'manual';
}

// Relative light only. 100% = this sensor's bright reference, NOT lux and not "maximum sunlight".
export interface LightCalibration {
  darkRaw: number; // raw ADC with the LDR covered / known dark → 0%
  brightRaw: number; // raw ADC in normal bright daylight on the balcony → 100%
  savedAt: number;
  method: 'guided' | 'manual';
}

export interface SensorCalibration {
  soil: SoilCalibration | null; // null: use the firmware's soil_moisture
  light: LightCalibration | null; // null: use the firmware's light_percent
}

export const NO_CALIBRATION: SensorCalibration = { soil: null, light: null };

const clampPct = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

// Works whichever way the probe reads (FC-28 on this ESP32: drier = higher raw).
export const soilPercentFromRaw = (raw: number, c: Pick<SoilCalibration, 'dryRaw' | 'wetRaw'>) =>
  c.dryRaw === c.wetRaw ? 0 : clampPct(((c.dryRaw - raw) / (c.dryRaw - c.wetRaw)) * 100);

export const lightPercentFromRaw = (raw: number, c: Pick<LightCalibration, 'darkRaw' | 'brightRaw'>) =>
  c.brightRaw === c.darkRaw ? 0 : clampPct(((raw - c.darkRaw) / (c.brightRaw - c.darkRaw)) * 100);

// A capture: several raw readings over a short period, averaged.
export interface CaptureStats {
  mean: number;
  min: number;
  max: number;
  stdev: number;
  n: number;
}

export function captureStats(raws: number[]): CaptureStats {
  const n = raws.length;
  const mean = n ? raws.reduce((a, b) => a + b, 0) / n : 0;
  const stdev = n ? Math.sqrt(raws.reduce((a, b) => a + (b - mean) ** 2, 0) / n) : 0;
  return { mean: Math.round(mean), min: n ? Math.min(...raws) : 0, max: n ? Math.max(...raws) : 0, stdev: Math.round(stdev * 10) / 10, n };
}

export interface Validation {
  errors: string[]; // block saving
  warnings: string[]; // saving needs explicit confirmation
}

const C = APP_CONFIG.calibration;
const { adcMax, adcRailMargin } = APP_CONFIG.dataQuality;
const atRail = (v: number) => v <= adcRailMargin || v >= adcMax - adcRailMargin;

function stability(label: string, s: CaptureStats | undefined, out: Validation) {
  if (!s) return;
  if (s.n < C.minSamples) out.errors.push(`${label}: only ${s.n} readings captured (need ${C.minSamples}). Is the sensor reachable?`);
  if (s.stdev > C.maxStdev || s.max - s.min > C.maxRange)
    out.warnings.push(`${label}: readings were unstable (${s.min}–${s.max}, ±${s.stdev}). Keep the probe still and capture again if you can.`);
}

export function validateSoil(dryRaw: number, wetRaw: number, dry?: CaptureStats, wet?: CaptureStats): Validation {
  const out: Validation = { errors: [], warnings: [] };
  if (!Number.isFinite(dryRaw) || !Number.isFinite(wetRaw)) out.errors.push('Both a dry and a wet reference are needed.');
  if (atRail(dryRaw)) out.errors.push(`Dry reference ${dryRaw} is at the ADC limit: probe disconnected or out of the soil?`);
  if (atRail(wetRaw)) out.errors.push(`Wet reference ${wetRaw} is at the ADC limit: probe shorted or disconnected?`);
  if (Math.abs(dryRaw - wetRaw) < C.minSoilSpan)
    out.errors.push(`Dry (${dryRaw}) and wet (${wetRaw}) are almost the same (need ${C.minSoilSpan} apart). Was the soil really watered between them?`);
  else if (wetRaw > dryRaw)
    out.errors.push(`Wet (${wetRaw}) reads higher than dry (${dryRaw}): with this probe, wetter soil reads lower. Were the steps swapped?`);
  stability('Dry reference', dry, out);
  stability('Wet reference', wet, out);
  return out;
}

export function validateLight(darkRaw: number, brightRaw: number, dark?: CaptureStats, bright?: CaptureStats): Validation {
  const out: Validation = { errors: [], warnings: [] };
  if (!Number.isFinite(darkRaw) || !Number.isFinite(brightRaw)) out.errors.push('Both a dark and a bright reference are needed.');
  if (brightRaw - darkRaw < C.minLightSpan)
    out.errors.push(
      brightRaw < darkRaw
        ? `Bright (${brightRaw}) reads lower than dark (${darkRaw}): were the steps swapped?`
        : `Dark (${darkRaw}) and bright (${brightRaw}) are too close (need ${C.minLightSpan} apart). Was the sensor really covered, and in daylight?`
    );
  if (brightRaw >= adcMax - adcRailMargin) out.warnings.push(`Bright reference is at the sensor's maximum (${brightRaw}): brighter light can't be told apart from it.`);
  stability('Dark reference', dark, out);
  stability('Bright reference', bright, out);
  return out;
}

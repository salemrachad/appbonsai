import { APP_CONFIG } from '../src/config/appConfig';
import {
  CaptureStats,
  captureStats,
  lightPercentFromRaw,
  SensorCalibration,
  soilPercentFromRaw,
  validateLight,
  validateSoil,
  Validation,
} from '../src/telemetry/calibration';
import type { LivingCollector } from './collector';
import type { AppDatabase } from './database';

// Guided calibration: capture several raw readings per reference, validate, preview, save with history.
// Calibration is stored on the server (meta "calibration" + calibration_history); raw telemetry is untouched.

export interface CaptureResult extends CaptureStats {
  sensor: 'soil' | 'light';
  raws: number[];
  warnings: string[];
}

export interface SaveResult extends Validation {
  saved: boolean;
  preview: { raw: number | null; percent: number | null } | null; // what the current reading would become
  calibration: SensorCalibration;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class CalibrationService {
  constructor(
    private db: AppDatabase,
    private collector: LivingCollector,
    private opts: { samples?: number; intervalMs?: number; now?: () => number } = {}
  ) {}

  private now() {
    return (this.opts.now ?? Date.now)();
  }

  get() {
    return { calibration: this.collector.getCalibration(), history: this.db.calibrationHistory(20) };
  }

  // Read the sensor several times and average. Soil captures pause watering detection (probe is handled).
  async capture(sensor: 'soil' | 'light'): Promise<CaptureResult> {
    const n = this.opts.samples ?? APP_CONFIG.calibration.captureSamples;
    const interval = this.opts.intervalMs ?? APP_CONFIG.calibration.captureIntervalMs;
    if (sensor === 'soil') this.collector.suppressWateringDetection();
    const raws: number[] = [];
    const warnings: string[] = [];
    for (let i = 0; i < n; i++) {
      try {
        const r = await this.collector.readRaw();
        const v = sensor === 'soil' ? r.soilRaw : r.lightRaw;
        if (v !== null) raws.push(v);
      } catch (err: any) {
        warnings.push(`Reading ${i + 1} failed: ${err?.message ?? err}`);
      }
      if (i < n - 1 && interval > 0) await sleep(interval);
    }
    if (raws.length === 0) warnings.push('No readings: is the ESP32 reachable?');
    return { sensor, raws, ...captureStats(raws), warnings };
  }

  // What the last reading would become. Never a fresh read: in push mode that waits for the device's next push
  // (up to a minute), longer than the page waits for a save.
  private preview(sensor: 'soil' | 'light', convert: (raw: number) => number) {
    const r = this.collector.latestRaw();
    if (!r) return null;
    const raw = sensor === 'soil' ? r.soilRaw : r.lightRaw;
    return { raw, percent: raw === null ? null : convert(raw) };
  }

  // dryRun: validate + preview only. Warnings need confirm: true; errors always block.
  // manual: dry (high raw) / wet (low raw) typed in by hand, without the watering the guided flow needs
  async saveSoil(input: { dryRaw: number; wetRaw: number; dry?: CaptureStats; wet?: CaptureStats; confirm?: boolean; dryRun?: boolean; manual?: boolean }): Promise<SaveResult> {
    const v = validateSoil(Number(input.dryRaw), Number(input.wetRaw), input.dry, input.wet);
    const preview = this.preview('soil', (raw) => soilPercentFromRaw(raw, { dryRaw: input.dryRaw, wetRaw: input.wetRaw }));
    const ok = v.errors.length === 0 && (v.warnings.length === 0 || !!input.confirm) && !input.dryRun;
    if (ok) {
      this.collector.applyCalibration(
        'soil',
        { dryRaw: Math.round(input.dryRaw), wetRaw: Math.round(input.wetRaw), savedAt: this.now(), method: input.manual ? 'manual' : 'guided' },
        input.manual
          ? `Set by hand: dry ${Math.round(input.dryRaw)} · wet ${Math.round(input.wetRaw)}`
          : describe(input.dry, input.wet, 'dry', 'wet')
      );
    }
    return { ...v, saved: ok, preview, calibration: this.collector.getCalibration() };
  }

  // manual: min (dark) / max (bright) raw typed in by hand, e.g. a stopgap until a new sensor arrives
  async saveLight(input: { darkRaw: number; brightRaw: number; dark?: CaptureStats; bright?: CaptureStats; confirm?: boolean; dryRun?: boolean; manual?: boolean }): Promise<SaveResult> {
    const v = validateLight(Number(input.darkRaw), Number(input.brightRaw), input.dark, input.bright);
    const preview = this.preview('light', (raw) => lightPercentFromRaw(raw, { darkRaw: input.darkRaw, brightRaw: input.brightRaw }));
    const ok = v.errors.length === 0 && (v.warnings.length === 0 || !!input.confirm) && !input.dryRun;
    if (ok) {
      this.collector.applyCalibration(
        'light',
        { darkRaw: Math.round(input.darkRaw), brightRaw: Math.round(input.brightRaw), savedAt: this.now(), method: input.manual ? 'manual' : 'guided' },
        input.manual
          ? `Set by hand: min (dark) ${Math.round(input.darkRaw)} · max (bright) ${Math.round(input.brightRaw)}`
          : describe(input.dark, input.bright, 'dark', 'bright')
      );
    }
    return { ...v, saved: ok, preview, calibration: this.collector.getCalibration() };
  }

  // Back to the firmware's own percentage for this sensor
  clear(sensor: 'soil' | 'light') {
    if (this.collector.getCalibration()[sensor]) this.collector.applyCalibration(sensor, null, 'Removed: using the firmware percentage again');
    return this.get();
  }
}

function describe(a: CaptureStats | undefined, b: CaptureStats | undefined, la: string, lb: string): string {
  const one = (s: CaptureStats | undefined, l: string) => (s ? `${l} ${s.mean} (${s.n} readings, ${s.min}–${s.max})` : `${l} entered by hand`);
  return `Guided calibration: ${one(a, la)}; ${one(b, lb)}`;
}

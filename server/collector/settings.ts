import { DEFAULT_SETTINGS, TreeSettings } from '../../src/settings/settings';
import { NO_CALIBRATION, SensorCalibration } from '../../src/telemetry/calibration';
import type { AppDatabase } from '../database';
import type { MetaStore } from './metaStore';

// Settings that are NOT changed through a settings save (calibration has its own API and history)
const NOT_FROM_SETTINGS_SAVE = ['calibration', 'useAppSoilCalibration', 'soilRawDry', 'soilRawWet', 'lastSoilRaw'] as const;

// The collector's settings and the sensor calibration, as stored on the server. This only keeps them
// consistent and saved; what a change sets off (a replay, a new poll) is the collector's business.
export class SettingsStore {
  settings: TreeSettings;
  configured: boolean;
  calibration: SensorCalibration;

  constructor(
    private db: AppDatabase,
    private meta: MetaStore,
    private now: () => number,
    private log: (msg: string) => void
  ) {
    const stored = meta.get('collector_settings');
    this.settings = { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
    this.configured = !!stored;
    this.calibration = this.loadCalibration();
  }

  // A settings save from the browser. Returns which settings actually changed.
  update(next: Partial<TreeSettings>): (k: keyof TreeSettings) => boolean {
    const before = this.settings;
    // Calibration never arrives through a settings save: a stale browser copy can't overwrite it
    const incoming: Partial<TreeSettings> = { ...next };
    for (const k of NOT_FROM_SETTINGS_SAVE) delete incoming[k];
    this.settings = { ...DEFAULT_SETTINGS, ...before, ...incoming };
    // The server knows the latest watering; an older browser copy must not roll it back
    this.settings.lastWateredTimestamp = Math.max(before.lastWateredTimestamp ?? 0, next.lastWateredTimestamp ?? 0);
    this.configured = true;
    this.meta.set('collector_settings', this.settings);
    const after = this.settings;
    return (k) => before[k] !== after[k];
  }

  // A watering the server recorded (sensor or by hand)
  watered(at: number) {
    this.settings = { ...this.settings, lastWateredTimestamp: at };
    this.meta.set('collector_settings', this.settings);
  }

  // What the telemetry provider reads: the settings with the server's calibration
  forFetch(): TreeSettings {
    return { ...this.settings, calibration: this.calibration };
  }

  // ---- calibration (server-owned; changes interpretation, never stored raw telemetry) ----
  setCalibration(sensor: 'soil' | 'light', value: SensorCalibration['soil'] | SensorCalibration['light'], note: string | null) {
    const old = this.calibration[sensor];
    this.calibration = { ...this.calibration, [sensor]: value };
    this.meta.set('calibration', this.calibration);
    this.db.insertCalibrationHistory({ timestamp: this.now(), sensor, old, next: value, note });
  }

  private loadCalibration(): SensorCalibration {
    const stored = this.meta.get('calibration');
    if (stored) return { ...NO_CALIBRATION, ...stored };
    // One-time migration of the old browser-held "convert raw in the app" soil settings
    const s = this.settings;
    if (s.useAppSoilCalibration && s.soilRawDry !== undefined && s.soilRawWet !== undefined) {
      const migrated: SensorCalibration = {
        soil: { dryRaw: s.soilRawDry, wetRaw: s.soilRawWet, savedAt: this.now(), method: 'migrated' },
        light: null,
      };
      this.meta.set('calibration', migrated);
      this.db.insertCalibrationHistory({ timestamp: this.now(), sensor: 'soil', old: null, next: migrated.soil, note: 'Migrated from the old app-side soil conversion' });
      this.log('[collector] migrated existing soil calibration to the server');
      return migrated;
    }
    return NO_CALIBRATION;
  }
}

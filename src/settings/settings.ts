import { APP_CONFIG } from '../config/appConfig';
import type { SensorCalibration } from '../telemetry/calibration';

export type DataSourceSetting = 'weather_estimate' | 'esp32_sensor' | 'auto';

export interface TreeSettings {
  treeName: string;
  species: string;
  locationName: string;
  latitude: number;
  longitude: number;
  timezone: string;
  rainReachesBonsai: boolean;
  temperatureUnit: 'C' | 'F';
  dataSource: DataSourceSetting;
  drainageRate: 'fast' | 'standard' | 'slow';
  lastWateredTimestamp: number; // set by sensor-detected waterings; drives the weather moisture estimate
  calibrationOffset: number; // weather moisture estimate adjustment, -10 to +10
  esp32EndpointUrl?: string; // e.g. http://192.168.1.150 or http://bonsai.local
  // Sensor calibration lives on the server (meta "calibration", changed only through /api/calibration);
  // the server fills this in for the collector. Never sent back in a settings save.
  calibration?: SensorCalibration;
  // Legacy (before guided calibration): migrated to the server's calibration once, then ignored.
  useAppSoilCalibration?: boolean;
  soilRawDry?: number;
  soilRawWet?: number;
  telemetryIntervalMs?: number; // how often the local server reads the ESP32
}

const SETTINGS_KEY = 'appbonsai_settings_v1';

export const DEFAULT_SETTINGS: TreeSettings = {
  treeName: 'Ficus',
  species: 'Ficus microcarpa (Ginseng)',
  locationName: 'Feytroun, Lebanon',
  latitude: 33.97,
  longitude: 35.73,
  timezone: 'Asia/Beirut',
  rainReachesBonsai: false,
  temperatureUnit: 'C',
  dataSource: 'weather_estimate',
  drainageRate: 'standard',
  lastWateredTimestamp: Date.now() - 36 * 60 * 60 * 1000,
  calibrationOffset: 0,
  telemetryIntervalMs: APP_CONFIG.polling.telemetryMs,
};

export function loadSettings(): TreeSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
  } catch (e) {
    console.warn('Failed to load settings from storage', e);
  }
  return DEFAULT_SETTINGS;
}

export function saveSettings(settings: TreeSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {
    console.warn('Failed to save settings to storage', e);
  }
}

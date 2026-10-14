import type { PlantEvent } from '../history/historyTypes';
import type { DataQuality } from '../telemetry/dataQuality';
import type { PlantTelemetry, TelemetrySource } from '../telemetry/types';
import type { CareContext } from './careContext';
import type { DailyLight } from './dailyLight';
import type { SunState } from './sun';

// One past moment as perceived: what was measured, and whether daylight was expected then.
export interface PerceptionSample {
  t: number;
  soil: number | null;
  soilRaw: number | null; // ADC, for stuck/rail checks
  temp: number | null;
  hum: number | null;
  light: number | null; // relative LDR % (sensor) — never lux
  radiation: number | null; // W/m² (weather)
  lightRaw: number | null; // ADC, for stuck/rail checks
  isDay: boolean;
  lightExpected: boolean;
}

// The current readings the health model may use. All null when no fresh reading exists:
// stale or missing data is never passed on as if it were measured now.
export interface PerceivedReadings {
  soilMoisture: number | null;
  soilRaw: number | null;
  temperature: number | null;
  humidity: number | null;
  vpd: number | null;
  lightPercent: number | null;
  lightRaw: number | null;
  radiation: number | null;
}

export interface PerceptionState {
  at: number;
  source: TelemetrySource | null;
  telemetry: PlantTelemetry | null; // fresh reading, or null
  lastReading: PlantTelemetry | null; // latest known reading, possibly stale (diagnostics only)
  readings: PerceivedReadings;
  sun: SunState;
  device: {
    online: boolean;
    lastError: string | null;
    lastReadingAt: number | null;
    ageMs: number | null;
    wifiRssi: number | null;
  };
  trends: { soilPerHour: number | null; temperaturePerHour: number | null; humidityPerHour: number | null };
  // continuous recent coverage; gapMs = longest gap that keeps hysteresis timers running;
  // cadenceMs = normal spacing of readings (beyond it, time between readings is unobserved)
  history: { minutes: number; samples: number; gapMs: number; cadenceMs: number };
  recent: PerceptionSample[]; // last 24 h, oldest first, including the current reading
  care: { lastWatering: PlantEvent | null; lastCare: PlantEvent | null; recent: PlantEvent[]; context: CareContext };
  light: DailyLight; // today's accumulated daylight exposure
  quality: DataQuality;
}

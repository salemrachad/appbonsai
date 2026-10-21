import type { DryingCoupling, SoilDryDown, TemperatureExposure } from './environment';
import type { OutsideObservation, OutsideWeather } from '../telemetry/outsideWeather';
import type { PlantEvent } from '../history/historyTypes';
import type { DataQuality } from '../telemetry/dataQuality';
import type { PlantTelemetry, TelemetrySource } from '../telemetry/types';
import type { CareContext } from './careContext';
import type { DailyLight } from './dailyLight';
import type { SeasonState } from './season';
import type { SunState } from './sun';
import type { LeafObservation } from '../vision/visionTypes';

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

export interface AirComparison {
  insideDewPoint: number; // °C
  outsideDewPoint: number; // °C
  moistureRatio: number; // absolute humidity inside / outside
  glassMayFog: boolean; // the inside dew point reaches the outside temperature: the glass may fog
}

export interface PerceptionState {
  at: number;
  source: TelemetrySource | null;
  telemetry: PlantTelemetry | null; // fresh reading, or null
  lastReading: PlantTelemetry | null; // latest known reading, possibly stale (diagnostics only)
  readings: PerceivedReadings;
  sun: SunState;
  season: SeasonState; // from the date and the tree's latitude
  device: {
    online: boolean;
    lastError: string | null;
    lastReadingAt: number | null;
    ageMs: number | null;
    wifiRssi: number | null;
  };
  // soilPerHour is the dry-down slope (soilDryDown.perHour), null without a confident segment
  trends: { soilPerHour: number | null; temperaturePerHour: number | null; humidityPerHour: number | null; soilDryDown: SoilDryDown | null };
  // Derived environmental metrics (calculated here, interpreted by Health)
  drying: DryingCoupling | null; // moisture–VPD coupling of the current dry-down (diagnostic only)
  exposure: { temperature: TemperatureExposure | null };
  // continuous recent coverage; gapMs = longest gap that keeps hysteresis timers running;
  // cadenceMs = normal spacing of readings (beyond it, time between readings is unobserved)
  history: { minutes: number; samples: number; gapMs: number; cadenceMs: number };
  recent: PerceptionSample[]; // last 24 h, oldest first, including the current reading
  care: { lastWatering: PlantEvent | null; lastCare: PlantEvent | null; recent: PlantEvent[]; context: CareContext };
  light: DailyLight; // today's accumulated daylight exposure
  quality: DataQuality;
  // Outside weather at the tree's location (the tree is in a greenhouse; the sensors measure inside).
  // Context and expression. Its one effect on interpretation is through `light`: a grey sky explains a dim
  // LDR reading (dailyLight.ts). Health never reads this field. null = unknown/stale.
  outside: OutsideWeather | null;
  outsideToday: OutsideObservation[]; // today's outside observations (the collector's; the dragonfly reads them)
  // Inside (the ESP32) vs outside air, compared by the water it actually holds (RH depends on temperature).
  // Facts for the Outside panel only; health never reads it. null without the real sensor or fresh weather.
  air: AirComparison | null;
  // The real leaves, from the daily photos (evidence class "observation"): the canopy is anchored on them and a
  // drop between photos is shedding (health). Absent without a reference photo and a readable one.
  leaves?: LeafObservation;
}

import { TreeSettings } from '../settings/settings';

export type TelemetrySource = 'weather_estimate' | 'esp32_sensor';

// One normalized measurement snapshot. Says nothing about whether the plant is healthy.
export interface PlantTelemetry {
  timestamp: number;
  source: TelemetrySource;
  updatedAt: string; // display time of the reading

  soilMoisture: number; // % (ESP32: the firmware's soil_moisture as sent; weather: modelled estimate)
  soilRaw?: number | null; // ESP32 raw ADC, diagnostics only
  apiSoilMoisture?: number | null; // ESP32 soil_moisture exactly as received, diagnostics only

  temperature: number | null; // air °C, null when not measured
  humidity: number | null; // % RH, null when not measured
  vpd: number | null; // kPa, derived from temperature + humidity

  lightPercent?: number | null; // ESP32 photoresistor, uncalibrated 0-100% (NOT lux)
  lightRaw?: number | null; // ESP32 photoresistor raw ADC, diagnostics only
  radiation?: number | null; // weather mode: shortwave radiation in W/m²

  isDay: boolean;
  wifiRssi?: number | null; // ESP32 Wi-Fi signal, dBm
  htsConnected?: boolean | null; // ESP32 hts221_connected flag (null = not reported)
  sensorIssues?: string[]; // out-of-range values found BEFORE clamping, hardware flags (data quality reads these)

  // Weather-mode extras
  soilTemperature?: number | null;
  precipitation?: number;
  weatherCode?: number;
  et0?: number;
  apparentTemperature?: number;
}

// One live reading kept in memory for the diagnostics strip (not persisted).
export interface LiveReading {
  t: number;
  moisture: number;
  soilRaw: number | null;
  light: number | null; // % (ESP32 photoresistor) or W/m² (weather)
  lightRaw: number | null;
  temperature: number | null; // °C
  humidity: number | null;
}

export interface HourlyTelemetryPoint {
  time: string;
  hour: number;
  timestamp: number;
  temperature: number | null;
  humidity: number | null;
  light: number | null; // W/m² (weather) or % (sensor history)
  soilMoisture: number;
  vpd: number | null;
  isDay: boolean;
}

export interface TimelineEvent {
  id: string;
  time: string;
  type: 'sunrise' | 'sunset' | 'light_peak' | 'heat_peak' | 'cooling' | 'watering' | 'milestone';
  title: string;
  description: string;
  iconName: string;
  badge?: string;
}

export interface TelemetryFetchResult {
  current: PlantTelemetry;
  hourly: HourlyTelemetryPoint[]; // provider forecast/model (weather only)
  timeline: TimelineEvent[];
  raw?: unknown; // ESP32 JSON exactly as received (stored for re-evaluation)
}

export interface ITelemetryProvider {
  fetchTelemetry(settings: TreeSettings): Promise<TelemetryFetchResult>;
  getName(): string;
}

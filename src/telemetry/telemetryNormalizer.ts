import { APP_CONFIG } from '../config/appConfig';
import { TreeSettings } from '../settings/settings';
import { lightPercentFromRaw, soilPercentFromRaw } from './calibration';
import { PlantTelemetry } from './types';

const toNumber = (v: any): number | null =>
  v !== undefined && v !== null && v !== '' && !isNaN(Number(v)) ? Number(v) : null;

const clampPct = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function isDaytimeByClock(date = new Date()): boolean {
  const h = date.getHours();
  return h >= APP_CONFIG.daylight.startHour && h < APP_CONFIG.daylight.endHour;
}

// Vapour pressure deficit in kPa from air temperature (°C) and relative humidity (%).
export function calculateVPD(temperatureC: number, relativeHumidityPct: number): number {
  const es = 0.61078 * Math.exp((17.27 * temperatureC) / (temperatureC + 237.3));
  const ea = es * (relativeHumidityPct / 100);
  return Math.round(Math.max(0.05, es - ea) * 100) / 100;
}

// Dew point (°C), Magnus formula: the temperature at which this air's water would condense. Unlike RH it
// doesn't depend on how warm the air is, so it compares inside and outside air honestly.
export function dewPoint(temperatureC: number | null, relativeHumidityPct: number | null): number | null {
  if (temperatureC === null || relativeHumidityPct === null || relativeHumidityPct <= 0) return null;
  const g = Math.log(relativeHumidityPct / 100) + (17.27 * temperatureC) / (temperatureC + 237.3);
  return Math.round(((237.3 * g) / (17.27 - g)) * 10) / 10;
}

// Absolute humidity (g of water per m³ of air): how much water the air actually holds.
export function absoluteHumidity(temperatureC: number | null, relativeHumidityPct: number | null): number | null {
  if (temperatureC === null || relativeHumidityPct === null) return null;
  const es = 6.112 * Math.exp((17.67 * temperatureC) / (temperatureC + 243.5)); // hPa
  return Math.round(((es * relativeHumidityPct * 2.1674) / (273.15 + temperatureC)) * 10) / 10;
}

// Single place that reads soil fields from the ESP32 JSON.
export function readSoilFields(raw: any): { apiSoilMoisture: number | null; soilRaw: number | null } {
  return {
    apiSoilMoisture: toNumber(raw.soil_moisture ?? raw.soilMoisture ?? raw.moisture),
    soilRaw: toNumber(raw.soil_raw ?? raw.soilRaw ?? raw.raw ?? raw.raw_soil ?? raw.adc),
  };
}


// ESP32 JSON → PlantTelemetry. Uses the firmware's values directly; never invents missing ones.
export function normalizeESP32Payload(raw: any, settings: TreeSettings): PlantTelemetry {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('ESP32 payload is not a JSON object');
  const issues: string[] = [];
  const { adcMax } = APP_CONFIG.dataQuality;
  // Flag impossible values before anything is clamped
  const outside = (name: string, v: number | null, lo: number, hi: number, unit = '') => {
    if (v !== null && (v < lo || v > hi)) issues.push(`${name} ${v}${unit} is outside ${lo}–${hi}${unit}`);
  };

  // Canonical soil value: soil_moisture exactly as sent, unless the server holds a soil calibration
  // (then soil_raw is converted with it). Same for light. Raw values are always kept as they are.
  const cal = settings.calibration;
  const { apiSoilMoisture, soilRaw } = readSoilFields(raw);
  outside('soil_moisture', apiSoilMoisture, 0, 100, '%');
  outside('soil_raw', soilRaw, 0, adcMax);
  const soilMoisture =
    cal?.soil && soilRaw !== null
      ? soilPercentFromRaw(soilRaw, cal.soil)
      : apiSoilMoisture !== null
      ? clampPct(apiSoilMoisture)
      : null;
  if (soilMoisture === null) throw new Error('ESP32 payload has no soil_moisture');

  // The firmware says whether the HTS221 answered; if it didn't, its numbers are not measurements
  const htsConnected = typeof raw.hts221_connected === 'boolean' ? raw.hts221_connected : null;
  if (htsConnected === false) issues.push('HTS221 reports disconnected (temperature/humidity not measured)');
  const tempRaw = htsConnected === false ? null : toNumber(raw.temperature);
  const humRaw = htsConnected === false ? null : toNumber(raw.humidity);
  outside('temperature', tempRaw, -40, 85, '°C');
  outside('humidity', humRaw, 0, 100, '%');
  const temperature = tempRaw !== null ? Math.round(tempRaw * 10) / 10 : null;
  const humidity = humRaw !== null ? Math.round(humRaw) : null;

  const lightPctRaw = toNumber(raw.light_percent);
  const lightRaw = toNumber(raw.light_raw);
  outside('light_percent', lightPctRaw, 0, 100, '%');
  outside('light_raw', lightRaw, 0, adcMax);
  const soilTemp = toNumber(raw.soil_temp ?? raw.soilTemperature);

  return {
    timestamp: Date.now(),
    source: 'esp32_sensor',
    updatedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    soilMoisture,
    soilRaw,
    apiSoilMoisture,
    temperature,
    humidity,
    vpd: temperature !== null && humidity !== null ? calculateVPD(temperature, humidity) : null,
    lightPercent: cal?.light && lightRaw !== null ? lightPercentFromRaw(lightRaw, cal.light) : lightPctRaw !== null ? clampPct(lightPctRaw) : null,
    lightRaw,
    radiation: null, // the LDR is not calibrated; never derive lux or W/m² from it
    isDay: raw.is_day !== undefined ? Boolean(raw.is_day) : isDaytimeByClock(),
    wifiRssi: toNumber(raw.wifi_rssi),
    htsConnected,
    sensorIssues: issues,
    soilTemperature: soilTemp !== null ? Math.round(soilTemp * 10) / 10 : null,
  };
}

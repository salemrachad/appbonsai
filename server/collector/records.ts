import type { TelemetryRecord } from '../../src/history/historyTypes';
import { lightPercentFromRaw, NO_CALIBRATION, SensorCalibration, soilPercentFromRaw } from '../../src/telemetry/calibration';
import { calculateVPD } from '../../src/telemetry/telemetryNormalizer';
import type { LiveReading, PlantTelemetry } from '../../src/telemetry/types';
import { hhmmss } from '../../src/lib/time';

// Stored row → the telemetry shape the engines read. Raw values are interpreted with the CURRENT
// calibration (so a new calibration applies to recent history too); the stored row is never changed.
// withTime = false leaves updatedAt (display only) empty: history and replays don't show it, and
// formatting a time per row was a large share of a replay. stamp() fills it in for the readings shown.
export function fromRecord(r: TelemetryRecord, cal: SensorCalibration = NO_CALIBRATION, withTime = true): PlantTelemetry | null {
  if (r.soilMoisture === null) return null;
  const esp = r.source === 'esp32_sensor';
  return {
    timestamp: r.timestamp,
    source: r.source,
    updatedAt: withTime ? hhmmss(r.timestamp) : '',
    soilMoisture: esp && cal.soil && r.soilRaw !== null ? soilPercentFromRaw(r.soilRaw, cal.soil) : r.soilMoisture,
    soilRaw: r.soilRaw,
    apiSoilMoisture: r.apiSoilMoisture,
    temperature: r.temperature,
    humidity: r.humidity,
    vpd: r.temperature !== null && r.humidity !== null ? calculateVPD(r.temperature, r.humidity) : null,
    lightPercent: esp && cal.light && r.lightRaw !== null ? lightPercentFromRaw(r.lightRaw, cal.light) : r.lightPercent,
    lightRaw: r.lightRaw,
    radiation: r.radiation,
    isDay: true, // perception decides day/night from the sun
    wifiRssi: r.wifiRssi,
  };
}

export const stamp = (t: PlantTelemetry | null): PlantTelemetry | null => (t && !t.updatedAt ? { ...t, updatedAt: hhmmss(t.timestamp) } : t);

export const toLive = (t: PlantTelemetry): LiveReading => ({
  t: t.timestamp,
  moisture: t.soilMoisture,
  soilRaw: t.soilRaw ?? null,
  light: t.source === 'esp32_sensor' ? t.lightPercent ?? null : t.radiation ?? null,
  lightRaw: t.lightRaw ?? null,
  temperature: t.temperature,
  humidity: t.humidity,
});

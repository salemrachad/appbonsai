import { ComfortRange, relativeLightBand, relativeLightRange, RelativeLightId, SpeciesProfile } from '../species';
import type { PerceptionState } from '../perception/perceptionTypes';
import { MetricAssessment, MetricTone } from './healthTypes';
import { metricGuide } from './metricGuides';

const NOT_CONNECTED = 'Sensor not connected';
const NO_READING = 'No live reading';

const offMetric = (id: MetricAssessment['id'], name: string, idealRange: string, display = NOT_CONNECTED): MetricAssessment => ({
  id,
  name,
  value: null,
  display,
  status: display,
  tone: 'off',
  idealRange,
  estimated: false,
});

// Light level on one shared scale, from the LDR % (sensor) or modelled radiation (weather).
export function lightLevel(p: PerceptionState, species: SpeciesProfile): RelativeLightId | null {
  const r = p.readings;
  if (p.source === 'esp32_sensor') return r.lightPercent !== null ? relativeLightBand(species, r.lightPercent).id : null;
  if (r.radiation === null) return null;
  const x = species.radiation;
  if (r.radiation < x.minCritical) return 'very_dark';
  if (r.radiation < x.minWarning) return 'low';
  if (r.radiation > x.maxWarning) return 'very_bright';
  if (r.radiation > x.maxOptimal) return 'bright';
  return 'good';
}

// Label + tone for a value inside a range, using the range bounds.
function band(
  value: number,
  r: ComfortRange,
  labels: [string, string, string, string, string, string, string]
): { status: string; tone: MetricTone } {
  const [critLow, warnLow, subLow, good, subHigh, warnHigh, critHigh] = labels;
  if (value < r.minCritical) return { status: critLow, tone: 'alert' };
  if (value < r.minWarning) return { status: warnLow, tone: 'caution' };
  if (value < r.minOptimal) return { status: subLow, tone: 'info' };
  if (value <= r.maxOptimal) return { status: good, tone: 'good' };
  if (value <= r.maxWarning) return { status: subHigh, tone: 'info' };
  if (value <= r.maxCritical) return { status: warnHigh, tone: 'caution' };
  return { status: critHigh, tone: 'alert' };
}

// Display-ready view of each perceived measurement against the species ranges.
export function assessMetrics(p: PerceptionState, species: SpeciesProfile, tempUnit: 'C' | 'F' = 'C'): MetricAssessment[] {
  const r = p.readings;
  const estimated = p.source === 'weather_estimate';
  const isSensor = p.source === 'esp32_sensor';
  const stale = !p.telemetry;
  const s = species.soilMoisture;
  const tr = species.temperature;
  const hr = species.humidity;
  const v = species.vpd;
  const metrics: MetricAssessment[] = [];
  const missing = (id: MetricAssessment['id'], name: string, ideal: string) =>
    metrics.push(offMetric(id, name, ideal, stale ? NO_READING : NOT_CONNECTED));

  // Soil
  if (r.soilMoisture === null) {
    missing('soil', 'Soil Moisture', `${s.minOptimal}–${s.maxOptimal}%`);
  } else {
    metrics.push({
      id: 'soil',
      name: 'Soil Moisture',
      value: r.soilMoisture,
      display: `${r.soilMoisture}%`,
      unit: '%',
      ...band(r.soilMoisture, s, ['Very Dry', 'Thirsty', 'Okay', 'Good', 'Moist', 'Wet', 'Waterlogged']),
      idealRange: `${s.minOptimal}–${s.maxOptimal}%`,
      estimated,
    });
  }

  // Light (relative LDR %, never lux). Dark outside daylight hours is normal, not a problem.
  {
    const level = lightLevel(p, species);
    const idealRange = isSensor ? relativeLightRange(species, 'good') : `${species.radiation.minOptimal}–${species.radiation.maxOptimal} W/m²`;
    if (level === null) {
      missing('light', 'Light', idealRange);
    } else {
      const resting = !p.sun.lightExpected && (level === 'very_dark' || level === 'low');
      const label = isSensor
        ? relativeLightBand(species, r.lightPercent!).label
        : ({ very_dark: 'Very Dark', low: 'Low', good: 'Good', bright: 'Bright', very_bright: 'Very Bright' } as const)[level];
      const tone: MetricTone = resting
        ? 'info'
        : level === 'very_dark'
        ? 'alert'
        : level === 'low'
        ? 'caution'
        : level === 'very_bright'
        ? 'info'
        : 'good';
      metrics.push({
        id: 'light',
        name: 'Light',
        value: isSensor ? r.lightPercent : r.radiation,
        display: isSensor ? `${r.lightPercent}%` : `${r.radiation} W/m²`,
        unit: isSensor ? '%' : 'W/m²',
        status: resting ? (p.sun.phase === 'night' ? 'Night' : p.sun.phase === 'low_sun' ? 'Low sun' : 'Twilight') : label,
        tone,
        idealRange,
        estimated,
      });
    }
  }

  // Temperature
  if (r.temperature === null) {
    missing('temperature', 'Temperature', `${tr.minOptimal}–${tr.maxOptimal}°C`);
  } else {
    const shown = tempUnit === 'F' ? Math.round((r.temperature * 9) / 5 + 32) : r.temperature;
    const b = band(r.temperature, tr, ['Freezing risk', 'Cold', 'Cool', 'Good', 'Warm', 'Hot', 'Too hot']);
    if (r.temperature <= tr.minCritical) Object.assign(b, { status: 'Freezing risk', tone: 'alert' });
    metrics.push({
      id: 'temperature',
      name: 'Temperature',
      value: shown,
      display: `${shown}°${tempUnit}`,
      unit: `°${tempUnit}`,
      ...b,
      idealRange: `${tr.minOptimal}–${tr.maxOptimal}°C`,
      estimated,
    });
  }

  // Humidity
  if (r.humidity === null) {
    missing('humidity', 'Humidity', `${hr.minOptimal}–${hr.maxOptimal}%`);
  } else {
    metrics.push({
      id: 'humidity',
      name: 'Humidity',
      value: r.humidity,
      display: `${r.humidity}%`,
      unit: '%',
      ...band(r.humidity, hr, ['Very dry air', 'Dry air', 'Slightly dry', 'Good', 'Humid', 'Very humid', 'Saturated']),
      idealRange: `${hr.minOptimal}–${hr.maxOptimal}%`,
      estimated,
    });
  }

  // VPD (derived; diagnostics only)
  if (r.vpd === null) {
    missing('vpd', 'Vapour Pressure Deficit', `${v.minOptimal}–${v.maxOptimal} kPa`);
  } else {
    metrics.push({
      id: 'vpd',
      name: 'Vapour Pressure Deficit',
      value: r.vpd,
      display: `${r.vpd} kPa`,
      unit: 'kPa',
      ...band(r.vpd, v, ['Very low', 'Low', 'Slightly low', 'Good', 'Slightly high', 'High', 'Very high']),
      idealRange: `${v.minOptimal}–${v.maxOptimal} kPa`,
      estimated,
    });
  }

  // Suspicious sensors: show the value, but don't judge the plant by it
  const suspect = p.quality.suspect;
  const isSuspect = (id: MetricAssessment['id']) =>
    (id === 'soil' && suspect.soil) || (id === 'light' && suspect.light) || ((id === 'temperature' || id === 'humidity' || id === 'vpd') && suspect.air);
  return metrics.map((m) => {
    const guide = metricGuide(m.id, species, { isSensor: !estimated, tempUnit, value: m.value });
    // Light is judged over the day: say what today looked like
    if (m.id === 'light') guide.notes = [...p.light.reasoning.map((r) => `Today: ${r}`), ...guide.notes];
    return { ...(m.tone !== 'off' && isSuspect(m.id) ? { ...m, status: 'Check sensor', tone: 'info' as MetricTone } : m), guide };
  });
}

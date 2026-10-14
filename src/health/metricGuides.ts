import { ComfortRange, LatchRule, relativeLightRange, SpeciesProfile } from '../species';
import type { MetricGuide, MetricId, MetricTone } from './healthTypes';

// "What does this sensor mean for the tree?" Built from the species profile, so the explanation
// always matches the ranges the health engine actually uses. The UI only displays it.

type Labels = [string, string, string, string, string, string, string];
export const BAND_LABELS: Record<Exclude<MetricId, 'light'>, Labels> = {
  soil: ['Very Dry', 'Thirsty', 'Okay', 'Good', 'Moist', 'Wet', 'Waterlogged'],
  temperature: ['Freezing risk', 'Cold', 'Cool', 'Good', 'Warm', 'Hot', 'Too hot'],
  humidity: ['Very dry air', 'Dry air', 'Slightly dry', 'Good', 'Humid', 'Very humid', 'Saturated'],
  vpd: ['Very low', 'Low', 'Slightly low', 'Good', 'Slightly high', 'High', 'Very high'],
};
const TONES: MetricTone[] = ['alert', 'caution', 'info', 'good', 'info', 'caution', 'alert'];

const dur = (min: number) => (min >= 60 ? `${Math.round((min / 60) * 10) / 10}h` : `${min} min`);
const fmt = (n: number) => String(Math.round(n * 10) / 10);
const toF = (c: number) => (c * 9) / 5 + 32;

// Seven bands from a comfort range: < critical · critical–warning · warning–optimal · optimal · …
function rangeBands(r: ComfortRange, labels: Labels, unit: string, value: number | null, conv = (n: number) => n): MetricGuide['bands'] {
  const e = [r.minCritical, r.minWarning, r.minOptimal, r.maxOptimal, r.maxWarning, r.maxCritical].map(conv);
  const ranges = [`< ${fmt(e[0])}${unit}`, `${fmt(e[0])}–${fmt(e[1])}${unit}`, `${fmt(e[1])}–${fmt(e[2])}${unit}`, `${fmt(e[2])}–${fmt(e[3])}${unit}`, `${fmt(e[3])}–${fmt(e[4])}${unit}`, `${fmt(e[4])}–${fmt(e[5])}${unit}`, `> ${fmt(e[5])}${unit}`];
  const idx =
    value === null ? -1 : value < e[0] ? 0 : value < e[1] ? 1 : value < e[2] ? 2 : value <= e[3] ? 3 : value <= e[4] ? 4 : value <= e[5] ? 5 : 6;
  return labels.map((label, i) => ({ label, range: ranges[i], tone: TONES[i], current: i === idx }));
}

const latchLine = (name: string, l: LatchRule, unit: string, conv = (n: number) => n) => {
  const op = l.direction === 'below' ? 'below' : 'above';
  const back = l.direction === 'below' ? 'back above' : 'back below';
  return `${name} after ${dur(l.enterAfterMin)} ${op} ${fmt(conv(l.enter))}${unit}; eases ${back} ${fmt(conv(l.exit))}${unit}.`;
};

export function metricGuide(
  id: MetricId,
  species: SpeciesProfile,
  opts: { isSensor: boolean; tempUnit: 'C' | 'F'; value: number | null } // value in the displayed unit
): MetricGuide {
  const L = species.latches;
  switch (id) {
    case 'soil': {
      const s = species.soilMoisture;
      return {
        title: 'Soil moisture',
        best: `${s.minOptimal}–${s.maxOptimal}%`,
        bands: rangeBands(s, BAND_LABELS.soil, '%', opts.value),
        notes: [
          latchLine('Thirsty', L.thirsty, '%'),
          latchLine('Very dry', L.very_dry, '%'),
          latchLine('Too wet', L.too_wet, '%'),
          opts.isSensor
            ? 'Prototype calibration: % from this pot’s FC-28 probe, not absolute water content.'
            : 'Estimated from weather and the last watering, not measured.',
        ],
      };
    }
    case 'temperature': {
      const f = opts.tempUnit === 'F';
      const conv = f ? toF : (n: number) => n;
      const u = f ? '°F' : '°C';
      const t = species.temperature;
      return {
        title: 'Air temperature',
        best: `${fmt(conv(t.minOptimal))}–${fmt(conv(t.maxOptimal))}${u}`,
        bands: rangeBands(t, BAND_LABELS.temperature, u, opts.value, conv),
        notes: [latchLine('Hot', L.hot, u, conv), latchLine('Cold', L.cold, u, conv), latchLine('Freezing risk', L.freezing_risk, u, conv), 'A short spike barely matters; hours of heat or cold do.'],
      };
    }
    case 'humidity': {
      const h = species.humidity;
      return {
        title: 'Air humidity',
        best: `${h.minOptimal}–${h.maxOptimal}%`,
        bands: rangeBands(h, BAND_LABELS.humidity, '%', opts.value),
        notes: [latchLine('Dry air', L.dry_air, '%'), latchLine('Humid', L.high_humidity, '%'), 'Ficus likes moderate humidity; very dry air dries the leaves.'],
      };
    }
    case 'vpd': {
      const v = species.vpd;
      return {
        title: 'Vapour pressure deficit',
        best: `${v.minOptimal}–${v.maxOptimal} kPa`,
        bands: rangeBands(v, BAND_LABELS.vpd, ' kPa', opts.value),
        notes: ['How strongly the air pulls water out of the leaves, from temperature + humidity. Higher = faster drying.'],
      };
    }
    case 'light': {
      if (opts.isSensor) {
        const tones: Record<string, MetricTone> = { very_dark: 'alert', low: 'caution', good: 'good', bright: 'good', very_bright: 'info' };
        const v = opts.value;
        return {
          title: 'Light',
          best: `${relativeLightRange(species, 'good').split('–')[0]}–${species.relativeLight.find((b) => b.id === 'bright')!.max}%`,
          bands: species.relativeLight.map((b, i) => {
            const min = i === 0 ? 0 : species.relativeLight[i - 1].max + 1;
            return { label: b.label, range: `${min}–${b.max}%`, tone: tones[b.id], current: v !== null && v >= min && v <= b.max };
          }),
          notes: [
            'Relative photoresistor %, not lux (prototype bands, to be calibrated).',
            'Only judged while the sun is well up: darkness at night, dawn and dusk is normal.',
            `Judged over the whole day: “too dark” only when, after ${dur(species.light.minObservedMinutes)} of observed daylight, less than ${L.low_daily_light.enter}% of it was useful light (≥ ${species.light.usefulMinPercent}%). A passing cloud doesn't count.`,
          ],
        };
      }
      const r = species.radiation;
      return {
        title: 'Sunlight (estimated)',
        best: `${r.minOptimal}–${r.maxOptimal} W/m²`,
        bands: rangeBands(r, ['Very dark', 'Dim', 'Low', 'Good', 'Bright', 'Very bright', 'Harsh'], ' W/m²', opts.value),
        notes: ['Solar radiation from the weather forecast, not measured at the tree.', 'Darkness at night is normal.'],
      };
    }
  }
}

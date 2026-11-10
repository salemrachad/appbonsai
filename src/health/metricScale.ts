import { ComfortRange, SpeciesProfile } from '../species';
import type { MetricAssessment, MetricTone } from './healthTypes';
import { BAND_LABELS } from './metricGuides';
import { luxText } from './metrics';

// A metric's range bar, display-ready: the species' zones laid on one scale, and where the reading sits.
// Built from the same species profile the health engine judges by, so the bar always matches the verdict.
// The UI (sensor cards, Tree Diagnostics) only draws it. Never read by any engine.

export interface ScaleZone {
  from: number;
  to: number;
  tone: MetricTone;
  label: string;
}

export interface MetricScale {
  min: number;
  max: number;
  zones: ScaleZone[];
  value: number; // clamped onto the scale
  ticks: { at: number; label: string }[]; // edges of the comfortable zone (and lux anchors on the light scale)
}

const TONES: MetricTone[] = ['alert', 'caution', 'info', 'good', 'info', 'caution', 'alert'];
const r1 = (n: number) => Math.round(n * 10) / 10;

function rangeZones(r: ComfortRange, labels: readonly string[], min: number, max: number, conv = (n: number) => n): ScaleZone[] {
  const e = [min, r.minCritical, r.minWarning, r.minOptimal, r.maxOptimal, r.maxWarning, r.maxCritical].map((x, i) => (i === 0 ? x : conv(x)));
  e.push(max);
  return labels.map((label, i) => ({ from: e[i], to: e[i + 1], tone: TONES[i], label })).filter((z) => z.to > z.from);
}

// The light scale's % back to lux (the firmware's log scale from 300 lux up: % = 37.5 · (log10 lux − 2.333))
const luxAt = (percent: number) => Math.pow(10, percent / 37.5 + 2.333);

const ROOT_LABELS = ['Very cold', 'Cold', 'Cool', 'Ideal', 'Warm', 'Hot', 'Too hot'];
const tempAxis = (species: SpeciesProfile) => ({ min: species.temperature.minCritical - 5, max: species.temperature.maxCritical + 3 });

// The root zone's bar (the temperature metric's `roots`), on the same axis as the air's so the two pins compare
export function rootScale(m: MetricAssessment, species: SpeciesProfile): MetricScale | null {
  if (!m.roots) return null;
  const fahrenheit = m.roots.display.endsWith('°F');
  const conv = fahrenheit ? (c: number) => (c * 9) / 5 + 32 : (c: number) => c;
  const r = species.rootTemperature;
  const axis = tempAxis(species);
  const min = conv(axis.min);
  const max = conv(axis.max);
  return {
    min,
    max,
    zones: rangeZones(r, ROOT_LABELS, min, max, conv),
    ticks: [r.minOptimal, r.maxOptimal].map((c) => ({ at: conv(c), label: `${Math.round(conv(c))}°` })),
    value: Math.max(min, Math.min(max, m.roots.value)),
  };
}

export function metricScale(m: MetricAssessment, species: SpeciesProfile, opts: { lux?: number | null } = {}): MetricScale | null {
  if (m.tone === 'off' || m.value === null) return null;
  const fahrenheit = m.unit === '°F';
  const conv = fahrenheit ? (c: number) => (c * 9) / 5 + 32 : (c: number) => c;
  let s: Omit<MetricScale, 'value'>;
  switch (m.id) {
    case 'soil': {
      const r = species.soilMoisture;
      const zones = rangeZones(r, BAND_LABELS.soil, 0, 100);
      // The watering window: the dry end of "good" is the right moment to water (calm, not a stress)
      const good = zones.findIndex((z) => z.tone === 'good');
      const ready = species.soilCycle.readyBelow;
      zones.splice(good, 1, { from: r.minOptimal, to: ready, tone: 'info', label: 'Ready for water' }, { ...zones[good], from: ready });
      s = { min: 0, max: 100, zones, ticks: [{ at: r.minOptimal, label: `${r.minOptimal}%` }, { at: r.maxOptimal, label: `${r.maxOptimal}%` }] };
      break;
    }
    case 'temperature': {
      const r = species.temperature;
      const min = conv(tempAxis(species).min);
      const max = conv(tempAxis(species).max);
      s = {
        min,
        max,
        zones: rangeZones(r, BAND_LABELS.temperature, min, max, conv),
        ticks: [r.minOptimal, r.maxOptimal].map((c) => ({ at: conv(c), label: `${Math.round(conv(c))}°` })),
      };
      break;
    }
    case 'humidity': {
      const r = species.humidity;
      s = { min: 0, max: 100, zones: rangeZones(r, BAND_LABELS.humidity, 0, 100), ticks: [r.minOptimal, r.maxOptimal].map((v) => ({ at: v, label: `${v}%` })) };
      break;
    }
    case 'vpd': {
      const r = species.vpd;
      const max = r1(r.maxCritical + 0.4);
      s = { min: 0, max, zones: rangeZones(r, BAND_LABELS.vpd, 0, max), ticks: [r.minOptimal, r.maxOptimal].map((v) => ({ at: v, label: `${v}` })) };
      break;
    }
    case 'light': {
      if (m.unit === '%') {
        const tones: Record<string, MetricTone> = { very_dark: 'alert', low: 'caution', good: 'good', bright: 'good', very_bright: 'info' };
        const bands = species.relativeLight;
        const zones = bands.map((b, i) => ({ from: i === 0 ? 0 : bands[i - 1].max, to: b.max, tone: tones[b.id], label: b.label }));
        const low = bands.find((b) => b.id === 'low')!.max;
        const bright = bands.find((b) => b.id === 'bright')!.max;
        // With a lux sensor the edges read as lux too
        const tick = (at: number) => ({ at, label: opts.lux != null ? `${luxText(Number(luxAt(at).toPrecision(2)))} lx` : `${at}%` });
        s = { min: 0, max: 100, zones, ticks: [tick(low), tick(bright)] };
      } else {
        const r = species.radiation;
        const max = r.maxCritical + 100;
        s = {
          min: 0,
          max,
          zones: rangeZones(r, ['Very dark', 'Dim', 'Low', 'Good', 'Bright', 'Very bright', 'Harsh'], 0, max),
          ticks: [r.minOptimal, r.maxOptimal].map((v) => ({ at: v, label: `${v}` })),
        };
      }
      break;
    }
  }
  return { ...s, value: Math.max(s.min, Math.min(s.max, m.value)) };
}

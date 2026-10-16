import { APP_CONFIG } from '../config/appConfig';
import type { PlantEvent } from '../history/historyTypes';
import type { SpeciesProfile } from '../species';
import { calculateVPD } from '../telemetry/telemetryNormalizer';
import type { PerceptionSample } from './perceptionTypes';
import { HOUR } from '../lib/time';

// Derived environmental metrics from timestamped samples. Perception only CALCULATES and qualifies them
// (with a confidence); it never judges the plant. Health interprets them (see HealthEngine).
//
// - Soil dry-down: a least-squares slope over ONE uninterrupted dry-down segment. A segment never bridges
//   a watering (it restarts after the soil settles), a calibration change or pause, a gap in the readings
//   (disconnection), or a suspect soil sensor.
// - Moisture–VPD coupling: how fast this segment dries per kPa of evaporative demand. Diagnostic only.
// - Temperature exposure: degree-hours outside the species' optimal range over the last day, each
//   weighted by an exponential decay, so it builds with sustained heat or cold and fades gradually.


export interface SoilDryDown {
  perHour: number; // %/h (negative = drying)
  since: number; // segment start
  hours: number; // span of the samples used
  samples: number;
  se: number; // standard error of the slope (%/h)
  confidence: 'high' | 'medium' | 'low';
  startedBy: 'watering' | 'calibration' | 'gap' | 'window'; // what bounds the segment
}

export interface DryingCoupling {
  perHourPerKpa: number; // drying rate per kPa of mean VPD over the same segment (positive = drying)
  meanVpd: number; // kPa
  hours: number;
}

export interface TemperatureExposure {
  heatDegreeHours: number; // decayed °C·h above the optimal range
  coldDegreeHours: number; // decayed °C·h below it
  observedHours: number; // how much of the window was actually observed
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export interface DryDownInput {
  samples: PerceptionSample[]; // oldest first
  events: PlantEvent[]; // care events (waterings bound the segment)
  breaks: number[]; // calibration changes / detection pauses (a segment never bridges them)
  gapMs: number; // longer gaps between readings are disconnections
  soilSuspect: boolean; // the soil sensor looks unreliable right now
  now: number;
}

export function soilDryDown({ samples, events, breaks, gapMs, soilSuspect, now }: DryDownInput): SoilDryDown | null {
  const C = APP_CONFIG.dryDown;
  if (soilSuspect) return null;
  if (breaks.some((b) => b > now)) return null; // a calibration pause is going on: the probe is being handled
  let since = now - C.maxHours * HOUR;
  let startedBy: SoilDryDown['startedBy'] = 'window';
  const lastWatering = events.filter((e) => e.type === 'watering' && e.timestamp <= now).reduce((m, e) => Math.max(m, e.timestamp), -Infinity);
  if (lastWatering + C.settleAfterWateringMs > since) {
    since = lastWatering + C.settleAfterWateringMs;
    startedBy = 'watering';
  }
  const lastBreak = breaks.filter((b) => b <= now).reduce((m, b) => Math.max(m, b), -Infinity);
  if (lastBreak > since) {
    since = lastBreak;
    startedBy = 'calibration';
  }
  // Walk back from the latest reading; a gap (disconnection) or a missing soil value ends the segment
  const pts: { t: number; v: number }[] = [];
  for (let i = samples.length - 1; i >= 0; i--) {
    const s = samples[i];
    if (s.t > now) continue;
    if (s.t < since) break;
    if (s.soil === null) {
      startedBy = 'gap';
      break;
    }
    if (pts.length && pts[pts.length - 1].t - s.t > gapMs) {
      startedBy = 'gap';
      break;
    }
    pts.push({ t: s.t, v: s.soil });
  }
  pts.reverse();
  if (pts.length < 2) return null;
  const hours = (pts[pts.length - 1].t - pts[0].t) / HOUR;
  if (hours < C.minHours || pts.length < C.minSamples) return null; // not enough evidence: no estimate
  // Ordinary least squares on (hours, %)
  const t0 = pts[0].t;
  const xs = pts.map((p) => (p.t - t0) / HOUR);
  const ys = pts.map((p) => p.v);
  const n = pts.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  if (sxx <= 0) return null;
  const slope = sxy / sxx;
  let ssr = 0;
  for (let i = 0; i < n; i++) ssr += (ys[i] - (my + slope * (xs[i] - mx))) ** 2;
  const se = Math.sqrt(ssr / Math.max(1, n - 2) / sxx);
  const confidence: SoilDryDown['confidence'] = hours >= C.highMinHours && se <= C.seHigh ? 'high' : se <= C.seMedium ? 'medium' : 'low';
  return { perHour: r2(slope), since: pts[0].t, hours: Math.round(hours * 10) / 10, samples: n, se: r3(se), confidence, startedBy };
}

// Drying per kPa of demand over the same segment. Only from a confident, genuinely drying segment with
// enough demand to mean something; null otherwise.
export function dryingCoupling(dry: SoilDryDown | null, samples: PerceptionSample[], species: SpeciesProfile, now: number): DryingCoupling | null {
  const c = species.environment.coupling;
  if (!dry || dry.confidence !== 'high' || dry.perHour >= -0.02) return null;
  const seg = samples.filter((s) => s.t >= dry.since && s.t <= now);
  const vpds = seg.flatMap((s) => (s.temp !== null && s.hum !== null ? [calculateVPD(s.temp, s.hum)] : []));
  if (vpds.length < seg.length * 0.8) return null; // too little air data over the segment
  const meanVpd = vpds.reduce((a, b) => a + b, 0) / vpds.length;
  if (meanVpd < c.minVpdKpa) return null;
  return { perHourPerKpa: r3(-dry.perHour / meanVpd), meanVpd: r2(meanVpd), hours: dry.hours };
}

// Decayed degree-hours outside the optimal range over the window, observed time only.
export function temperatureExposure(samples: PerceptionSample[], species: SpeciesProfile, cadenceMs: number, now: number): TemperatureExposure | null {
  const e = species.environment.temperatureExposure;
  const t = species.temperature;
  const from = now - e.windowHours * HOUR;
  const pts = samples.filter((s) => s.t >= from && s.t <= now && s.temp !== null);
  if (pts.length < 2) return null;
  let heat = 0;
  let cold = 0;
  let observed = 0;
  for (let i = 0; i < pts.length; i++) {
    const end = Math.min(pts[i + 1]?.t ?? now, pts[i].t + cadenceMs, now);
    const dtH = Math.max(0, end - pts[i].t) / HOUR; // a reading stands for at most one cadence: gaps don't count
    if (dtH <= 0) continue;
    observed += dtH;
    const w = Math.exp(-(now - pts[i].t) / (e.decayTauHours * HOUR));
    const temp = pts[i].temp!;
    heat += Math.max(0, temp - t.maxOptimal) * dtH * w;
    cold += Math.max(0, t.minOptimal - temp) * dtH * w;
  }
  return { heatDegreeHours: r2(heat), coldDegreeHours: r2(cold), observedHours: Math.round(observed * 10) / 10 };
}

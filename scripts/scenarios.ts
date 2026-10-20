// Scenario checks for the living engines (npm run test:scenarios). Pure: no server, no database.
// Simulates minute-by-minute readings and checks health, hysteresis, behaviour and expression.
import './tz'; // first: the tree's timezone (the build machines run in UTC)
import { evaluateBehaviour } from '../src/behaviour/BehaviourEngine';
import { expressBehaviour } from '../src/expression/ExpressionEngine';
import { applyDeveloperOverride, DEV_PRESETS } from '../src/health/developerOverrides';
import { evaluatePlantHealth, HealthMemory, initialHealthMemory } from '../src/health/HealthEngine';
import type { PlantHealthState } from '../src/health/healthTypes';
import type { BehaviourEpisode, PlantEvent } from '../src/history/historyTypes';
import { perceive, toSample } from '../src/perception/PerceptionEngine';
import { seasonState } from '../src/perception/season';
import type { PerceptionSample } from '../src/perception/perceptionTypes';
import { FICUS } from '../src/species/ficus';
import { absoluteHumidity, calculateVPD, dewPoint } from '../src/telemetry/telemetryNormalizer';
import { skyFromCode, type OutsideObservation } from '../src/telemetry/outsideWeather';
import type { PlantTelemetry } from '../src/telemetry/types';
import type { DayForecast, HikeForecast, HourForecast } from '../src/telemetry/hikeForecast';
import { chooseHikeDay, dateKey, hikeScore, hikeWindow, INITIAL_HIKE_MEMORY, planHike, type HikeMemory, type HikePlan } from '../src/behaviour/hike';
import { sampleHikePlan } from '../src/hooks/usePlantBehaviour';
import { hikeAdvice } from '../src/behaviour/messages';
import { decideSpeech, INITIAL_MESSAGE_MEMORY, type MessageMemory } from '../src/behaviour/speech';

const LOC = { latitude: 33.97, longitude: 35.73 };
const MIN = 60000;
const at = (h: number, m = 0) => new Date(2026, 5, 15, h, m).getTime(); // June: long days

interface R { soil: number; temp?: number; hum?: number; light?: number }
// Real analog readings always jitter a little; a perfectly constant raw value means a stuck probe
const jitter = (t: number, amp: number) => Math.round(Math.sin(t / 61000) * amp + Math.cos(t / 23000) * amp * 0.6);
const tel = (t: number, r: R): PlantTelemetry => {
  const temp = r.temp ?? 24;
  const hum = r.hum ?? 60;
  return {
    timestamp: t, source: 'esp32_sensor', updatedAt: '', soilMoisture: r.soil, soilRaw: 2000 + jitter(t, 7), apiSoilMoisture: r.soil,
    temperature: temp, humidity: hum, vpd: calculateVPD(temp, hum), lightPercent: r.light ?? 50, lightRaw: Math.round((r.light ?? 50) * 30) + jitter(t, 5), isDay: true, wifiRssi: -50,
  };
};

class Sim {
  memory: HealthMemory = initialHealthMemory();
  recent: PerceptionSample[] = [];
  latest: PlantTelemetry | null = null;
  prev: PlantTelemetry | null = null;
  events: PlantEvent[] = [];
  episodes: BehaviourEpisode[] = [];
  health!: PlantHealthState;
  transitions = 0;
  outside: OutsideObservation[] = []; // outside weather observations (a grey sky explains dim light)
  step(now: number, r: R | null) {
    if (r) {
      this.prev = this.latest;
      this.latest = tel(now, r);
    }
    const p = perceive({ latest: this.latest, previous: this.prev, recent: this.recent, events: this.events.filter((e) => e.timestamp <= now), location: LOC, pollMs: MIN, deviceError: r ? null : 'ETIMEDOUT', species: FICUS, now, outsideToday: this.outside, outside: this.outside.filter((o) => o.at <= now).pop() ?? null });
    const res = evaluatePlantHealth({ perception: p, species: FICUS, memory: this.memory });
    if (this.health && this.health.condition !== res.state.condition) {
      this.transitions++;
      const open = this.episodes.find((e) => e.endedAt === null);
      if (open) open.endedAt = now;
    }
    if (!this.episodes.find((e) => e.endedAt === null)) {
      this.episodes.push({ id: this.episodes.length + 1, startedAt: now, endedAt: null, lastSeenAt: now, unobservedMs: 0, condition: res.state.condition, modifiers: [], peakSeverity: 'none', engineVersion: 't' });
    }
    this.memory = res.memory;
    this.health = res.state;
    if (r) this.recent.push(toSample(this.latest!, FICUS, LOC));
    const b = evaluateBehaviour({ health: res.state, perception: p, episodes: this.episodes, events: this.events, species: FICUS, now });
    const x = expressBehaviour({ behaviour: b, health: res.state, perception: p, now });
    return { p, h: res.state, b, x };
  }
  run(from: number, minutes: number, r: (i: number, t: number) => R | null) {
    let out;
    for (let i = 0; i < minutes; i++) out = this.step(from + i * MIN, r(i, from + i * MIN));
    return out!;
  }
  water(t: number, before: number, after: number, source: 'sensor' | 'manual' = 'sensor') {
    this.events.push({ id: this.events.length + 1, timestamp: t, type: 'watering', note: null, metadata: { source, moistureBefore: before, moistureAfter: after, conditionBefore: this.health.condition } });
  }
}

let fails = 0;
const check = (name: string, ok: boolean, info = '') => {
  if (!ok) fails++;
  console.log(`${ok ? '✓' : '✗'} ${name}${info ? `  — ${info}` : ''}`);
};
const show = (o: { h: PlantHealthState }) => `${o.h.condition}${o.h.modifiers.length ? ` +${o.h.modifiers.join(',')}` : ''} v${o.h.vitality}`;

// A. Dry reading → eventually thirsty, not immediately critical
{
  const s = new Sim();
  s.run(at(9), 60, () => ({ soil: 60 }));
  const one = s.step(at(10), { soil: 5 });
  check('A1 one dry reading is not critical', !['very_dry', 'thirsty'].includes(one.h.condition), show(one));
  const thirty = s.run(at(10, 1), 31, () => ({ soil: 5 }));
  check('A2 thirsty after ~30 min', thirty.h.condition === 'thirsty', show(thirty));
  const twoh = s.run(at(10, 32), 100, () => ({ soil: 5 }));
  check('A3 very_dry only after ~2h', twoh.h.condition === 'very_dry', show(twoh));
  console.log('   vitality path:', one.h.vitality, '→', thirty.h.vitality, '→', twoh.h.vitality);

  // B. Moisture improves → recovering → comfortable later → not instant thriving
  const wt = at(12, 30);
  s.water(wt, 15, 70);
  const w1 = s.run(wt, 10, () => ({ soil: 70 }));
  check('B1 after watering: recovering (not thriving)', w1.h.condition === 'recovering', show(w1));
  const mid = s.run(wt + 10 * MIN, 3 * 60, () => ({ soil: 70 }));
  check('B1b 3h later: still recovering (critical stress needs 6h)', mid.h.condition === 'recovering', show(mid) + ' ' + mid.x.message);
  const w2 = s.run(wt + 190 * MIN, 3 * 60 + 15, () => ({ soil: 70 }));
  check('B2 later: comfortable, not yet thriving', w2.h.condition === 'comfortable', show(w2));
  const w3 = s.run(wt + 400 * MIN, 12 * 60, (_, t) => ({ soil: 70, light: new Date(t).getHours() >= 20 || new Date(t).getHours() < 6 ? 5 : 50 }));
  console.log('   B3 much later:', show(w3), '| vitality smoothed towards', w3.h.breakdown.target);
}

// C. Low light at NIGHT → sleeping, not too_dark
{
  const s = new Sim();
  const o = s.run(at(22), 30, () => ({ soil: 60, light: 7 }));
  check('C sleeping at night, not too dark', o.h.condition === 'sleeping' && !o.h.modifiers.includes('too_dark'), show(o));
  check('C light health neutral at night', o.h.scores.light === null, String(o.h.breakdown.components.find((c) => c.id === 'light')?.note));
}

// N. Humid nights: a greenhouse night is humid; only near-saturated air for hours counts (≥ 88 %)
{
  const night = (hum: number) => new Sim().run(at(21), 5 * 60, () => ({ soil: 60, light: 5, hum }));
  const n1 = night(86);
  check('HN1 an 86 % night: just sleeping (normal for a greenhouse night)', n1.h.condition === 'sleeping' && !n1.h.modifiers.includes('high_humidity'), show(n1));
  const n2 = night(90);
  check(
    'HN2 a 90 % night for hours: sleeping, with high humidity: a dewy night look (dew, low mist, heavier and slower)',
    n2.h.condition === 'sleeping' && n2.h.modifiers.includes('high_humidity') && ['dew', 'night_mist', 'condensation'].every((e) => n2.x.avatar.effects.includes(e as never)) && !n2.x.avatar.effects.includes('mist') &&
      n2.x.leafDroop > n1.x.leafDroop && n2.x.motion.swayAmount < n1.x.motion.swayAmount && !n1.x.avatar.effects.includes('dew'),
    `${show(n2)} · ${n2.x.avatar.effects.join(',')} · droop ${n1.x.leafDroop} → ${n2.x.leafDroop} · sway ${n1.x.motion.swayAmount} → ${n2.x.motion.swayAmount}`
  );
  const n3 = new Sim().run(at(9), 5 * 60, () => ({ soil: 60, hum: 86 }));
  check('HN3 by day 86 % for hours is still high humidity', n3.h.condition === 'high_humidity' || n3.h.modifiers.includes('high_humidity'), show(n3));
  // Dusk: active by day at 86 %, the sun sets, it stays 86 %: no flapping (the night exit is ≤ 84 %)
  const s = new Sim();
  const light = (t: number) => (new Date(t).getHours() >= 20 ? 5 : 50);
  s.run(at(14), 4 * 60, (_, t) => ({ soil: 60, hum: 86, light: light(t) }));
  let flips = 0;
  let was = true;
  for (let i = 0; i < 4 * 60; i++) {
    const t = at(18) + i * MIN;
    const o = s.step(t, { soil: 60, hum: 86, light: light(t) });
    const on = o.h.condition === 'high_humidity' || o.h.modifiers.includes('high_humidity');
    if (on !== was) flips++;
    was = on;
  }
  const drop = s.run(at(22), 45, () => ({ soil: 60, hum: 83, light: 5 }));
  check('HN4 dusk carry-over: active at 86 % stays active into the night, then 45 min at 83 % ends it', flips === 0 && was && !drop.h.modifiers.includes('high_humidity') && drop.h.condition !== 'high_humidity', `${flips} flips · after the drop ${show(drop)}`);
  const rule = n2.h.hysteresis.find((l) => l.id === 'high_humidity')?.rule ?? '';
  check('HN5 the debug rule names the night threshold', /at night: enter > 88%/.test(rule), rule);
}

// D. Low daytime light for a sustained period → too_dark
{
  const s = new Sim();
  const early = s.run(at(10), 60, () => ({ soil: 60, light: 15 }));
  check('D1 1h dim daylight: not too dark yet', early.h.condition !== 'too_dark', show(early));
  const late = s.run(at(11), 4 * 60, () => ({ soil: 60, light: 15 }));
  check('D2 4h+ dim daylight → too_dark', late.h.condition === 'too_dark', show(late));
}

// D3-D6. A grey sky outside explains dim light (relative to the sky as well as the sun)
{
  const grey = (s: Sim, code: number) => {
    for (let t = at(0); t < at(23, 59); t += 15 * MIN) s.outside.push({ at: t, sky: skyFromCode(code), code, temperature: 12, humidity: 90, precipitation: 1, cloudCover: 100, wind: 10, gusts: 15, isDay: true });
  };
  const overcast = new Sim();
  grey(overcast, 3);
  const o = overcast.run(at(10), 5 * 60, () => ({ soil: 60, light: 18 }));
  check('D3 overcast all day, LDR 18%: explained by the sky, not too dark', o.h.condition !== 'too_dark' && !o.h.modifiers.includes('too_dark'), `${show(o)} · ${o.p.light.reasoning.find((x) => x.includes('grey')) ?? ''}`);
  const light = o.h.metrics.find((m) => m.id === 'light');
  check('D3b the light card says "Grey day", not "Low"', light?.status === 'Grey day' && light.tone === 'info', `${light?.status} (${light?.tone})`);
  const clear = new Sim();
  grey(clear, 0);
  const c = clear.run(at(10), 5 * 60, () => ({ soil: 60, light: 18 }));
  check('D4 clear sky, same LDR 18%: too dark (a dim spot, not the weather)', c.h.condition === 'too_dark', show(c));
  const cave = new Sim();
  grey(cave, 3);
  const k = cave.run(at(10), 5 * 60, () => ({ soil: 60, light: 6 }));
  check('D5 overcast but LDR 6%: still too dark (darker than even a grey sky explains)', k.h.condition === 'too_dark', show(k));
  check('D6 a grey day scores fairer light than the same reading on a clear day', (o.h.scores.light ?? 0) > (c.h.scores.light ?? 0), `${o.h.scores.light} vs ${c.h.scores.light}`);
}

// DD1-DD8. Soil dry-down: one uninterrupted segment, with a confidence
{
  const { soilDryDown, dryingCoupling, temperatureExposure } = await import('../src/perception/environment');
  const t0 = at(8);
  const smp = (t: number, soil: number | null, temp = 24, hum = 55) => ({ t, soil, soilRaw: null, temp, hum, light: 50, radiation: null, lightRaw: null, isDay: true, lightExpected: true });
  // minute readings drying at `rate` %/h with ±1 % jitter (the FC-28's real noise)
  const series = (from: number, minutes: number, start: number, rate: number, noise = 1) =>
    Array.from({ length: minutes }, (_, i) => smp(from + i * MIN, start + (rate * i) / 60 + Math.sin(i * 1.7) * noise + Math.cos(i * 0.9) * noise * 0.6));
  const dd = (samples: ReturnType<typeof smp>[], now: number, extra: Partial<Parameters<typeof soilDryDown>[0]> = {}) =>
    soilDryDown({ samples, events: [], breaks: [], gapMs: 15 * MIN, soilSuspect: false, now, ...extra });

  const steady = series(t0, 6 * 60, 70, -0.4);
  const d1 = dd(steady, t0 + 6 * 60 * MIN);
  check('DD1 noisy steady dry-down: slope ≈ −0.4 %/h with high confidence', !!d1 && Math.abs(d1.perHour + 0.4) <= 0.08 && d1.confidence === 'high', JSON.stringify(d1));

  // A watering inside the window: the regression never bridges it
  const wAt = t0 + 3 * 60 * MIN;
  const before = series(t0, 3 * 60, 50, -0.6);
  const after = series(wAt, 5 * 60, 80, -0.3);
  const watered = [...before, ...after];
  const ev = [{ id: 1, timestamp: wAt, type: 'watering' as const, note: null, metadata: {} }];
  const soon = dd(watered.filter((x) => x.t <= wAt + 2 * 60 * MIN), wAt + 2 * 60 * MIN, { events: ev });
  const later = dd(watered, wAt + 5 * 60 * MIN, { events: ev });
  check('DD2 after a watering: no estimate until the new segment is long enough (never bridged)', soon === null, JSON.stringify(soon));
  check('DD2b then only the new segment counts, started by the watering', !!later && later.startedBy === 'watering' && later.since >= wAt + 45 * MIN && Math.abs(later.perHour + 0.3) <= 0.1, JSON.stringify(later));

  // A disconnection (40 min without readings) starts a new segment after it
  const gapped = [...series(t0, 120, 70, -0.4), ...series(t0 + 160 * MIN, 4 * 60, 69, -0.4)];
  const d3 = dd(gapped, t0 + 400 * MIN);
  check('DD3 a gap (disconnection) is never bridged', !!d3 && d3.startedBy === 'gap' && d3.since >= t0 + 160 * MIN, JSON.stringify(d3 && { since: (d3.since - t0) / MIN, by: d3.startedBy }));

  // Calibration: a change starts a new segment; a pause going on gives no estimate
  const calAt = t0 + 2 * 60 * MIN;
  const d4 = dd(steady, t0 + 6 * 60 * MIN, { breaks: [calAt] });
  const paused = dd(steady, t0 + 6 * 60 * MIN, { breaks: [t0 + 7 * 60 * MIN] });
  check('DD4 a calibration change starts a new segment; during a pause: no estimate', !!d4 && d4.startedBy === 'calibration' && d4.since >= calAt && paused === null);
  check('DD5 a suspect soil sensor: no estimate', dd(steady, t0 + 6 * 60 * MIN, { soilSuspect: true }) === null);
  check('DD6 missing history (1 h): no estimate', dd(series(t0, 60, 70, -0.4), t0 + 60 * MIN) === null);
  const noisy = dd(series(t0, 4 * 60, 70, -0.2, 9), t0 + 4 * 60 * MIN);
  check('DD7 very noisy readings: low confidence', !!noisy && noisy.confidence === 'low', JSON.stringify(noisy && { se: noisy.se, c: noisy.confidence }));

  // The voice predicts only with enough evidence
  const sim = new Sim();
  const short = sim.run(at(9), 60, (i) => ({ soil: 70 - i * 0.008 }));
  const shortThought = short.b.voice.musings.find((m) => m.id === 'soil_steady');
  const long = sim.run(at(10), 5 * 60, (i) => ({ soil: 69.5 - i * 0.008 }));
  const longThought = long.b.voice.musings.find((m) => m.id === 'soil_steady');
  check('DD8 the voice predicts thirst only from a confident segment', (!shortThought || shortThought.facts.hoursToThirsty === -1) && !!longThought && longThought.facts.hoursToThirsty > 0, `short ${shortThought?.facts.hoursToThirsty}, long ${longThought?.facts.hoursToThirsty} h (${long.p.trends.soilDryDown?.confidence})`);

  // ---- CP1-CP4. Moisture–VPD coupling: diagnostic only ----
  const cp = dryingCoupling(d1, steady, FICUS, t0 + 6 * 60 * MIN);
  check('CP1 coupling = drying rate / mean VPD, from a confident drying segment', !!cp && Math.abs(cp.perHourPerKpa - -d1!.perHour / cp.meanVpd) < 0.01 && cp.meanVpd > 1, JSON.stringify(cp));
  const lowDemand = series(t0, 6 * 60, 70, -0.4).map((x) => ({ ...x, temp: 15, hum: 95 }));
  check('CP1b too little evaporative demand (VPD < 0.5): no coupling', dryingCoupling(dd(lowDemand, t0 + 6 * 60 * MIN), lowDemand, FICUS, t0 + 6 * 60 * MIN) === null);

  const { updateCouplingBaseline, interpretEnvironment, INITIAL_COUPLING } = await import('../src/health/environment');
  const fakeP = (perHourPerKpa: number | null, atT: number) =>
    ({ at: atT, drying: perHourPerKpa === null ? null : { perHourPerKpa, meanVpd: 1.2, hours: 5 }, quality: { suspect: { soil: false, light: false, air: false } }, exposure: { temperature: null } }) as any;
  let mem = INITIAL_COUPLING;
  const start = at(0);
  for (let h = 0; h < 30; h++) mem = updateCouplingBaseline(mem, fakeP(0.35, start + h * 60 * MIN), true, FICUS);
  const day2 = interpretEnvironment(fakeP(0.15, start + 30 * 60 * MIN), mem, FICUS);
  check('CP2 missing history: the baseline is still learning before 3 days, whatever the hours', day2.coupling.status === 'learning' && day2.coupling.note === null, `${day2.coupling.status} (${mem.hours}h)`);
  for (let h = 0; h < 4 * 24; h++) mem = updateCouplingBaseline(mem, fakeP(0.35, start + h * 60 * MIN), h % 24 < 10, FICUS); // only live hours learn
  const typical = interpretEnvironment(fakeP(0.34, start + 4 * 24 * 60 * MIN), mem, FICUS);
  const slower = interpretEnvironment(fakeP(0.14, start + 4 * 24 * 60 * MIN), mem, FICUS);
  check('CP3 an established baseline: typical vs slower, with a diagnostic note', typical.coupling.status === 'typical' && slower.coupling.status === 'slower' && /diagnostic/.test(slower.coupling.note ?? ''), `baseline ${mem.baseline} (${mem.hours}h) · ${typical.coupling.status} ×${typical.coupling.ratio} · ${slower.coupling.status} ×${slower.coupling.ratio}`);
  const notLive = updateCouplingBaseline(mem, fakeP(0.9, start + 5 * 24 * 60 * MIN), false, FICUS);
  check('CP3b no live data: the baseline learns nothing', JSON.stringify(notLive) === JSON.stringify(mem));
  // Diagnostic only: the same perception with a very different baseline → identical biology
  const live = new Sim();
  const o = live.run(at(9), 5 * 60, (i) => ({ soil: 70 - i * 0.008, temp: 27, hum: 40 }));
  const memA = { ...live.memory, environment: { coupling: { baseline: 0.01, hours: 200, firstAt: at(9) - 10 * 24 * 60 * MIN, updatedAt: at(9) } } };
  const memB = { ...live.memory, environment: { coupling: { baseline: 5, hours: 200, firstAt: at(9) - 10 * 24 * 60 * MIN, updatedAt: at(9) } } };
  const ha = evaluatePlantHealth({ perception: o.p, species: FICUS, memory: memA }).state;
  const hb = evaluatePlantHealth({ perception: o.p, species: FICUS, memory: memB }).state;
  const bio = (h: typeof ha) => JSON.stringify({ c: h.condition, m: h.modifiers, v: h.vitality, s: h.scores, tones: h.metrics.map((x) => [x.id, x.status, x.tone]) });
  check('CP4 coupling never reaches vitality, conditions or metric tones (diagnostic only)', bio(ha) === bio(hb) && ha.environment?.coupling.status !== hb.environment?.coupling.status, `${ha.environment?.coupling.status} vs ${hb.environment?.coupling.status}; vitality ${ha.vitality} = ${hb.vitality}`);

  // ---- TX1-TX4. Temperature exposure: accumulates, recovers gradually, observed time only ----
  const tx = new Sim();
  tx.run(at(6), 120, () => ({ soil: 60, temp: 24 }));
  const scoreTrace: number[] = [];
  let hot: any;
  for (let i = 0; i < 6 * 60; i++) {
    hot = tx.step(at(8) + i * MIN, { soil: 60, temp: 31 });
    scoreTrace.push(hot.h.scores.temperature ?? 0);
  }
  const atHotEnd = hot.h.environment.temperatureExposure;
  const back: number[] = [];
  let last: any;
  for (let i = 0; i < 24 * 60; i++) {
    last = tx.step(at(14) + i * MIN, { soil: 60, temp: 24 });
    back.push(last.h.scores.temperature ?? 0);
  }
  const jumps = Math.max(...back.slice(1).map((v, i) => Math.abs(v - back[i])));
  check(
    'TX1 six hours at 31 °C (below the 32 °C "hot" latch): exposure builds; back at 24 °C the score lingers instead of snapping to 100',
    atHotEnd.heatDegreeHours > 5 && atHotEnd.penalty > 15 && hot.h.condition !== 'hot' && back[0] < 90,
    `heat ${atHotEnd.heatDegreeHours} °C·h (−${atHotEnd.penalty}), score at 31 °C ${scoreTrace[scoreTrace.length - 1]}, first minute back at 24 °C ${back[0]}`
  );

  check('TX2 back to 24 °C: it recovers gradually, never resets abruptly, and fully after a day', back[60] < back[6 * 60] && back[6 * 60] <= 100 && back[back.length - 1] === 100 && jumps <= 3, `+1h ${back[60]}, +6h ${back[6 * 60]}, +24h ${back[back.length - 1]}, biggest step ${jumps}`);
  // Downstream: only through vitality (gradual, smoothed) → behaviour's energy; nothing parallel
  const control = new Sim();
  control.run(at(6), 120, () => ({ soil: 60, temp: 24 }));
  control.run(at(8), 6 * 60, () => ({ soil: 60, temp: 24 }));
  const ctrl1h = control.run(at(14), 60, () => ({ soil: 60, temp: 24 }));
  const exposed1h = tx; // already 24 h past the heat; replay a fresh one for the 1 h comparison
  const tx2 = new Sim();
  tx2.run(at(6), 120, () => ({ soil: 60, temp: 24 }));
  tx2.run(at(8), 6 * 60, () => ({ soil: 60, temp: 31 }));
  const exp1h = tx2.run(at(14), 60, () => ({ soil: 60, temp: 24 }));
  check(
    'TX5 downstream: an hour after the heat, vitality and energy are a little lower than a tree that stayed at 24 °C; the same condition',
    exp1h.h.vitality < ctrl1h.h.vitality && exp1h.b.energy <= ctrl1h.b.energy && exp1h.h.condition === ctrl1h.h.condition,
    `vitality ${ctrl1h.h.vitality} vs ${exp1h.h.vitality}, energy ${ctrl1h.b.energy} vs ${exp1h.b.energy}, ${exp1h.h.condition}`
  );
  void exposed1h;
  const brief = new Sim();
  brief.run(at(6), 120, () => ({ soil: 60, temp: 24 }));
  const b1 = brief.run(at(8), 60, () => ({ soil: 60, temp: 29 }));
  check('TX3 a brief hour at 29 °C barely matters', (b1.h.environment?.temperatureExposure?.penalty ?? 0) <= 3, `penalty ${b1.h.environment?.temperatureExposure?.penalty}`);
  const gapSamples = [...Array.from({ length: 60 }, (_, i) => smp(t0 + i * MIN, 60, 31)), ...Array.from({ length: 60 }, (_, i) => smp(t0 + 300 * MIN + i * MIN, 60, 31))];
  const ex = temperatureExposure(gapSamples, FICUS, 3 * MIN, t0 + 360 * MIN);
  check('TX4 a 4-hour gap in the readings counts for nothing', !!ex && Math.abs(ex.observedHours - 2) < 0.1, JSON.stringify(ex));
}

// R1-R3. Sunrise / sunset to the minute: published (Open-Meteo) when available, else computed
{
  const { sunTimes } = await import('../src/perception/sun');
  // Open-Meteo for Feytroun on 2026-10-16: sunrise 06:42, sunset 18:02 local (UTC+3) = 03:42Z / 15:02Z
  const t = sunTimes(Date.UTC(2026, 9, 16, 9), LOC.latitude, LOC.longitude);
  const off = (a: number | null, b: number) => (a === null ? Infinity : Math.abs(a - b) / MIN);
  const dr = off(t.sunrise, Date.UTC(2026, 9, 16, 3, 42));
  const ds = off(t.sunset, Date.UTC(2026, 9, 16, 15, 2));
  check('R1 computed sunrise/sunset within 3 min of the published times', dr <= 3 && ds <= 3, `sunrise ±${dr.toFixed(1)} min, sunset ±${ds.toFixed(1)} min`);
  const sim = new Sim();
  const noon = at(12);
  const pub = { sunrise: at(5, 31), sunset: at(19, 52) };
  sim.outside.push({ at: noon - 5 * MIN, sky: 'clear', code: 0, temperature: 25, humidity: 50, precipitation: 0, cloudCover: 0, wind: 5, gusts: 8, isDay: true, ...pub });
  const withPub = sim.step(noon, { soil: 60 });
  check('R2 published times win when they are today\'s', withPub.p.sun.timesFrom === 'open-meteo' && withPub.p.sun.sunrise === pub.sunrise && withPub.p.sun.sunset === pub.sunset);
  const plain = new Sim().step(noon, { soil: 60 });
  check('R3 without them: computed from the location', plain.p.sun.timesFrom === 'solar' && plain.p.sun.sunrise !== null && plain.p.sun.sunset !== null && plain.p.sun.sunrise! < noon && plain.p.sun.sunset! > noon);
}

// H1-H4. Inside vs outside air, compared by dew point (RH depends on temperature). Facts only.
{
  const near = (a: number | null, b: number, tol: number) => a !== null && Math.abs(a - b) <= tol;
  check('H1 dew point: 19°C/55% ≈ 9.8°C, 23°C/81% ≈ 19.6°C', near(dewPoint(19, 55), 9.8, 0.3) && near(dewPoint(23, 81), 19.6, 0.3), `${dewPoint(19, 55)} · ${dewPoint(23, 81)}`);
  check('H1b absolute humidity: 19°C/55% ≈ 8.9 g/m³; missing input → null', near(absoluteHumidity(19, 55), 8.9, 0.3) && absoluteHumidity(null, 50) === null && dewPoint(20, null) === null, `${absoluteHumidity(19, 55)}`);
  const withOutside = (outTemp: number, outHum: number, inTemp: number, inHum: number) => {
    const sim = new Sim();
    const t = at(12);
    sim.outside.push({ at: t - 5 * MIN, sky: 'overcast', code: 3, temperature: outTemp, humidity: outHum, precipitation: 0, cloudCover: 100, wind: 5, gusts: 10, isDay: true });
    return sim.run(t - 30 * MIN, 30, () => ({ soil: 60, temp: inTemp, hum: inHum }));
  };
  const balcony = withOutside(12, 55, 23, 81);
  check(
    'H2 closed balcony 23°C/81% vs outside 12°C/55%: much more moisture inside, the glass may fog',
    !!balcony.p.air && balcony.p.air.moistureRatio >= 2.5 && balcony.p.air.glassMayFog,
    JSON.stringify(balcony.p.air)
  );
  const mild = withOutside(22, 60, 23, 60);
  check('H3 similar air inside and out: about the same, no fog', !!mild.p.air && mild.p.air.moistureRatio >= 0.9 && mild.p.air.moistureRatio <= 1.2 && !mild.p.air.glassMayFog, JSON.stringify(mild.p.air));
  const none = new Sim().run(at(12), 20, () => ({ soil: 60, temp: 23, hum: 81 }));
  check('H4 no outside weather → no comparison; health never reads it', none.p.air === null && JSON.stringify(withOutside(12, 55, 23, 60).h.condition) === JSON.stringify(new Sim().run(at(11, 30), 30, () => ({ soil: 60, temp: 23, hum: 60 })).h.condition));
}

// E. High temperature briefly → little/no vitality damage
{
  const s = new Sim();
  const base = s.run(at(9), 120, () => ({ soil: 60 }));
  const spike = s.run(at(11), 10, () => ({ soil: 60, temp: 36 }));
  const after = s.run(at(11, 10), 20, () => ({ soil: 60 }));
  check('E1 brief spike: no "hot" state', spike.h.condition !== 'hot' && !spike.h.modifiers.includes('hot'), show(spike));
  check('E2 brief spike: vitality barely moves (≤3)', base.h.vitality - Math.min(spike.h.vitality, after.h.vitality) <= 3, `${base.h.vitality} → ${spike.h.vitality} → ${after.h.vitality}`);
}

// F. High temperature sustained + dry soil → hot_and_dry, stronger response
{
  const hot = new Sim();
  hot.run(at(9), 60, () => ({ soil: 60 }));
  const hotOnly = hot.run(at(10), 3 * 60, () => ({ soil: 60, temp: 35 }));
  const both = new Sim();
  both.run(at(9), 60, () => ({ soil: 60 }));
  const hd = both.run(at(10), 3 * 60, () => ({ soil: 14, temp: 35 }));
  check('F1 sustained heat + dry soil → hot_and_dry', hd.h.condition === 'hot_and_dry', show(hd));
  check('F2 stronger than heat alone', hd.h.vitality < hotOnly.h.vitality - 5, `hot only ${show(hotOnly)} vs ${show(hd)}`);
  check('F3 stronger expression', hd.b.expressionIntensity > hotOnly.b.expressionIntensity, `${hotOnly.b.expressionIntensity} vs ${hd.b.expressionIntensity}`);
}

// G. Watering while thirsty → relief
{
  const s = new Sim();
  s.run(at(9), 90, () => ({ soil: 14 }));
  check('G0 thirsty before watering', s.health.condition === 'thirsty', show({ h: s.health }));
  s.water(at(10, 30), 28, 72);
  const o = s.step(at(10, 31), { soil: 72 });
  check('G relief response', o.b.messageIntent === 'watering_relief' && o.b.mood === 'relieved', `${o.b.mood}: ${o.x.message.text}`);
}

// H. Watering while already waterlogged → concern, no "refreshing"
{
  const s = new Sim();
  s.run(at(0), 13 * 60, (i) => ({ soil: 95 + (i % 3) }));
  check('H0 soaked 13h → too_wet', s.health.condition === 'too_wet', show({ h: s.health }));
  s.water(at(13, 5), 96, null as any, 'manual');
  const o = s.step(at(13, 6), { soil: 96 });
  check('H concerned, not celebrating', o.b.messageIntent === 'watering_enough' && o.b.mood === 'concerned' && !/refreshing|needed that|feels so good/i.test(o.x.message.text), `${o.b.mood}: ${o.x.message.text}`);
}

// I. ESP32 disconnected → held state + uncertainty overlay, then sensor_uncertain; no fake values
{
  const s = new Sim();
  s.run(at(9), 60, () => ({ soil: 60 }));
  const before = s.health.condition;
  const o = s.run(at(10), 5, () => null);
  check('I1 short outage: biological state held + overlay', o.h.condition === before && o.h.modifiers.includes('sensor_uncertain') && o.h.observation.status === 'unobserved', show(o));
  const long = s.run(at(10, 5), 30, () => null);
  check('I1b outage > 30 min: sensor_uncertain becomes primary', long.h.condition === 'sensor_uncertain' && long.h.observation.status === 'unknown', show(long));
  check('I2 no perceived values', Object.values(o.p.readings).every((v) => v === null));
  check('I3 metrics say no live reading', o.h.metrics.every((m) => m.tone === 'off'), o.h.metrics.map((m) => m.display).join(', '));
  check('I4 vitality frozen, not invented', o.h.breakdown.frozen);
}

// J. Developer override → only presentation
{
  const s = new Sim();
  const live = s.run(at(9), 30, () => ({ soil: 60 }));
  const copy = JSON.stringify(live.h);
  const ov = applyDeveloperOverride(live.h, DEV_PRESETS.find((p) => p.id === 'very_dry')!, FICUS);
  check('J override changes condition', ov.condition === 'very_dry' && ov.isOverride);
  check('J live state untouched', JSON.stringify(live.h) === copy && ov.metrics === live.h.metrics);
}

// L. Season: from the date and latitude; it colours behaviour and expression, never health
{
  const oct = seasonState(new Date(2026, 9, 15, 12).getTime(), LOC.latitude);
  const jan = seasonState(new Date(2027, 0, 20, 12).getTime(), LOC.latitude);
  const south = seasonState(new Date(2026, 9, 15, 12).getTime(), -33.9);
  check('L1 mid-October in Feytroun is mid autumn, days shortening', oct.id === 'autumn' && oct.stage === 'mid' && oct.daylightTrend === 'shortening', `${oct.stage} ${oct.id}, ${oct.daylightHours}h`);
  check('L1b daylight ~11h in mid-October at 34°N', oct.daylightHours !== null && oct.daylightHours > 10.8 && oct.daylightHours < 11.6, `${oct.daylightHours}h`);
  check('L2 January is winter, keyed to the winter it started in', jan.id === 'winter' && jan.key === '2026-winter' && jan.daylightTrend === 'lengthening', jan.key);
  check('L3 southern hemisphere is flipped', south.id === 'spring', south.id);

  const s = new Sim();
  const o = s.run(at(9), 60, () => ({ soil: 60 }));
  const asSeason = (id: 'spring' | 'winter') => ({ ...o.p, season: { ...o.p.season, id, stage: 'mid' as const, progress: 0.5 } });
  const bWinter = evaluateBehaviour({ health: o.h, perception: asSeason('winter'), episodes: s.episodes, events: [], species: FICUS, now: at(10) });
  const bSpring = evaluateBehaviour({ health: o.h, perception: asSeason('spring'), episodes: s.episodes, events: [], species: FICUS, now: at(10) });
  check('L4 winter rest is quieter than the spring flush', bWinter.energy < bSpring.energy && bWinter.primaryState === bSpring.primaryState, `${bWinter.energy} vs ${bSpring.energy}`);
  const xWinter = expressBehaviour({ behaviour: bWinter, health: o.h, perception: asSeason('winter'), now: at(10) });
  check('L5 a calm tree wears the season', xWinter.avatar.foliage === 'deep' && xWinter.atmosphere.season === 'winter', `${xWinter.avatar.foliage}`);
}

// N. Season is gradual across boundaries, and changes what the same care means
{
  const s = new Sim();
  const o = s.run(at(9), 60, () => ({ soil: 60 }));
  const day = (y: number, mo: number, d: number, h = 12) => new Date(y, mo, d, h).getTime();
  const live = (t: number, events: PlantEvent[] = []) => {
    const p = { ...o.p, season: seasonState(t, LOC.latitude) };
    const b = evaluateBehaviour({ health: o.h, perception: p, episodes: s.episodes, events, species: FICUS, now: t });
    return { b, x: expressBehaviour({ behaviour: b, health: o.h, perception: p, now: t }) };
  };
  // Walk the whole year a day at a time: no jump in energy, foliage mix or leaf cycle
  let energyStep = 0;
  let cycleStep = 0;
  let prev = live(day(2026, 0, 1));
  for (let i = 1; i < 366; i++) {
    const cur = live(day(2026, 0, 1 + i));
    energyStep = Math.max(energyStep, Math.abs(cur.b.season.energy - prev.b.season.energy));
    const c = cur.b.season.cycle;
    const q = prev.b.season.cycle;
    cycleStep = Math.max(cycleStep, Math.abs(c.yellowing - q.yellowing), Math.abs(c.newGrowth - q.newGrowth), Math.abs(c.leafDrop - q.leafDrop));
    prev = cur;
  }
  // Without blending, a boundary would jump energy by up to 0.07 in one day (0.01 = one rounding step)
  check('N1 no day-to-day jump in seasonal energy or leaf cycle all year', energyStep <= 0.011 && cycleStep <= 0.045, `max daily step: energy ${energyStep.toFixed(4)}, cycle ${cycleStep.toFixed(3)}`);
  const nov30 = live(day(2026, 10, 30, 23));
  const dec1 = live(day(2026, 11, 1, 1));
  check(
    'N2 Nov 30 → Dec 1: autumn and winter meet halfway, no cliff',
    Math.abs(nov30.b.season.energy - dec1.b.season.energy) < 0.01 && nov30.x.avatar.foliageBlend?.tone === 'deep' && (dec1.x.avatar.foliageBlend?.amount ?? 0) > 0.45,
    `${nov30.b.season.energy} → ${dec1.b.season.energy}, blend ${JSON.stringify(dec1.x.avatar.foliageBlend)}`
  );
  check('N3 mid-autumn: leaves yellowing, a few letting go; mid-spring: fresh growth', live(day(2026, 9, 25)).x.avatar.seasonalLeaves.yellowing > 0.8 && live(day(2026, 3, 15)).x.avatar.seasonalLeaves.newGrowth > 0.9);

  // Diffraction: the same care, a different season → a different response
  const feed = (t: number): PlantEvent => ({ id: 900, timestamp: t - 5 * MIN, type: 'fertilizing', note: null, metadata: {} });
  const fedWinter = live(day(2027, 0, 15), [feed(day(2027, 0, 15))]);
  const fedSpring = live(day(2026, 3, 15), [feed(day(2026, 3, 15))]);
  check(
    'N4 feeding in winter: patient, no sparkles; in spring: grateful, sparkles',
    fedWinter.b.reaction?.seasonal === 'off_season_feed' && fedWinter.b.mood === 'patient' && !fedWinter.x.avatar.effects.includes('sparkles') &&
      fedSpring.b.reaction?.seasonal === 'in_season_feed' && fedSpring.b.mood === 'grateful' && fedSpring.x.avatar.effects.includes('sparkles'),
    `${fedWinter.b.mood} vs ${fedSpring.b.mood}`
  );
  check('N5 the season is in the diffraction and epidermal layers', !!fedWinter.x.layers.diffraction?.includes('off season feed') && fedWinter.x.layers.epidermal.some((l) => l.startsWith('mid winter: resting')), fedWinter.x.layers.diffraction ?? '');
  check('N6 the season is in the words', fedWinter.x.message.text !== fedSpring.x.message.text, `"${fedWinter.x.message.text}" | "${fedSpring.x.message.text}"`);
}

// M. Every condition has its own scene and look
{
  const s = new Sim();
  const o = s.run(at(9), 30, () => ({ soil: 60 }));
  const looks = DEV_PRESETS.filter((p) => p.modifiers.length === 0).map((p) => {
    const h = applyDeveloperOverride(o.h, p, FICUS);
    const b = evaluateBehaviour({ health: h, perception: o.p, episodes: [], events: [], species: FICUS, now: at(10) });
    const x = expressBehaviour({ behaviour: b, health: h, perception: o.p, now: at(10) });
    return { id: p.id, sig: `${x.atmosphere.scene}|${x.avatar.animation}|${x.avatar.eyes}|${x.avatar.mouth}|${x.avatar.foliage}`, scene: x.atmosphere.scene };
  });
  const sigs = new Set(looks.map((l) => l.sig));
  check('M1 no two conditions look alike', sigs.size === looks.length, `${sigs.size}/${looks.length} distinct`);
  const asleep = looks.find((l) => l.id === 'sleeping')!;
  const dark = looks.find((l) => l.id === 'too_dark')!;
  check('M2 sleeping is night, too dark is a dim day', asleep.scene === 'night' && dark.scene === 'dim');
}

// Hysteresis: hovering around the threshold must not flap
{
  const s = new Sim();
  s.run(at(9), 60, () => ({ soil: 60 }));
  s.transitions = 0;
  const o = s.run(at(10), 6 * 60, (i) => ({ soil: i % 2 ? 16.9 : 17.1 }));
  check('K hovering 16.9/17.1 for 6h: ≤1 transition', s.transitions <= 1, `${s.transitions} transitions, ends ${show(o)}`);
  s.transitions = 0;
  const o2 = s.run(at(16), 60, (i) => ({ soil: i % 2 ? 18 : 19 }));
  check('K2 between enter (17) and exit (20): stays thirsty', o2.h.condition === 'thirsty' && s.transitions === 0, show(o2));
}

// HK. The weekly hike: the best forecast day of the week, moved by the forecast until it arrives, then locked
{
  // June 15 2026 is a Monday. One day's forecast, from a plain good day
  const day = (date: string, x: Partial<DayForecast> = {}): DayForecast => ({ date, code: 1, sky: 'clear', tMax: 22, tMin: 14, rainChance: 10, rainMm: 0, gustsMax: 20, ...x });
  const week = (overrides: Record<string, Partial<DayForecast>>): HikeForecast => ({
    fetchedAt: at(6),
    days: Array.from({ length: 14 }, (_, i) => {
      const date = `2026-06-${String(15 + i).padStart(2, '0')}`;
      return day(date, overrides[date] ?? { rainChance: 40, code: 3, sky: 'overcast' });
    }),
  });
  const dayAt = (d: number, h = 10) => new Date(2026, 5, d, h).getTime();
  let mem: HikeMemory = { ...INITIAL_HIKE_MEMORY, forecast: week({ '2026-06-20': {} }) };
  const p1 = planHike(mem, dayAt(15));
  mem = p1.memory;
  check('HK1 the best forecast day of the week is picked', p1.plan?.day === '2026-06-20' && !p1.plan.today && !p1.plan.locked && p1.plan.quality === 'great', `${p1.plan?.day} ${p1.plan?.quality}`);
  mem = { ...mem, forecast: week({ '2026-06-18': {}, '2026-06-20': { code: 63, sky: 'heavy_rain', rainChance: 90, rainMm: 12 } }) };
  const p2 = planHike(mem, dayAt(16));
  mem = p2.memory;
  check('HK2 the forecast changes: the pick moves and remembers where from', p2.plan?.day === '2026-06-18' && p2.plan.movedFrom === '2026-06-20', `${p2.plan?.day} from ${p2.plan?.movedFrom}`);
  const p3 = planHike(mem, dayAt(18, 8));
  mem = p3.memory;
  mem = { ...mem, forecast: week({ '2026-06-18': { code: 61, sky: 'rain', rainChance: 70 }, '2026-06-20': { tMax: 21 } }) };
  const p3b = planHike(mem, dayAt(18, 15));
  mem = p3b.memory;
  check('HK3 its day arrives: today, locked; a better forecast elsewhere no longer moves it', p3.plan?.today === true && p3b.plan?.day === '2026-06-18' && p3b.plan.locked, `${p3b.plan?.day} locked=${p3b.plan?.locked}`);
  const p4 = planHike({ ...mem, forecast: week({ '2026-06-27': {} }) }, dayAt(19));
  check('HK4 once this week\'s hike is behind us, next week\'s pick (tentative)', p4.plan?.nextWeek === true && p4.plan.day === '2026-06-27' && !p4.plan.locked, `${p4.plan?.day} next=${p4.plan?.nextWeek}`);
  const p5 = planHike({ ...INITIAL_HIKE_MEMORY, forecast: week({ '2026-06-15': {}, '2026-06-19': { tMax: 27 } }) }, dayAt(17));
  check('HK5 days already passed never compete', p5.plan?.day === '2026-06-19', String(p5.plan?.day));
  check('HK5b no forecast: no plan', planHike(INITIAL_HIKE_MEMORY, dayAt(15)).plan === null);
  check('HK5c a storm scores far below a mild dry day', hikeScore(day('x', { code: 95, sky: 'thunderstorm', rainChance: 80, rainMm: 15 })) < 20 && hikeScore(day('x')) >= 90);

  // The tree announces it: calm and by day, once per pick, again when the forecast moves it
  const s = new Sim();
  const o = s.run(at(9), 60, () => ({ soil: 60 }));
  const say = (plan: HikePlan | null, memory: MessageMemory, now: number) => {
    const b = evaluateBehaviour({ health: o.h, perception: o.p, episodes: [], events: [], species: FICUS, now, hike: plan });
    const sp = decideSpeech({ behaviour: b, severity: o.h.severity, memory, now });
    return { b, sp, x: expressBehaviour({ behaviour: b, health: o.h, perception: o.p, speech: sp.decision, now }) };
  };
  const plan = (x: Partial<HikePlan>): HikePlan => ({ ...p1.plan!, ...x });
  const a = say(plan({}), INITIAL_MESSAGE_MEMORY, at(10));
  check('HK6 calm by day: the pick is announced with its weekday', a.b.dayLine === 'hike_picked' && a.x.message.text.includes('Saturday'), a.x.message.text);
  const a2 = say(plan({}), a.sp.memory, at(10, 30));
  const moved = say(plan({ day: '2026-06-18', movedFrom: '2026-06-20' }), a2.sp.memory, at(11));
  check('HK6b said once; a moved pick is news again', !a2.sp.decision.reason.startsWith('the hike') && moved.b.dayLine === 'hike_moved' && moved.x.message.text.includes('Thursday'), `${a2.sp.decision.reason} | ${moved.x.message.text}`);
  const today = say(plan({ day: '2026-06-15', today: true, locked: true }), INITIAL_MESSAGE_MEMORY, at(10));
  check('HK7 hike day: the boots are out and the tree says so', today.x.hike?.boots === true && today.b.dayLine === 'hike_today' && a.x.hike?.boots === false, today.x.message.text);
  const none = say(null, INITIAL_MESSAGE_MEMORY, at(10));
  check('HK7b without a forecast nothing about a hike appears', none.x.hike === undefined && none.b.hike === undefined && !String(none.b.dayLine).startsWith('hike'));
  // The developer previews show what they say on every weekday (late in the week: next week's pick)
  const wrong = Array.from({ length: 7 }, (_, i) => dayAt(15 + i)).flatMap((t) => {
    const [picked, movedPlan, hikeDay] = (['announced', 'moved', 'today'] as const).map((k) => sampleHikePlan(k, t));
    const ok = !!picked && !picked.today && !!movedPlan?.movedFrom && !movedPlan.today && hikeDay?.today === true;
    return ok ? [] : [dateKey(t)];
  });
  check('HK8 hike previews: picked / moved / hike day on every weekday', wrong.length === 0, wrong.join(', '));

  // Two days on offer; the people choose one, and their choice holds whatever the forecast does
  const two = week({ '2026-06-20': {}, '2026-06-17': { tMax: 20, rainChance: 20 } });
  const o1 = planHike({ ...INITIAL_HIKE_MEMORY, forecast: two }, dayAt(15));
  check('HK9 the tree offers its pick and the next best day', o1.plan?.options.join() === '2026-06-20,2026-06-17' && !o1.plan.chosen, String(o1.plan?.options));
  const c1 = chooseHikeDay(o1.memory, '2026-06-17', dayAt(15))!;
  const o2 = planHike(c1, dayAt(15));
  const o3 = planHike({ ...o2.memory, forecast: week({ '2026-06-19': {}, '2026-06-17': { code: 61, sky: 'rain', rainChance: 70 } }) }, dayAt(16));
  check('HK9b a chosen day holds against a better forecast elsewhere (not "moved")', o2.plan?.day === '2026-06-17' && o2.plan.chosen && o3.plan?.day === '2026-06-17' && o3.plan.chosen && o3.plan.movedFrom === null, `${o3.plan?.day} chosen=${o3.plan?.chosen}`);
  check('HK9c past days, other weeks and days without a forecast cannot be chosen', !chooseHikeDay(o1.memory, '2026-06-14', dayAt(15)) && !chooseHikeDay(o1.memory, '2026-07-06', dayAt(15)) && !chooseHikeDay(INITIAL_HIKE_MEMORY, '2026-06-17', dayAt(15)) && !chooseHikeDay(o1.memory, 'soon', dayAt(15)));
  const o4 = planHike({ ...o3.memory, forecast: week({ '2026-06-27': {} }) }, dayAt(18));
  check('HK9d once the chosen day has passed, next week\'s two days show', o4.plan?.nextWeek === true && o4.plan.day === '2026-06-27' && !o4.plan.chosen && o4.plan.options.length === 2, `${o4.plan?.day} ${o4.plan?.options}`);
  const offer = say(o1.plan, INITIAL_MESSAGE_MEMORY, at(10));
  const chose = say(o2.plan, offer.sp.memory, at(11));
  check('HK10 the tree names both days, then answers the choice', offer.x.message.text.includes('Saturday or Wednesday') && chose.b.dayLine === 'hike_chosen' && chose.sp.decision.reason.startsWith('the hike') && chose.x.message.text.includes('Wednesday'), `${offer.x.message.text} | ${chose.x.message.text}`);
  const pv = sampleHikePlan('announced', dayAt(15));
  const pvChosen = pv && sampleHikePlan('announced', dayAt(15), pv.options[1]);
  // The best hours of the hike day, from the hourly forecast
  const hour = (h: number, x: Partial<HourForecast> = {}): HourForecast => ({ hour: h, code: 1, sky: 'clear', temp: 12 + Math.max(0, 12 - Math.abs(h - 14)), rainChance: 5, rainMm: 0, gusts: 20, uv: 3, ...x });
  const hours = (f: (h: number) => Partial<HourForecast>) => Array.from({ length: 24 }, (_, h) => hour(h, f(h)));
  const showery = day('2026-06-20', { sunrise: '06:10', sunset: '19:50', hours: hours((h) => (h >= 15 ? { code: 80, sky: 'rain', rainChance: 70, rainMm: 1.2 } : {})) });
  const w1 = hikeWindow(showery);
  check('HK11 the best hours dodge the afternoon showers, and the tree warns about them', !!w1 && w1.to <= 15 && w1.rainFrom === 15 && hikeAdvice(w1).includes('Rain likely from 15:00') && hikeAdvice(w1).includes('Light until 19:50'), w1 ? hikeAdvice(w1) : 'none');
  const hot = hikeWindow(day('2026-06-20', { sunrise: '05:40', sunset: '20:10', hours: hours((h) => ({ temp: 16 + Math.max(0, 18 - 2 * Math.abs(h - 14)), uv: h >= 10 && h <= 16 ? 10 : 2 })) }));
  check('HK11b a hot sunny day: an early start, with heat and sun warnings', !!hot && hot.from <= 8 && hot.hotFrom !== null && hot.from >= 6 && hikeAdvice(hot).includes('gets hot'), hot ? hikeAdvice(hot) : 'none');
  const dark = hikeWindow(day('2026-06-20', { sunrise: '07:30', sunset: '16:30', hours: hours(() => ({})) }));
  check('HK11c the window stays within daylight', !!dark && dark.from >= 8 && dark.to <= 16, dark ? `${dark.from}-${dark.to}` : 'none');
  check('HK11d no hourly forecast: no detail (an older forecast still plans)', hikeWindow(day('x')) === null && o1.plan?.detail === null);
  const withHours = planHike({ ...INITIAL_HIKE_MEMORY, forecast: { fetchedAt: at(6), days: two.days.map((d) => (d.date === '2026-06-17' ? { ...d, sunrise: '06:10', sunset: '19:50', hours: showery.hours } : d)) } }, dayAt(15));
  const chosenDay = planHike(chooseHikeDay(withHours.memory, '2026-06-17', dayAt(15))!, dayAt(15)).plan!;
  const told = say(chosenDay, offer.sp.memory, at(11));
  check('HK12 the plan carries the best hours (not the 24 hours); the tree says them with the choice', !!chosenDay.detail && chosenDay.forecast.hours === undefined && told.x.message.text.includes('Best from'), told.x.message.text);
  check('HK10b previews offer two days and take a click', pv?.options.length === 2 && pvChosen?.chosen === true && pvChosen.day === pv.options[1], `${pv?.options} → ${pvChosen?.day}`);

  // YG. Yoga days: the week's two gloomiest days (for us and the tree), never the hike day; they follow the
  // forecast until their day, then lock. About the people: the tree's state never depends on them
  {
    const { planYoga, yogaGloom } = await import('../src/behaviour/yoga');
    const { evaluateLucy, lucyDay } = await import('../src/behaviour/lucy');
    const grim: Record<string, Partial<DayForecast>> = {
      '2026-06-17': { sky: 'thunderstorm', code: 95, rainChance: 90, rainMm: 12, gustsMax: 60 },
      '2026-06-19': { sky: 'heavy_rain', code: 65, rainChance: 80, rainMm: 8 },
      '2026-06-20': {}, // the hike's
    };
    const yMem = (o: Record<string, Partial<DayForecast>>): HikeMemory => planHike({ ...INITIAL_HIKE_MEMORY, forecast: week(o) }, dayAt(15)).memory;
    const y1 = planYoga(yMem(grim), FICUS, null, dayAt(15));
    check('YG1 the two gloomiest days of the week are picked', JSON.stringify(y1.plan?.days) === '["2026-06-17","2026-06-19"]' && !y1.plan!.today, `${y1.plan?.days}`);
    const hikeOn17 = chooseHikeDay(y1.memory, '2026-06-17', dayAt(15))!;
    const y2 = planYoga(planHike(hikeOn17, dayAt(15)).memory, FICUS, null, dayAt(15));
    check('YG2 never on the hike day: a hike chosen on a yoga day moves yoga', !!y2.plan && !y2.plan.days.includes('2026-06-17') && y2.plan.movedFrom === '2026-06-17', `${y2.plan?.days} (moved from ${y2.plan?.movedFrom})`);
    // The forecast changes: before its day a pick moves; on its day it holds
    const clearer = { ...grim, '2026-06-19': {}, '2026-06-18': { sky: 'heavy_rain' as const, code: 65, rainChance: 85, rainMm: 9 } };
    const before = planYoga({ ...y1.memory, forecast: week(clearer) }, FICUS, null, dayAt(16));
    const onDay = planYoga({ ...y1.memory, forecast: week({ ...grim, '2026-06-17': {} }) }, FICUS, null, dayAt(17));
    check('YG3 a pick follows the forecast until its day, then holds', JSON.stringify(before.plan?.days) === '["2026-06-17","2026-06-18"]' && onDay.plan!.days.includes('2026-06-17') && onDay.plan!.today, `moved → ${before.plan?.days} · on the day, cleared: ${onDay.plan?.days}`);
    // The tree's part: the same day for us, but hot for the greenhouse, or the day its soil is forecast thirsty
    const plainDays = { '2026-06-20': {} };
    const hot = planYoga(yMem({ ...plainDays, '2026-06-16': { tMax: 36, rainChance: 40, code: 3, sky: 'overcast' } }), FICUS, '2026-06-18', dayAt(15));
    const g16 = yogaGloom(week({ '2026-06-16': { tMax: 36, rainChance: 40, code: 3, sky: 'overcast' } }).days[1], FICUS, null);
    check('YG4 the tree counts: its hot day and its forecast thirsty day are the gloomiest', JSON.stringify(hot.plan?.days) === '["2026-06-16","2026-06-18"]' && g16.tree.heat > 0, `${hot.plan?.days} · 16th: ${JSON.stringify(g16)}`);
    check('YG5 no forecast: no yoga', planYoga(INITIAL_HIKE_MEMORY, FICUS, null, dayAt(15)).plan === null);
    // Mats and lines: only on its day, never with the boots; the tree's state identical with or without yoga
    const yp = (d: string[], today: boolean) => ({ week: '2026-06-15', days: d, today, nextWeek: false, movedFrom: null, week7: [] });
    const yogaB = evaluateBehaviour({ health: o.h, perception: o.p, episodes: [], events: [], species: FICUS, now: at(10), yoga: yp(['2026-06-15', '2026-06-19'], true) });
    const noYoga = evaluateBehaviour({ health: o.h, perception: o.p, episodes: [], events: [], species: FICUS, now: at(10) });
    const xy = expressBehaviour({ behaviour: yogaB, health: o.h, perception: o.p, now: at(10) });
    const xn = expressBehaviour({ behaviour: evaluateBehaviour({ health: o.h, perception: o.p, episodes: [], events: [], species: FICUS, now: at(10), yoga: yp(['2026-06-17', '2026-06-19'], false) }), health: o.h, perception: o.p, now: at(10) });
    const xh = expressBehaviour({ behaviour: evaluateBehaviour({ health: o.h, perception: o.p, episodes: [], events: [], species: FICUS, now: at(10), hike: plan({ day: '2026-06-15', today: true }), yoga: yp(['2026-06-15'], true) }), health: o.h, perception: o.p, now: at(10) });
    const same = (b: typeof yogaB) => JSON.stringify({ mood: b.moodState.valence, energy: b.energy, intent: b.messageIntent, condition: b.primaryState });
    check('YG6 the mats on its day only, never with the boots; the yoga-day line; the tree unchanged', xy.yoga?.mats === true && xn.yoga?.mats === false && xh.yoga?.mats === false && xh.hike?.boots === true && yogaB.dayLine === 'yoga_today' && same(yogaB) === same(noYoga), `${yogaB.dayLine}`);
    const ann = evaluateBehaviour({ health: o.h, perception: { ...o.p, sun: { ...o.p.sun, sunset: at(19) } }, episodes: [], events: [], species: FICUS, now: at(17, 30), yoga: yp(['2026-06-17', '2026-06-19'], false) });
    const annX = expressBehaviour({ behaviour: ann, health: o.h, perception: o.p, speech: decideSpeech({ behaviour: ann, severity: o.h.severity, memory: INITIAL_MESSAGE_MEMORY, now: at(17, 30) }).decision, now: at(17, 30) });
    check('YG7 announced in the evening with its weekdays', ann.dayLine === 'yoga_picked' && annX.message.text.includes('Wednesday and Friday'), annX.message.text);
    // Lucy: on yoga days she sometimes lies on the open mat; never on other days
    const rests = (yoga: boolean) =>
      Array.from({ length: 20 }, (_, k) => dayAt(1 + k)).flatMap((t) =>
        lucyDay(t).visits.filter((v) => v.kind === 'day').map((v) => evaluateLucy({ outsideToday: [], rainEndedAt: null, condition: 'comfortable', modifiers: [], hike: null, yogaToday: yoga, weatherComing: null, now: v.startedAt + 10 * 60000 }).visit?.rest)
      );
    const onMat = rests(true).filter((r) => r === 'floor_right').length;
    const all = rests(true).length;
    check('YG8 Lucy lies on the open mat on some yoga-day visits, never otherwise', onMat > all * 0.15 && onMat < all * 0.6 && !rests(false).includes('floor_right'), `${onMat}/${all} visits on the mat`);
  }
}

// CY. The wet-to-dry cycle (the owner's watering guidance, raw 4000 dry → 500 wet): water at raw 3200–3400;
// the window is calm, thirst starts past it; the mood follows where the soil is in its cycle
{
  const { soilPercent, soilRaw } = await import('../src/species/ficus');
  const { explainTree } = await import('../src/explain/why');
  const s = FICUS.soilMoisture;
  check('CY1 the thresholds are the raw anchors on the 4000/500 scale (3400 thirsty, 3200 ready, 3700 very dry, 1500 saturated)',
    soilPercent(4000) === 0 && soilPercent(500) === 100 && s.minOptimal === soilPercent(3400) && FICUS.soilCycle.readyBelow === soilPercent(3200) && s.minCritical === soilPercent(3700) && s.maxOptimal === soilPercent(1500) && FICUS.latches.thirsty.enter === soilPercent(3400) && soilRaw(soilPercent(2800)) === 2810,
    `thirsty < ${s.minOptimal} %, ready < ${FICUS.soilCycle.readyBelow} %, very dry < ${s.minCritical} %, saturated ≤ ${s.maxOptimal} %; raw 2800 ≈ ${soilPercent(2800)} %`);
  const w = new Sim();
  w.run(at(9), 60, () => ({ soil: 60 }));
  const ready = w.run(at(10), 90, () => ({ soil: 20 }));
  const soilMetric = ready.h.metrics.find((m) => m.id === 'soil')!;
  check('CY2 the watering window (raw ~3300): calm, not thirsty; patient, "ready for water", no concern',
    ['comfortable', 'thriving'].includes(ready.h.condition) && ready.b.soilCycle === 'ready' && ready.b.messageIntent === 'ready_for_water' && !ready.b.concern && soilMetric.status === 'Ready for water' && /drink|water/.test(ready.x.message.text),
    `${show(ready)} · ${ready.b.mood} · ${soilMetric.status} · "${ready.x.message.text}"`);
  const past = w.run(at(11, 30), 60, () => ({ soil: 14 }));
  check('CY3 past the window (raw ~3510) for half an hour: thirsty', past.h.condition === 'thirsty', show(past));
  // The mood follows the cycle: a fresh drink warms, drying settles, the window is a quiet expectancy
  const nudge = (o: ReturnType<Sim['run']>) => o.b.moodState.influences.find((x) => x.source === 'soil');
  const fresh = new Sim();
  fresh.run(at(9), 60, () => ({ soil: 60 }));
  const dryingO = fresh.run(at(10), 30, () => ({ soil: 50 }));
  const fd = nudge(dryingO);
  const rd = nudge(ready);
  check('CY4 the mood follows the cycle: drying as it should (a little warmer), ready (livelier, waiting)', !!fd && fd.v > 0 && /drying as it should/.test(fd.why) && !!rd && rd.a > 0 && /ready/.test(rd.why), `drying: ${fd?.why} (${fd?.v}) · ready: ${rd?.why} (a ${rd?.a})`);
  const cards = explainTree({ perception: ready.p, health: ready.h, behaviour: ready.b, expression: ready.x, species: FICUS, now: at(11, 30) });
  const now = cards.find((c) => c.id === 'now')!;
  check('CY5 the Why speaks the cycle in raw values (the window raw 3200–3400)', now.title === 'Ready for water' && /raw 3200–3400/.test(now.body) && /raw about 3300/.test(now.body), `${now.title}: ${now.body}`);
}

// WH. "Why": the narrator explains every state in plain words from the engines' own conclusions
{
  const { explainTree } = await import('../src/explain/why');
  const why = (o: { h: PlantHealthState; p: ReturnType<Sim['run']>['p']; b: ReturnType<Sim['run']>['b']; x: ReturnType<Sim['run']>['x'] }, now: number) =>
    explainTree({ perception: o.p, health: o.h, behaviour: o.b, expression: o.x, species: FICUS, now });
  const clean = (cards: ReturnType<typeof why>) => cards.every((c) => !/undefined|NaN|\bnull\b|\w_\w/.test(`${c.title} ${c.body}`) && c.title.length > 0 && c.body.length > 10);
  const s = new Sim();
  const calm = s.run(at(9), 30, () => ({ soil: 60 }));
  const all = DEV_PRESETS.map((p) => {
    const h = applyDeveloperOverride(calm.h, p, FICUS);
    const b = evaluateBehaviour({ health: h, perception: calm.p, episodes: [], events: [], species: FICUS, now: at(10) });
    const x = expressBehaviour({ behaviour: b, health: h, perception: calm.p, now: at(10) });
    return { id: p.id, cards: why({ h, p: calm.p, b, x }, at(10)) };
  });
  const bad = all.filter((r) => !r.cards.some((c) => c.id === 'now') || !clean(r.cards));
  check('WH1 every preset is explained: a "now" card, and no undefined, NaN, null or code identifiers in the words', bad.length === 0, bad.map((r) => `${r.id}: ${r.cards.map((c) => `${c.title} / ${c.body}`).join(' | ')}`).join(' ‖ ') || `${all.length} presets`);
  const dry = new Sim();
  dry.run(at(9), 60, () => ({ soil: 60 }));
  const thirsty = dry.run(at(10), 60, () => ({ soil: 14 }));
  const now1 = why(thirsty, at(11)).find((c) => c.id === 'now')!;
  check('WH2 thirsty: names the soil now and the species thresholds (17 to enter, 20 to let go)', thirsty.h.condition === 'thirsty' && /14 %/.test(now1.body) && /17 %/.test(now1.body) && /20 %/.test(now1.body), `${now1.title}: ${now1.body}`);
  const pend = new Sim();
  pend.run(at(9), 60, () => ({ soil: 60 }));
  const crossing = pend.run(at(10), 10, () => ({ soil: 16 }));
  const watching = why(crossing, at(10, 10)).find((c) => c.id === 'watching');
  check('WH3 a threshold crossed but not for long enough: what it is watching, and how long until it counts', crossing.h.condition === 'comfortable' && !!watching && /thirsty/.test(watching.body) && /more/.test(watching.body), watching?.body ?? 'none');
  const out = new Sim();
  out.run(at(9), 60, () => ({ soil: 60 }));
  const stale = out.run(at(10), 40, () => null);
  const staleCards = why(stale, at(10, 40));
  check('WH4 no trustworthy data: "how sure" comes first and says it is held, not guessed', staleCards[0].id === 'trust' && /held, not guessed|can't trust/.test(staleCards.map((c) => c.body).join(' ')), staleCards[0].body);
  const sleepH = applyDeveloperOverride(calm.h, DEV_PRESETS.find((p) => p.id === 'sleeping')!, FICUS);
  const sleepB = evaluateBehaviour({ health: sleepH, perception: calm.p, episodes: [], events: [], species: FICUS, now: at(10) });
  const dreamB = {
    ...sleepB,
    dream: {
      night: { key: 'n', startsAt: at(9), endsAt: at(12) }, asleep: true, phase: 'dreaming' as const, motif: 'rain' as const, with: 'squirrel' as const, phaseEndsAt: at(10, 20), restless: false, cast: [],
      tonight: { night: 'n', startsAt: at(9), endsAt: at(12), composedAt: at(9), motifs: [{ motif: 'rain' as const, salience: 0.85, source: 'care' as const, role: 'day' as const, why: 'after the long thirst' }], phases: [], cast: [], outcome: null },
      lastNight: null, recurring: [], compose: null, finish: null, why: '',
    },
  };
  const night = why({ h: sleepH, p: calm.p, b: dreamB, x: expressBehaviour({ behaviour: dreamB, health: sleepH, perception: calm.p, now: at(10) }) }, at(10)).find((c) => c.id === 'night');
  check('WH5 a night with a dream: what it dreams of, and what tonight is made of', !!night && /the squirrel in the rain/.test(night.body) && /after the long thirst/.test(night.body), night?.body ?? 'none');
  const calmCards = why(calm, at(10));
  check('WH6 a calm day: comfortable, its vitality, its mood, how sure; every card has its figures', calmCards[0].id === 'now' && ['vitality', 'mood', 'trust'].every((id) => calmCards.some((c) => c.id === id)) && calmCards.every((c) => c.details.length > 0) && clean(calmCards), calmCards.map((c) => c.title).join(' · '));
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exitCode = fails ? 1 : 0;

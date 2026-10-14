// Scenario checks for the living engines (npm run test:scenarios). Pure: no server, no database.
// Simulates minute-by-minute readings and checks health, hysteresis, behaviour and expression.
import { evaluateBehaviour } from '../src/behaviour/BehaviourEngine';
import { expressBehaviour } from '../src/expression/ExpressionEngine';
import { applyDeveloperOverride, DEV_PRESETS } from '../src/health/developerOverrides';
import { evaluatePlantHealth, HealthMemory, initialHealthMemory } from '../src/health/HealthEngine';
import type { PlantHealthState } from '../src/health/healthTypes';
import type { BehaviourEpisode, PlantEvent } from '../src/history/historyTypes';
import { perceive, toSample } from '../src/perception/PerceptionEngine';
import type { PerceptionSample } from '../src/perception/perceptionTypes';
import { FICUS } from '../src/species/ficus';
import { calculateVPD } from '../src/telemetry/telemetryNormalizer';
import type { PlantTelemetry } from '../src/telemetry/types';

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
  step(now: number, r: R | null) {
    if (r) {
      this.prev = this.latest;
      this.latest = tel(now, r);
    }
    const p = perceive({ latest: this.latest, previous: this.prev, recent: this.recent, events: this.events.filter((e) => e.timestamp <= now), location: LOC, pollMs: MIN, deviceError: r ? null : 'ETIMEDOUT', species: FICUS, now });
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
  const one = s.step(at(10), { soil: 15 });
  check('A1 one dry reading is not critical', !['very_dry', 'thirsty'].includes(one.h.condition), show(one));
  const thirty = s.run(at(10, 1), 31, () => ({ soil: 15 }));
  check('A2 thirsty after ~30 min', thirty.h.condition === 'thirsty', show(thirty));
  const twoh = s.run(at(10, 32), 100, () => ({ soil: 15 }));
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

// D. Low daytime light for a sustained period → too_dark
{
  const s = new Sim();
  const early = s.run(at(10), 60, () => ({ soil: 60, light: 15 }));
  check('D1 1h dim daylight: not too dark yet', early.h.condition !== 'too_dark', show(early));
  const late = s.run(at(11), 4 * 60, () => ({ soil: 60, light: 15 }));
  check('D2 4h+ dim daylight → too_dark', late.h.condition === 'too_dark', show(late));
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
  const hd = both.run(at(10), 3 * 60, () => ({ soil: 28, temp: 35 }));
  check('F1 sustained heat + dry soil → hot_and_dry', hd.h.condition === 'hot_and_dry', show(hd));
  check('F2 stronger than heat alone', hd.h.vitality < hotOnly.h.vitality - 5, `hot only ${show(hotOnly)} vs ${show(hd)}`);
  check('F3 stronger expression', hd.b.expressionIntensity > hotOnly.b.expressionIntensity, `${hotOnly.b.expressionIntensity} vs ${hd.b.expressionIntensity}`);
}

// G. Watering while thirsty → relief
{
  const s = new Sim();
  s.run(at(9), 90, () => ({ soil: 28 }));
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

// Hysteresis: hovering around the threshold must not flap
{
  const s = new Sim();
  s.run(at(9), 60, () => ({ soil: 60 }));
  s.transitions = 0;
  const o = s.run(at(10), 6 * 60, (i) => ({ soil: i % 2 ? 34.9 : 35.1 }));
  check('K hovering 34.9/35.1 for 6h: ≤1 transition', s.transitions <= 1, `${s.transitions} transitions, ends ${show(o)}`);
  s.transitions = 0;
  const o2 = s.run(at(16), 60, (i) => ({ soil: i % 2 ? 36 : 39 }));
  check('K2 between enter (35) and exit (40): stays thirsty', o2.h.condition === 'thirsty' && s.transitions === 0, show(o2));
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exitCode = fails ? 1 : 0;

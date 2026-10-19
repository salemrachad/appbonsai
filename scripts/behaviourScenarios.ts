// Behaviour + speech scenarios (npm run test:behaviour): mood, energy, duration, recovery,
// silence, cooldowns, once-per-episode lines, time of day, restarts. Runs the real collector
// (so speech memory is persisted exactly as in production) on the shared bench.
import './tz'; // first: the tree's timezone (the build machines run in UTC)
import { evaluateBehaviour } from '../src/behaviour/BehaviourEngine';
import { DAY_LINES, MESSAGE_CATALOG } from '../src/behaviour/messages';
import { stableVariant } from '../src/behaviour/speech';
import { Bench, check, cond, finish, HOUR, Reading } from './bench';

const MIN = 60 * 1000;
const at = (d: number, h: number, m = 0) => new Date(2026, 5, d, h, m).getTime(); // June: sunrise ≈ 05:30, sunset ≈ 19:50

// Every new line the tree says (a speech = spokenAt moved forward), plus how often it was visibly talking.
class Listener {
  spoken: { t: number; key: string; text: string; reason: string }[] = [];
  polls = 0;
  visiblePolls = 0;
  private last: number | null = null;
  constructor(private b: Bench) {}
  async run(minutes: number, r: (i: number) => Reading | null) {
    for (let i = 0; i < minutes; i++) {
      await this.b.poll(r(i));
      this.observe();
    }
    return this.b.state();
  }
  observe() {
    const m = this.b.state().expression.message;
    this.polls++;
    if (m.visible) this.visiblePolls++;
    if (m.spokenAt !== null && m.spokenAt !== this.last) {
      this.spoken.push({ t: m.spokenAt, key: m.key, text: m.text, reason: m.reason });
      this.last = m.spokenAt;
    }
  }
  reset() {
    this.spoken = [];
    this.polls = 0;
    this.visiblePolls = 0;
  }
  keys() {
    return this.spoken.map((s) => s.key).join(' → ');
  }
}

const day = (light = 50): Reading => ({ soil: 60, light });

async function main() {
  console.log('— Talking and silence —');

  // 1. Comfortable for hours → little talking
  {
    const b = new Bench();
    await b.boot();
    const l = new Listener(b);
    await l.run(4 * 60, () => day());
    const ownLines = l.spoken.filter((x) => !x.reason.startsWith('a thought'));
    check('S1 comfortable 4h: at most 2 lines besides the thoughts of the day', ownLines.length <= 2, l.keys());
    // Since 2026-10-18 the tree shares about twice the thoughts (each on screen 15 min, at least 40 min apart):
    // still quiet most of the time
    check('S1b mostly silent (animation only)', l.visiblePolls / l.polls < 0.35, `${Math.round((100 * l.visiblePolls) / l.polls)}% of polls showed a line`);
  }

  // 2 + 3. Becoming thirsty, then staying thirsty for hours
  {
    const b = new Bench();
    await b.boot();
    const l = new Listener(b);
    await l.run(60, () => day());
    l.reset();
    await l.run(40, () => ({ soil: 30 }));
    const thirstLines = l.spoken.filter((s) => s.key.startsWith('thirst'));
    check('S2 becoming thirsty: one mild line', thirstLines.length === 1 && thirstLines[0].key === 'thirst:mild', l.keys());
    const early = b.state();
    l.reset();
    await l.run(5 * 60, () => ({ soil: 30 }));
    const late = b.state();
    check('S3 thirsty 5h: escalates mild → moderate → strong', l.keys().includes('thirst:moderate') && l.keys().includes('thirst:strong'), l.keys());
    check('S3b not repeated every poll (≤ 3 lines in 5h)', l.spoken.length <= 3, `${l.spoken.length} lines in ${l.polls} polls`);
    check(
      'S3c stronger behaviour: more droop, less movement',
      late.expression.leafDroop > early.expression.leafDroop && late.expression.motion.swayAmount < early.expression.motion.swayAmount,
      `droop ${early.expression.leafDroop} → ${late.expression.leafDroop}, sway ${early.expression.motion.swayAmount} → ${late.expression.motion.swayAmount}, mood ${early.behaviour.mood} → ${late.behaviour.mood}`
    );
    check('S3d a fresh thirst shows no water badge; a long one does', !early.expression.avatar.effects.includes('water_badge') && late.expression.avatar.effects.includes('water_badge'));

    // 4. Watering while thirsty → relief
    l.reset();
    await l.run(3, () => ({ soil: 72 }));
    check('S4 watering while thirsty: relief, spoken right away', l.spoken[0]?.key === 'watering_relief' && b.state().behaviour.mood === 'relieved', l.spoken[0]?.text);

    // 5. Recovering → gradual change
    const samples: { key: string; energy: number; droop: number; condition: string }[] = [];
    for (let i = 0; i < 7 * 60; i++) {
      await b.poll({ soil: 70 });
      l.observe();
      const s = b.state();
      samples.push({ key: s.expression.message.key, energy: s.behaviour.energy, droop: s.expression.leafDroop, condition: s.health.condition });
    }
    // The first minutes of relief are expressed by the watering reaction itself
    const stages = [...new Set(samples.map((s) => (s.key === 'watering_relief' ? 'recovery:relief' : s.key)))].filter((k) => k.startsWith('recovery'));
    check('S5 recovery progresses relief → perking → settling', stages.join(',') === 'recovery:relief,recovery:perking,recovery:settling', stages.join(' → '));
    const rec = samples.filter((s, i) => s.key.startsWith('recovery') && i % 20 === 0);
    check('S5b energy rises and droop eases gradually', rec[rec.length - 1].energy > rec[0].energy && rec[rec.length - 1].droop < rec[0].droop, rec.map((s) => `${s.energy}/${s.droop}`).join(' '));
    const order = [...new Set(samples.map((s) => s.condition))];
    check('S5c after recovery: comfortable first, thriving only later', order.indexOf('comfortable') !== -1 && (order.indexOf('thriving') === -1 || order.indexOf('comfortable') < order.indexOf('thriving')), order.join(' → '));

    // 6. Water again while already wet → concern
    l.reset();
    await l.run(18, (i) => ({ soil: 71 + i })); // soil drifts up slowly (no watering rise) to 88
    await l.run(10, () => ({ soil: 88 }));
    b.collector.logEvent('watering', null, b.clock);
    await l.run(2, () => ({ soil: 88 }));
    check('S6 watering again on wet soil: concern, not celebration', b.state().behaviour.messageIntent === 'watering_enough' && b.state().behaviour.mood === 'concerned', b.state().expression.message.text);
  }

  console.log('\n— Night and morning —');

  // 7 + 8. Sleeping all night → mostly silent; calm night → calm morning line
  {
    const b = new Bench();
    b.clock = at(15, 19, 0);
    await b.boot();
    const l = new Listener(b);
    await l.run(50, () => day(30));
    l.reset();
    await l.run(9 * 60, () => ({ soil: 60, light: 0 })); // 19:50 → 04:50
    check('S7 sleeping all night: at most 2 lines', l.spoken.length <= 2, l.keys());
    check('S7b mostly silent', l.visiblePolls / l.polls < 0.1, `${Math.round((100 * l.visiblePolls) / l.polls)}% of polls`);
    check('S7c almost still while asleep', b.state().expression.motion.swayAmount <= 0.25 && b.state().expression.motion.blinkEveryMs === null);
    l.reset();
    await l.run(120, (i) => ({ soil: 60, light: Math.min(50, i) })); // sunrise
    const morning = l.spoken.find((s) => DAY_LINES.morning_calm.some((d) => s.text.startsWith(d)));
    check('S8 morning after a calm night: a calm morning line', !!morning, l.spoken.map((s) => s.text).join(' | '));
  }

  // A humid night: ≥ 88 % for hours → a dewy morning line (once); 86 % is an ordinary night
  for (const [hum, dewy] of [[92, true], [86, false]] as const) {
    const b = new Bench();
    b.clock = at(15, 19, 0);
    await b.boot();
    const l = new Listener(b);
    await l.run(50, () => day(30));
    await l.run(9 * 60, () => ({ soil: 60, light: 0, hum }));
    l.reset();
    await l.run(120, (i) => ({ soil: 60, light: Math.min(50, i), hum: 60 }));
    const said = (lines: readonly string[]) => l.spoken.filter((s) => lines.some((d) => s.text.startsWith(d))).length;
    if (dewy) check('S8d after a dewy night (92 %): a dewy morning line, once', said(DAY_LINES.morning_dewy) === 1 && said(DAY_LINES.morning_calm) === 0, l.spoken.map((s) => s.text).join(' | '));
    else check('S8e after an 86 % night: the ordinary calm morning', said(DAY_LINES.morning_calm) === 1 && said(DAY_LINES.morning_dewy) === 0, l.spoken.map((s) => s.text).join(' | '));
  }

  // 9. Morning after a stressful night
  {
    const b = new Bench();
    b.clock = at(16, 18, 0);
    await b.boot();
    const l = new Listener(b);
    await l.run(150, (i) => ({ soil: 30, light: i < 100 ? 30 : 0 })); // thirsty into the evening
    b.collector.logEvent('watering', 'late watering', b.clock);
    await l.run(9 * 60, () => ({ soil: 70, light: 0 }));
    l.reset();
    await l.run(150, (i) => ({ soil: 70, light: Math.min(50, i) }));
    const line = l.spoken.find((s) => DAY_LINES.morning_after_stress.some((d) => s.text.startsWith(d)));
    check('S9 morning after a stressful night: different wording', !!line, l.spoken.map((s) => s.text).join(' | '));
  }

  console.log('\n— Memory: refresh, restart, variants, wording —');

  // 10 + 11. Once-per-episode lines; browser refresh; server restart
  {
    const b = new Bench();
    await b.boot();
    const l = new Listener(b);
    await l.run(40, () => day());
    b.collector.logEvent('watering', null, b.clock);
    await l.run(40, () => ({ soil: 85 })); // the sensor confirms it (merged into the logged watering)
    b.collector.logEvent('watering', 'a second watering', b.clock); // already wet: a second watering today
    await l.run(30, () => ({ soil: 86 }));
    const withObs = l.spoken.filter((s) => /a lot of water/i.test(s.text));
    check('S10 "lots of water today" said once', withObs.length === 1, l.spoken.map((s) => s.text).join(' | '));
    const snap1 = JSON.stringify(b.collector.snapshot().expression?.message);
    const snap2 = JSON.stringify(b.collector.snapshot().expression?.message);
    check('S10b browser refresh: same message, nothing replayed', snap1 === snap2);
    const before = b.state().expression.message;
    b.collector.stop();
    b.clock += 2 * MIN;
    await b.boot();
    await b.poll({ soil: 86 });
    l.observe();
    const afterRestart = b.state().expression.message;
    check('S11 server restart: no new line, same thought kept', afterRestart.spokenAt === before.spokenAt && afterRestart.key === before.key && afterRestart.variant === before.variant, `${before.key}#${before.variant} → ${afterRestart.key}#${afterRestart.variant}`);
    await l.run(120, () => ({ soil: 86 }));
    check('S11b once-per-episode line not repeated after restart', l.spoken.filter((s) => /a lot of water/i.test(s.text)).length === 1);
  }

  // 12. Same condition, different episodes → variants differ
  {
    const variants = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((e) => stableVariant(`e${e}|thirst:mild`, MESSAGE_CATALOG['thirst:mild'].length)));
    check('S12 same condition in different episodes uses different variants', variants.size >= 2, `${variants.size} distinct over 8 episodes`);
    check('S12b same episode always the same variant', stableVariant('e5|thirst:mild', 3) === stableVariant('e5|thirst:mild', 3));
  }

  // 13. Rewording never changes behaviour
  {
    const b = new Bench();
    await b.boot();
    await b.run(100, () => ({ soil: 30 }));
    const s = b.state();
    const input = { health: s.health, perception: s.perception, episodes: b.db.episodesSince(0), events: [], species: (await import('../src/species')).ACTIVE_SPECIES, now: b.clock };
    const before = evaluateBehaviour(input);
    const saved = { ...MESSAGE_CATALOG };
    const savedDay = { ...DAY_LINES };
    for (const k of Object.keys(MESSAGE_CATALOG)) MESSAGE_CATALOG[k] = ['(reworded)'];
    for (const k of Object.keys(DAY_LINES) as (keyof typeof DAY_LINES)[]) DAY_LINES[k] = ['(reworded)'];
    const after = evaluateBehaviour(input);
    Object.assign(MESSAGE_CATALOG, saved);
    Object.assign(DAY_LINES, savedDay);
    const strip = (x: typeof before) => JSON.stringify({ ...x, reasons: [] });
    check('S13 changing all wording leaves behaviour identical', strip(before) === strip(after), `${before.messageIntent}/${before.intensityTier}/${before.mood}`);
  }

  console.log('\n— Same condition, different history —');
  {
    // Comfortable on a calm day vs comfortable right after a hard stress
    const calm = new Bench();
    await calm.boot();
    await calm.run(6 * 60, () => day());
    const hard = new Bench();
    await hard.boot();
    await hard.run(200, () => ({ soil: 15 })); // very dry
    await hard.run(7 * 60, () => ({ soil: 70 })); // recover
    const a = calm.state();
    const z = hard.state();
    check(
      'D1 "comfortable" after a hard drought still feels like recovery (afterglow)',
      a.health.condition === z.health.condition && z.behaviour.afterglow && !a.behaviour.afterglow && z.behaviour.energy < a.behaviour.energy,
      `calm: ${a.behaviour.mood}, energy ${a.behaviour.energy}, "${a.expression.message.text}" | after drought: ${z.behaviour.mood}, energy ${z.behaviour.energy}, "${z.expression.message.text}"`
    );
  }

  console.log('\n— Petting is attention, never biology —');
  {
    // Two identical trees; one is petted every few minutes through comfort, thirst and a watering
    const plain = new Bench();
    const petted = new Bench();
    await plain.boot();
    await petted.boot();
    const script = (i: number): Reading => (i < 60 ? day() : i < 240 ? { soil: 30 } : { soil: 65 });
    for (let i = 0; i < 300; i++) {
      await plain.poll(script(i));
      if (i % 7 === 0) petted.collector.recordInteraction({ kind: 'pet', startedAt: petted.clock - 40_000, endedAt: petted.clock, count: 4, activeMs: 30_000 });
      await petted.poll(script(i));
    }
    const a = plain.state();
    const z = petted.state();
    // Petting may warm the mood (its own layer, bounded by health) and what the mood draws: the face, the tap
    // label, the body description. Everything else is identical.
    const bio = (s: typeof a) =>
      JSON.stringify({
        health: s.health,
        behaviour: { ...s.behaviour, relationship: { ...s.behaviour.relationship, attention: null }, mood: null, moodState: null, reasons: null },
        expression: { ...s.expression, touch: null, avatar: null, tapLabel: null, layers: null }, // the touch answer may warm with familiarity (checked below)
      });
    check('P1 petting changes nothing biological (health, behaviour, expression identical; only the mood may warm)', bio(a) === bio(z), `${a.health.condition} v${a.health.vitality} vs ${z.health.condition} v${z.health.vitality}`);
    check(
      'P1m petting only warms the mood, inside the band health allows',
      z.behaviour.moodState.valence >= a.behaviour.moodState.valence && z.behaviour.moodState.target.valence <= z.behaviour.moodState.ceiling && z.behaviour.moodState.influences.some((x) => x.source === 'petting'),
      `valence ${a.behaviour.moodState.valence} → ${z.behaviour.moodState.valence} (ceiling ${z.behaviour.moodState.ceiling}) · ${a.behaviour.mood} / ${z.behaviour.mood}`
    );
    check('P1b the touch keeps its character; only familiarity warms it', a.expression.touch.kind === z.expression.touch.kind, `${a.expression.touch.kind} vs ${z.expression.touch.kind}, familiarity ${z.expression.touch.familiarity}`);
    check(
      'P2 attention is remembered, separately from care',
      z.behaviour.relationship.attention.petSessions7d > 0 && a.behaviour.relationship.attention.petSessions7d === 0 && z.behaviour.relationship.lastCareAt === a.behaviour.relationship.lastCareAt,
      `petted: ${z.behaviour.relationship.attention.petSessions7d} sessions; last care ${z.behaviour.relationship.lastCareAt}`
    );
  }
  {
    // The answer depends on the state and never looks healthier than it is
    const b = new Bench();
    await b.boot();
    await b.run(60, () => day());
    const calm = b.state().expression.touch;
    await b.run(60, () => ({ soil: 30 }));
    const thirsty = b.state();
    await b.run(5, () => null);
    const unsure = b.state();
    check('P3 calm tree leans into the hand', calm.kind === 'lean_in' && calm.lean > 0, `${calm.kind}`);
    check(
      'P4 thirsty tree: dry, stiff answer, no lean',
      thirsty.health.condition === 'thirsty' && thirsty.expression.touch.kind === 'dry_rustle' && thirsty.expression.touch.lean === 0 && thirsty.expression.touch.give < calm.give,
      `${thirsty.expression.touch.kind} give ${thirsty.expression.touch.give}`
    );
    check(
      'P5 no trustworthy data: muted answer even while the state is held',
      [unsure.health.condition, ...unsure.health.modifiers].includes('sensor_uncertain') && unsure.expression.touch.kind === 'muted' && unsure.expression.touch.blink === 'none',
      `${unsure.health.condition} + [${unsure.health.modifiers.join(', ')}] → ${unsure.expression.touch.kind}`
    );
    const n = new Bench();
    n.clock = at(15, 19, 0);
    await n.boot();
    await n.run(50, () => day(30));
    await n.run(120, () => ({ soil: 60, light: 0 }));
    const night = n.state();
    check('P6 sleeping tree only stirs; eyes stay closed', night.health.condition === 'sleeping' && night.expression.touch.kind === 'slow_stir' && night.expression.touch.blink === 'none', `${night.health.condition} → ${night.expression.touch.kind}`);
  }

  console.log('\n— Familiarity and habituation —');
  {
    const { computeRelationship } = await import('../src/behaviour/relationship');
    const { ACTIVE_SPECIES } = await import('../src/species');
    const now = at(20, 12);
    const DAYMS = 24 * 60 * MIN;
    const pet = (t: number, id = 0) => ({ id, kind: 'pet' as const, startedAt: t, endedAt: t + 30_000, count: 3, metadata: {} });
    const fam = (pets: ReturnType<typeof pet>[], t = now) =>
      computeRelationship({ episodes: [], events: [], interactions: pets, current: { condition: 'comfortable', startedAt: t - 3600_000 }, soilMoisture: 60, species: ACTIVE_SPECIES, now: t }).attention.familiarity;
    const once = fam([pet(now - 60 * MIN)]);
    const fifty = fam(Array.from({ length: 50 }, (_, i) => pet(now - 120 * MIN + i * MIN, i)));
    check('F1 fifty sessions in a day count the same as one', once === fifty && once > 0, `once ${once}, fifty ${fifty}`);
    const daily = Array.from({ length: 14 }, (_, d) => pet(now - d * DAYMS, d));
    const twoWeeks = fam(daily);
    check('F2 two weeks of daily visits: familiar, never above 1', twoWeeks >= 0.8 && twoWeeks <= 1, `${twoWeeks}`);
    const later = (days: number) => fam(daily, now + days * DAYMS);
    check('F3 absence fades slowly, back to exactly neutral, never below', later(7) < twoWeeks && later(7) > 0.3 && later(21) < 0.2 && later(45) === 0, `+7d ${later(7)}, +21d ${later(21)}, +45d ${later(45)}`);
    check('F3b none at all is neutral', fam([]) === 0);

    // Full familiarity warms calm answers only: thirsty, asleep and unsure answer exactly as before
    const make = async (familiar: boolean) => {
      const b = new Bench();
      if (familiar) for (let d = 0; d < 14; d++) b.db.recordInteraction({ kind: 'pet', startedAt: b.clock - d * DAYMS - 60_000, endedAt: b.clock - d * DAYMS - 30_000, count: 3, activeMs: 20_000 }, 0);
      await b.boot();
      return b;
    };
    const plain = await make(false);
    const known = await make(true);
    const both = async (minutes: number, r: (i: number) => Reading | null) => {
      await plain.run(minutes, r);
      await known.run(minutes, r);
      return [plain.state().expression.touch, known.state().expression.touch] as const;
    };
    const [c0, c1] = await both(60, () => day());
    check(
      'F4 a familiar hand: calm tree follows a little further and softer, same character',
      c1.familiarity >= 0.8 && c0.familiarity === 0 && c1.kind === c0.kind && c1.give > c0.give && c1.give <= Math.min(1, c0.give * 1.25 + 0.01) && c1.stiffness < c0.stiffness,
      `give ${c0.give} → ${c1.give}, stiffness ${c0.stiffness} → ${c1.stiffness}`
    );
    const [t0, t1] = await both(60, () => ({ soil: 30 }));
    check('F5 thirsty: identical answer at full familiarity', JSON.stringify(t0) === JSON.stringify(t1) && t1.kind === 'dry_rustle', `${t1.kind} f${t1.familiarity}`);
    const [u0, u1] = await both(5, () => null);
    check('F6 no trustworthy data: identical muted answer at full familiarity', JSON.stringify(u0) === JSON.stringify(u1) && u1.kind === 'muted');
  }
  {
    const { habituate } = await import('../src/expression/touch');
    const b = new Bench();
    await b.boot();
    await b.run(30, () => day());
    const h = b.state().expression.touch.habituation;
    let level = 1;
    const trace: number[] = [];
    for (let s = 0; s < 120; s++) {
      const next = habituate(level, h, 1000, true);
      if (next > level + 1e-9) trace.push(-1);
      level = next;
      if (s % 30 === 29) trace.push(Math.round(level * 100) / 100);
    }
    check('H1 continuous stroking settles gradually, never below the floor', !trace.includes(-1) && level < 0.7 && level >= h.floor, `levels ${trace.join(' → ')} (floor ${h.floor})`);
    const afterRest = habituate(level, h, 3 * h.recoverMs, false);
    check('H2 a rest recovers the fresh answer', afterRest > 0.9, `${Math.round(level * 100) / 100} → ${Math.round(afterRest * 100) / 100}`);
    const muted = { settlePerSec: 0, floor: 1, recoverMs: 60_000 };
    check('H3 a muted answer has nothing to settle', habituate(1, muted, 60_000, true) === 1);
  }

  console.log('\n— Outside weather —');
  {
    const { OUTSIDE_SKIES, skyFromCode } = await import('../src/telemetry/outsideWeather');
    const { weatherLook } = await import('../src/expression/ExpressionEngine');
    // Same readings, wildly different weather: the tree must be identical (health, behaviour minus lines)
    const make = async (code: number | null, temp = 15) => {
      const b = new Bench();
      b.weather = code === null ? null : { code, temp, gusts: 60 };
      await b.boot();
      await b.run(240, (i) => (i < 120 ? day() : { soil: 30 }));
      await b.collector.pollWeather(); // the bench has no weather timer: refresh it (it goes stale after an hour)
      return b.state();
    };
    const dry = await make(null);
    const storm = await make(95, -3);
    // (the light guide may explain a grey sky in words: that's the point, not a change to the tree)
    const strip = (s: typeof dry) => JSON.stringify({ health: { ...s.health, metrics: s.health.metrics.map(({ guide, ...m }) => m) }, mood: s.behaviour.mood, energy: s.behaviour.energy, intent: s.behaviour.messageIntent, habitat: { ...s.behaviour.habitat, dragonfly: undefined, sloth: undefined, lucy: undefined }, avatar: s.expression.avatar, droop: s.expression.leafDroop, scene: s.expression.atmosphere.scene });
    check('O1 outside weather never changes the tree beyond explaining light (health, mood, look, scene, the squirrel; the air wanderers and Lucy read it by design)', strip(dry) === strip(storm), `${dry.health.condition} vs ${storm.health.condition}`);
    check('O2 the weather layer carries it instead', dry.expression.atmosphere.weather === null && storm.expression.atmosphere.weather?.sky === 'thunderstorm' && storm.expression.atmosphere.weather.windy);
    const looks = OUTSIDE_SKIES.map((sky) => weatherLook({ at: 0, ageMs: 0, sky, code: 0, temperature: 10, humidity: null, precipitation: null, cloudCover: null, wind: null, gusts: null, isDay: true, windy: false, rainEndedAt: null }));
    check('O3 every sky has a look and a label', looks.every((l) => l && l.label.length > 0 && l.intensity >= 0 && l.intensity <= 1), looks.map((l) => l?.label).join(' | '));
    check('O3b WMO codes map sensibly', skyFromCode(0) === 'clear' && skyFromCode(45) === 'fog' && skyFromCode(61) === 'rain' && skyFromCode(65) === 'heavy_rain' && skyFromCode(73) === 'snow' && skyFromCode(95) === 'thunderstorm');

    // Beyond the sky (from the conversation with Paul): the barometer and the air. Context, never the tree.
    // Three hours of observations every 15 min: the pressure falls (fast or not at all), the air is bad or clean.
    const sky = async (opts: { fall: number; aqi?: number; code?: number }) => {
      const b = new Bench();
      b.weather = { code: opts.code ?? 1, temp: 18, pressure: 1016, ...(opts.aqi !== undefined && { aqi: opts.aqi, pm25: 40 }) };
      await b.boot();
      await b.run(60, () => day());
      for (let k = 0; k < 13; k++) {
        b.weather = { ...b.weather!, pressure: 1016 - (opts.fall * k) / 12 };
        await b.collector.pollWeather();
        await b.run(15, () => day());
      }
      await b.collector.pollWeather();
      return b.state();
    };
    const calmAir = await sky({ fall: 0 });
    const coming = await sky({ fall: 6, aqi: 95 });
    check('O1b a falling barometer and bad air leave the tree identical (health, mood, look, scene)', strip(calmAir) === strip(coming), `${calmAir.health.condition} vs ${coming.health.condition}`);
    const pc = coming.perception.outside;
    check(
      'PA1 three hours of a 6 hPa fall: tendency falling fast (hPa per 3 h); a flat barometer is steady',
      pc?.pressureTendency === 'falling_fast' && Math.abs((pc.pressureTrend ?? 0) + 6) < 0.6 && calmAir.perception.outside?.pressureTendency === 'steady',
      `${pc?.pressureTrend} ${pc?.pressureTendency} / ${calmAir.perception.outside?.pressureTrend} ${calmAir.perception.outside?.pressureTendency}`
    );
    {
      const { airBand, pressureTrend } = await import('../src/telemetry/outsideWeather');
      const bands = [10, 30, 50, 70, 90, 140].map(airBand).join(',');
      check('PA2 European AQI bands', bands === 'good,fair,moderate,poor,very_poor,extremely_poor', bands);
      const short = [0, 1, 2, 3].map((k) => ({ at: k * 15 * MIN, sky: 'clear' as const, code: 0, temperature: 10, humidity: null, precipitation: null, cloudCover: null, wind: null, gusts: null, isDay: true, pressure: 1010 - k }));
      check('PA1b under 2 h of observations: no tendency', pressureTrend(short, 45 * MIN) === null);
    }
    check(
      'PA4 bad air outside is worth a word; a fast fall without it is too; rain outranks both',
      coming.behaviour.dayLine === 'weather_hazy' && (await sky({ fall: 6 })).behaviour.dayLine === 'weather_pressure_falling' && (await sky({ fall: 6, aqi: 95, code: 61 })).behaviour.dayLine === 'weather_rain',
      `${coming.behaviour.dayLine}`
    );
    const hazes = (['moderate', 'poor', 'very_poor', 'extremely_poor'] as const).map(
      (band) => weatherLook({ at: 0, ageMs: 0, sky: 'clear', code: 0, temperature: 10, humidity: null, precipitation: null, cloudCover: null, wind: null, gusts: null, isDay: true, windy: false, rainEndedAt: null, air: { aqi: 0, pm25: null, pm10: null, band }, ...(band !== 'moderate' && { hazy: { since: 0 } }) })?.haze ?? 0
    );
    check(
      'PA5 the haze grows with bad air (none up to moderate), and the weather look carries it',
      hazes[0] === 0 && hazes[1] > 0 && hazes[1] < hazes[2] && hazes[2] < hazes[3] && hazes[3] === 1 && (coming.expression.atmosphere.weather?.haze ?? 0) > 0 && calmAir.expression.atmosphere.weather?.haze === undefined,
      hazes.join(' < ')
    );
    {
      // Hysteresis: what the art reads is latched (enter/exit thresholds and durations), so nothing flickers
      const { outsideLatches } = await import('../src/telemetry/outsideWeather');
      const Q = 15 * MIN;
      const t0 = at(20, 6);
      const obs = (n: number, f: (i: number) => { aqi?: number; pressure?: number }) =>
        Array.from({ length: n }, (_, i) => ({ at: t0 + i * Q, sky: 'clear' as const, code: 0, temperature: 18, humidity: 60, precipitation: 0, cloudCover: 0, wind: 5, gusts: 8, isDay: true, ...f(i) }));
      const hazyAt = (list: ReturnType<typeof obs>) => list.map((o) => (outsideLatches(list, o.at).hazy ? 'H' : '.')).join('');
      const hover = hazyAt(obs(16, (i) => ({ aqi: i % 2 ? 62 : 58 })));
      const moderate = hazyAt(obs(16, (i) => ({ aqi: i % 2 ? 58 : 52 })));
      const spell = hazyAt(obs(16, (i) => ({ aqi: i < 4 ? 70 : i < 9 ? 55 : 45 })));
      const switches = (x: string) => x.split('').filter((c, i) => i > 0 && c !== x[i - 1]).length;
      check(
        'PA8 the haze has hysteresis: AQI hovering at 58/62 switches at most once (no flicker), moderate air never turns it on; 30 min of poor air does, it holds at 55, and goes after an hour clean (< 50)',
        switches(hover) <= 1 && !moderate.includes('H') && /^\.\.H+\.+$/.test(spell) && spell.indexOf('.', 2) >= 13,
        `hovering ${hover} · moderate ${moderate} · a spell ${spell}`
      );
      // The barometer: 3 h flat, then a fast fall; then a wobble back above −3.5 (still falling); then it eases
      const p = (i: number) => (i < 12 ? 1015 : i < 26 ? 1015 - (i - 11) * 0.5 : i < 30 ? 1008 + (i % 2) * 0.4 : 1008);
      const series = obs(44, (i) => ({ pressure: p(i) }));
      const comingAt = series.map((o) => (outsideLatches(series, o.at).weatherComing ? 'W' : '.')).join('');
      const blip = obs(20, (i) => ({ pressure: i === 14 ? 1010 : 1015 }));
      check(
        'PA9 "weather coming" has hysteresis: a sustained fast fall latches it, a brief dip does not, it holds through a wobble and lets go only once the fall has eased',
        comingAt.includes('W') && /^\.+W+\.+$/.test(comingAt) && !blip.some((o) => outsideLatches(blip, o.at).weatherComing),
        comingAt
      );
      const bench = new Bench();
      bench.weather = { code: 1, temp: 18, pressure: 1016, aqi: 95, pm25: 40 };
      await bench.boot();
      await bench.run(30, () => day());
      for (let k = 0; k < 13; k++) {
        bench.weather = { ...bench.weather!, pressure: 1016 - k * 0.5 };
        await bench.collector.pollWeather();
        await bench.run(15, () => day());
      }
      const live = bench.state().perception.outside;
      const again = new Bench(bench.db);
      again.clock = bench.clock;
      again.weather = null;
      await again.boot();
      const back = again.state().perception.outside;
      check(
        'PA10 the latches replay from the stored observations: a restart gives the same (weather coming, hazy, since when)',
        !!live?.weatherComing && !!live.hazy && JSON.stringify([back?.weatherComing, back?.hazy]) === JSON.stringify([live.weatherComing, live.hazy]),
        JSON.stringify({ coming: live?.weatherComing, hazy: live?.hazy })
      );
    }

    // A calm day with rain outside: one word about it, once a day, never during stress
    const b = new Bench();
    b.weather = { code: 61, temp: 12 };
    await b.boot();
    const l = new Listener(b);
    await l.run(90, () => day());
    await b.collector.pollWeather();
    await l.run(60, () => day());
    const rainLines = l.spoken.filter((s) => /rain/i.test(s.text));
    check('O4 calm + rain outside: mentioned once', rainLines.length === 1, l.spoken.map((s) => `${s.reason}: ${s.text}`).join(' / '));
    await b.collector.pollWeather();
    await l.run(120, () => day());
    check('O4b not repeated the same day', l.spoken.filter((s) => /rain/i.test(s.text)).length === 1);
    {
      // Rain starts while the tree is calm and silent: it is news, said once (after the cooldown)
      const q = new Bench();
      q.weather = { code: 1, temp: 18 };
      await q.boot();
      const lq = new Listener(q);
      await lq.run(90, () => day());
      lq.reset();
      q.weather = { code: 63, temp: 12 };
      await q.collector.pollWeather();
      await lq.run(60, () => day());
      // (spoken inside pollWeather(), so the listener sees it on the next poll)
      const news = lq.spoken.filter((s) => /rain/i.test(s.text));
      check('O4c rain starting on a quiet calm day is news, said once', news.length === 1, lq.spoken.map((s) => `${s.reason}: ${s.text}`).join(' / ') || 'silent');
    }
    const t = new Bench();
    t.weather = { code: 61, temp: 12 };
    await t.boot();
    const lt = new Listener(t);
    await lt.run(30, () => day());
    lt.reset();
    await lt.run(120, () => ({ soil: 30 }));
    check('O5 a thirsty tree talks about its thirst, not the weather', !lt.spoken.some((s) => /rain/i.test(s.text)), lt.keys());

    const { weatherSpells } = await import('../src/history/diary');
    const obs = (h: number, m: number, code: number, temp = 10) => ({ at: at(20, h, m), sky: skyFromCode(code), code, temperature: temp, humidity: null, precipitation: null, cloudCover: null, wind: null, gusts: null, isDay: true });
    const spells = weatherSpells([obs(13, 0, 0), obs(14, 0, 61), obs(14, 15, 63), obs(14, 30, 61), obs(15, 0, 3), obs(23, 0, 0, -2), obs(23, 15, 0, -3)]);
    check('O6 diary: one line per spell (rain 14:00–14:30, frost)', spells.length === 2 && spells.some((s) => s.weather === 'rain') && spells.some((s) => s.weather === 'frost' && /-3/.test(s.detail ?? '')), spells.map((s) => `${s.title} ${s.detail}`).join(' | '));
  }

  console.log('\n— The dragonfly (the air of the last hours) —');
  {
    const { replayDragonfly, evaluateDragonfly, dragonflyDiary } = await import('../src/behaviour/dragonfly');
    const { ACTIVE_SPECIES } = await import('../src/species');
    const H = 60 * MIN;
    const cad = 3 * MIN;
    const smp = (t: number, temp: number | null = 24, light: number | null = 55, day = true) => ({ t, soil: 60, soilRaw: null, temp, hum: 55, light, radiation: null, lightRaw: null, isDay: day, lightExpected: day });
    const run = (from: number, minutes: number, f: (i: number) => ReturnType<typeof smp>) => Array.from({ length: minutes }, (_, i) => f(i));
    const t0 = at(20, 9);
    const warm = (from: number, minutes: number, temp = 24) => run(from, minutes, (i) => smp(from + i * MIN, temp));
    const rp = (samples: ReturnType<typeof smp>[], now: number, obs: any[] = []) => replayDragonfly(samples, obs, ACTIVE_SPECIES, cad, now);

    const after30 = rp(warm(t0, 30), t0 + 30 * MIN);
    const after60 = rp(warm(t0, 60), t0 + 60 * MIN);
    check('DF1 warm, bright, calm air: active after about 45 min, not after 30', !after30.active && after60.active, `30 min ${after30.value}, 60 min ${after60.value}`);
    const base = warm(t0, 120);
    const dip = [...base, ...run(t0 + 120 * MIN, 10, (i) => smp(t0 + (120 + i) * MIN, 19))];
    const dipped = rp(dip, t0 + 130 * MIN);
    check('DF1b hysteresis: ten cool minutes don\'t drop it', dipped.active, `${dipped.value}`);
    const rain = Array.from({ length: 3 }, (_, k) => ({ at: t0 + (120 + k * 15) * MIN, sky: 'rain' as const, code: 61, temperature: 15, humidity: 90, precipitation: 2, cloudCover: 100, wind: 10, gusts: 20, isDay: true }));
    const rained = rp([...base, ...warm(t0 + 120 * MIN, 25)], t0 + 145 * MIN, rain);
    check('DF1c 25 minutes of rain outside: grounded (latch off)', !rained.active, `${rained.value}`);
    const windy = rp(warm(t0, 90), t0 + 90 * MIN, [{ at: t0, sky: 'clear', code: 0, temperature: 22, humidity: 50, precipitation: 0, cloudCover: 0, wind: 30, gusts: 50, isDay: true }, { at: t0 + 45 * MIN, sky: 'clear', code: 0, temperature: 22, humidity: 50, precipitation: 0, cloudCover: 0, wind: 30, gusts: 50, isDay: true }]);
    check('DF1d strong gusts outside: no dragonfly weather', !windy.active, `${windy.value}`);

    // Gates: the tree's state only gates it
    const day = warm(t0, 12 * 60);
    const ev = (condition: any, modifiers: any[] = [], isDay = true, now = t0 + 12 * 60 * MIN) =>
      evaluateDragonfly({ samples: day, outsideToday: [], species: ACTIVE_SPECIES, cadenceMs: cad, condition, modifiers, isDay, insideTemp: 24, now });
    const firstVisit = (condition: any) => {
      for (let m = 60; m < 12 * 60; m++) {
        const v = evaluateDragonfly({ samples: day.filter((x) => x.t <= t0 + m * MIN), outsideToday: [], species: ACTIVE_SPECIES, cadenceMs: cad, condition, modifiers: [], isDay: true, insideTemp: 24, now: t0 + m * MIN });
        if (v.visit) return v;
      }
      return null;
    };
    check('DF2 gates: none at night, in a critical stress, or with no trustworthy data', ev('comfortable', [], false).presence === 'none' && ev('very_dry').presence === 'none' && ev('comfortable', ['sensor_uncertain']).presence === 'none');
    const thirstyVisit = firstVisit('thirsty');
    check('DF2b looser than the squirrel: a thirsty tree still gets a dragonfly', !!thirstyVisit && thirstyVisit.presence !== 'none', thirstyVisit?.why);
    const full = ev('comfortable');
    check('DF3 it comes around often on a warm day (far more than the squirrel)', full.visitsToday.count >= 15, `${full.visitsToday.count} visits in 12 h`);
    check('DF3b deterministic', JSON.stringify(ev('comfortable')) === JSON.stringify(full));
    // Gaps: a reading stands for one cadence; two hours without readings neither build nor drain it
    const gapped = rp([...warm(t0, 30), ...warm(t0 + 150 * MIN, 30)], t0 + 180 * MIN);
    const solid = rp(warm(t0, 60), t0 + 60 * MIN);
    check('DF4 unobserved time holds it (a 2 h gap counts for nothing)', Math.abs(gapped.value - solid.value) < 0.05, `gapped ${gapped.value} vs continuous ${solid.value}`);

    // Isolation: the same tree with and without dragonfly weather → identical biology, mood and squirrel
    const bb = new Bench();
    bb.clock = at(21, 9);
    await bb.boot();
    await bb.run(90, () => ({ soil: 60, light: 55 }));
    const st = bb.state();
    const rainy = Array.from({ length: 8 }, (_, k) => ({ at: bb.clock - k * 15 * MIN, sky: 'heavy_rain' as const, code: 65, temperature: 14, humidity: 95, precipitation: 6, cloudCover: 100, wind: 20, gusts: 30, isDay: true }));
    const evalWith = (outsideToday: any[]) => evaluateBehaviour({ health: st.health, perception: { ...st.perception, outsideToday }, episodes: bb.db.episodesSince(0), events: [], species: ACTIVE_SPECIES, now: bb.clock });
    const sunnyB = evalWith([]);
    const rainyB = evalWith(rainy);
    // (the sloth reads the air too, by design: left out like the dragonfly itself)
    const strip = (x: typeof sunnyB) => JSON.stringify({ energy: x.energy, intent: x.messageIntent, squirrel: { ...x.habitat, dragonfly: undefined, sloth: undefined, lucy: undefined } });
    const lift = sunnyB.moodState.valence - rainyB.moodState.valence;
    check('DF5 the dragonfly changes nothing else (energy, words, the squirrel); its company lifts the mood only a little', strip(sunnyB) === strip(rainyB) && sunnyB.habitat.dragonfly!.active && !rainyB.habitat.dragonfly!.active && lift >= 0 && lift <= 0.1 + 1e-9, `sunny ${sunnyB.habitat.dragonfly!.value} / rainy ${rainyB.habitat.dragonfly!.value} · mood +${lift.toFixed(2)}`);

    // Diary: one line per day with visits, from stored readings through the same replay
    const twoDays = [...warm(at(18, 9), 10 * 60), ...warm(at(19, 9), 10 * 60)];
    const diary = dragonflyDiary(twoDays, [], [], ACTIVE_SPECIES, cad, at(19, 20), 3);
    check('DF6 diary: a line per warm day', diary.length === 2 && diary.every((d) => d.habitat === 'dragonfly' && /visits?/.test(d.detail ?? '')), diary.map((d) => `${d.title} ${d.detail}`).join(' | '));
  }

  console.log('\n— The sloth (warm, humid, still air; slow in everything) —');
  {
    const { replaySloth, evaluateSloth, slothDiary } = await import('../src/behaviour/sloth');
    const { ACTIVE_SPECIES } = await import('../src/species');
    const cad = 3 * MIN;
    const smp = (t: number, temp: number | null = 26, hum: number | null = 70, day = true) => ({ t, soil: 60, soilRaw: null, temp, hum, light: day ? 50 : 2, radiation: null, lightRaw: null, isDay: day, lightExpected: day });
    const t0 = at(22, 8);
    const humid = (from: number, minutes: number, temp = 26, hum = 70, day = true) => Array.from({ length: minutes }, (_, i) => smp(from + i * MIN, temp, hum, day));
    const rp = (samples: ReturnType<typeof smp>[], now: number, obs: any[] = []) => replaySloth(samples, obs, ACTIVE_SPECIES, cad, now);
    const wx = (from: number, n: number, sky: string, gusts: number) =>
      Array.from({ length: n }, (_, k) => ({ at: from + k * 15 * MIN, sky, code: 0, temperature: 18, humidity: 80, precipitation: sky.includes('rain') ? 3 : 0, cloudCover: 100, wind: gusts / 2, gusts, isDay: true }));

    const h60 = rp(humid(t0, 60), t0 + 60 * MIN);
    const h120 = rp(humid(t0, 120), t0 + 120 * MIN);
    check('SL1 slow to come: not settled after an hour of warm, humid air, settled after two', !h60.active && h120.active, `60 min ${h60.value}, 120 min ${h120.value}`);
    const base = humid(t0, 4 * 60);
    const dry30 = rp([...base, ...humid(t0 + 240 * MIN, 30, 26, 40)], t0 + 270 * MIN);
    const dry120 = rp([...base, ...humid(t0 + 240 * MIN, 120, 26, 40)], t0 + 360 * MIN);
    check("SL1b slow to leave: half an hour of dry air doesn't move it, two hours do", dry30.active && !dry120.active, `30 min ${dry30.value}, 2 h ${dry120.value}`);
    const rainy = rp([...base, ...humid(t0 + 240 * MIN, 120)], t0 + 360 * MIN, wx(t0 + 240 * MIN, 8, 'heavy_rain', 15));
    const stormy = rp([...base, ...humid(t0 + 240 * MIN, 120)], t0 + 360 * MIN, wx(t0 + 240 * MIN, 8, 'thunderstorm', 25));
    check("SL1c rain doesn't bother it; a storm sends it off", rainy.active && !stormy.active, `rain ${rainy.value}, storm ${stormy.value}`);

    const day = humid(t0, 12 * 60);
    const ev = (condition: any, modifiers: any[] = [], isDay = true, samples = day, now = t0 + 12 * 60 * MIN) =>
      evaluateSloth({ samples, outsideToday: [], species: ACTIVE_SPECIES, cadenceMs: cad, condition, modifiers, isDay, insideTemp: 26, now });
    check('SL2 gates: none when the tree is cold, in a critical stress or without trustworthy data', ev('cold').presence === 'none' && ev('very_dry').presence === 'none' && ev('comfortable', ['sensor_uncertain']).presence === 'none');
    const full = ev('comfortable');
    check('SL3 it comes often, and stays long', full.visitsToday.count >= 6 && full.visitsToday.minutes >= 150, `${full.visitsToday.count} visits, ${full.visitsToday.minutes} min in 12 h`);
    check('SL3b deterministic', JSON.stringify(ev('comfortable')) === JSON.stringify(full));
    const night = [...day, ...humid(t0 + 12 * 60 * MIN, 6 * 60, 25, 75, false)];
    const n1 = ev('sleeping', [], false, night, t0 + 15 * 60 * MIN);
    const n2 = ev('sleeping', [], false, night, t0 + 17 * 60 * MIN);
    check('SL4 at night it sleeps the night through on one branch (no coming and going)', n1.presence === 'sleeping' && n2.presence === 'sleeping' && n1.visit!.id === n2.visit!.id && n1.visit!.branch === n2.visit!.branch, `${n1.visit?.id} / ${n2.visit?.id}`);
    const thirsty = (() => {
      for (let m = 120; m < 12 * 60; m++) {
        const v = ev('thirsty', [], true, day.filter((x) => x.t <= t0 + m * MIN), t0 + m * MIN);
        if (v.visit) return v;
      }
      return null;
    })();
    check('SL4b looser rules: a thirsty tree still gets its sloth', !!thirsty, thirsty?.why);

    // Isolation: gusts of 32 km/h (too windy for a sloth, not for a dragonfly) change only the sloth
    const bb = new Bench();
    bb.clock = at(23, 9);
    await bb.boot();
    await bb.run(150, () => ({ soil: 60, light: 55, temp: 26, hum: 70 }));
    const st = bb.state();
    const calm = wx(bb.clock - 150 * MIN, 11, 'clear', 10);
    const breezy = wx(bb.clock - 150 * MIN, 11, 'clear', 32);
    const evalWith = (outsideToday: any[]) => evaluateBehaviour({ health: st.health, perception: { ...st.perception, outsideToday }, episodes: bb.db.episodesSince(0), events: [], species: ACTIVE_SPECIES, now: bb.clock });
    const c = evalWith(calm);
    const w = evalWith(breezy);
    const strip = (x: typeof c) => JSON.stringify({ energy: x.energy, intent: x.messageIntent, others: { ...x.habitat, sloth: undefined, lucy: undefined } });
    const slothLift = c.moodState.valence - w.moodState.valence;
    check('SL5 the sloth changes nothing else (energy, words, the squirrel, the dragonfly); its company lifts the mood only a little', strip(c) === strip(w) && c.habitat.sloth!.active && !w.habitat.sloth!.active && Math.abs(slothLift) <= 0.15, `calm ${c.habitat.sloth!.value} / breezy ${w.habitat.sloth!.value} · mood ${slothLift >= 0 ? '+' : ''}${slothLift.toFixed(2)}`);

    const diary = slothDiary([...humid(at(18, 8), 12 * 60), ...humid(at(19, 8), 12 * 60)], [], [], ACTIVE_SPECIES, cad, at(19, 21), 3);
    check('SL6 diary: how long the sloth stayed, per day', diary.length === 2 && diary.every((d) => d.habitat === 'sloth' && /about .* across \d+ visits?/.test(d.detail ?? '')), diary.map((d) => `${d.title} · ${d.detail}`).join(' | '));

    // Grips from comfort: all four when it has just arrived, relaxed grips only after long perfect air
    const { slothGrip } = await import('../src/behaviour/sloth');
    const s0 = at(22, 10);
    const ids = Array.from({ length: 60 }, (_, i) => `sloth:test:${i}`);
    const gripsAt = (comfort: number) => new Set(ids.flatMap((id) => [1, 2, 3].map((seg) => slothGrip(id, 'hanging', s0, comfort, s0 + (seg * 12 + 3) * MIN))));
    const low = gripsAt(0.65);
    const mid = gripsAt(0.8);
    const high = gripsAt(0.95);
    check(
      'SL7 grips follow its comfort: just arrived → all four; marginal → four/arms; comfortable → arms/legs+arm; long perfect air → one arm/legs',
      ids.every((id) => slothGrip(id, 'hanging', s0, 0.99, s0 + 5 * MIN) === 'four') &&
        [...low].every((g) => g === 'four' || g === 'arms') && low.size === 2 &&
        [...mid].every((g) => g === 'arms' || g === 'two_legs_one_arm') && mid.size === 2 &&
        [...high].every((g) => g === 'one_arm' || g === 'legs') && high.size === 2,
      `low ${[...low]} · mid ${[...mid]} · high ${[...high]}`
    );
    const stable = ids.every((id) => slothGrip(id, 'hanging', s0, 0.95, s0 + 13 * MIN) === slothGrip(id, 'hanging', s0, 0.95, s0 + 23 * MIN));
    const changes = ids.some((id) => slothGrip(id, 'hanging', s0, 0.95, s0 + 13 * MIN) !== slothGrip(id, 'hanging', s0, 0.95, s0 + 25 * MIN));
    check('SL7b a grip holds for its whole stretch and changes slowly between stretches', stable && changes);
    check(
      'SL7c climbing and asleep: always all four (the night sloth too)',
      slothGrip('x', 'climbing', s0, 0.99, s0 + 40 * MIN) === 'four' && slothGrip('x', 'sleeping', s0, 0.99, s0 + 40 * MIN) === 'four' && n1.visit!.grip === 'four',
      n1.visit?.grip
    );
    const visits = Array.from({ length: 10 * 60 }, (_, m) => ev('comfortable', [], true, day.filter((x) => x.t <= t0 + (120 + m) * MIN), t0 + (120 + m) * MIN).visit).filter(Boolean);
    check('SL7d the live sloth carries its grip, which varies over a day', visits.length > 0 && new Set(visits.map((x) => x!.grip)).size >= 2, [...new Set(visits.map((x) => x!.grip))].join(', '));
  }

  console.log('\n— Encounters (visitors in the tree together) —');
  {
    const { meet, spotByPerch, encounterDiary } = await import('../src/behaviour/encounters');
    const { encounterCues } = await import('../src/expression/ExpressionEngine');
    const { evaluateVoice } = await import('../src/behaviour/voice');
    const { renderMessage } = await import('../src/behaviour/messages');
    const { ACTIVE_SPECIES: SPECIES } = await import('../src/species');
    const n = Array.from({ length: 200 }, (_, i) => i);
    const sq = (i: number, spot: any = 'left_branch', mode: any = 'visiting', fixed = false) => ({ id: `sq:${i}`, spot, mode, fixed });
    const sl = (i: number, branch: any = 'left_branch', asleep = false) => ({ id: `sl:${i}`, branch, asleep });
    const df = (i: number, perch: any = 'left_tip', perched = true) => ({ id: `df:${i}`, perch, perched });

    const apart = n.map((i) => meet({ squirrel: sq(i), dragonfly: null, sloth: sl(i) }));
    check(
      'EN1 the squirrel never shares the sloth\'s branch (it moves on), and they meet',
      apart.every((m) => m.squirrelSpot !== m.slothBranch && m.encounters.includes('squirrel_sloth')),
      [...new Set(apart.map((m) => m.squirrelSpot))].join(', ')
    );
    const care = meet({ squirrel: sq(1, 'left_branch', 'visiting', true), dragonfly: null, sloth: sl(1) });
    check('EN1b came for that spot (a care answer): the sloth hangs on the other branch instead', care.squirrelSpot === 'left_branch' && care.slothBranch === 'right_branch');

    const perches = ['left_tip', 'left_top', 'right_tip', 'crown_tip'] as const;
    const spots = ['left_branch', 'right_branch', 'crown', 'trunk', 'pot_rim'] as const;
    const watch = spots.flatMap((spot) => perches.flatMap((perch) => n.slice(0, 20).map((i) => meet({ squirrel: sq(i, spot), dragonfly: df(i, perch), sloth: null }))));
    check(
      'EN2 the dragonfly never rests right by the squirrel, which watches it',
      watch.every((m) => m.dragonflyPerch !== 'on_sloth' && spotByPerch(m.dragonflyPerch!) !== m.squirrelSpot && m.encounters.includes('squirrel_dragonfly'))
    );

    const ride = n.map((i) => meet({ squirrel: null, dragonfly: df(i), sloth: sl(i, 'right_branch') }));
    const share = ride.filter((m) => m.dragonflyPerch === 'on_sloth').length / n.length;
    const hover = n.map((i) => meet({ squirrel: null, dragonfly: df(i, 'left_tip', false), sloth: sl(i) }));
    check(
      'EN3 a perched dragonfly rests on the sloth about half the time (deterministic); hovering never',
      share > 0.35 && share < 0.65 && ride.every((m) => (m.dragonflyPerch === 'on_sloth') === m.encounters.includes('dragonfly_sloth')) &&
        JSON.stringify(ride) === JSON.stringify(n.map((i) => meet({ squirrel: null, dragonfly: df(i), sloth: sl(i, 'right_branch') }))) &&
        hover.every((m) => m.dragonflyPerch !== 'on_sloth'),
      `${Math.round(share * 100)}% on the sloth`
    );

    const alone = [
      meet({ squirrel: sq(1), dragonfly: null, sloth: null }),
      meet({ squirrel: null, dragonfly: df(1), sloth: null }),
      meet({ squirrel: null, dragonfly: null, sloth: sl(1) }),
      meet({ squirrel: sq(1, 'crown', 'sleeping'), dragonfly: null, sloth: sl(1, 'left_branch', true) }),
    ];
    check('EN4 no encounter without two visitors in the tree (and an asleep squirrel meets nobody)', alone.every((m) => m.encounters.length === 0));

    // Expression cues
    const play = { kind: 'gentle', hopEveryMs: 4000, hideChance: 0.3, returnMs: 10000, lingerMs: 4000, wag: { tempo: 1, amount: 1 } } as any;
    const v = { kind: 'squirrel', id: 'v', mode: 'visiting', spot: 'crown', carrying: null, action: null, play } as any;
    const s = { id: 's', pose: 'hanging', branch: 'left_branch', grip: 'arms', tempo: 0.5 } as any;
    const d = { id: 'd', presence: 'perched', perch: 'right_tip', wingTempo: 1 } as any;
    const c1 = encounterCues({ visitor: v, dragonfly: null, sloth: s }, ['squirrel_sloth']);
    const c2 = encounterCues({ visitor: v, dragonfly: d, sloth: s }, ['squirrel_sloth', 'squirrel_dragonfly']);
    const c3 = encounterCues({ visitor: null, dragonfly: { ...d, perch: 'on_sloth' }, sloth: s }, ['dragonfly_sloth']);
    const c4 = encounterCues({ visitor: v, dragonfly: null, sloth: { ...s, pose: 'sleeping' } }, ['squirrel_sloth']);
    check(
      'EN5 cues: they look at each other; the squirrel watches the dragonfly first; its play keeps off their spots; a rider means slow blinks; asleep, no turn',
      c1.visitor!.lookAt === 'sloth' && c1.sloth!.lookAt === 'squirrel' && c1.visitor!.avoid!.includes('left_branch') &&
        c2.visitor!.lookAt === 'dragonfly' && c2.visitor!.avoid!.includes('right_branch') &&
        c3.sloth!.rider === true && c3.dragonfly!.perch === 'on_sloth' &&
        c4.sloth!.lookAt === null &&
        encounterCues({ visitor: null, dragonfly: { ...d, perch: 'on_sloth' }, sloth: null }, []).dragonfly!.perch !== 'on_sloth'
    );

    // Words: a "visitors met" thought while it happens, worded per pair
    const b = new Bench();
    b.clock = at(23, 11);
    await b.boot();
    await b.run(120, () => ({ soil: 60, light: 55, temp: 24, hum: 55 }));
    const st = b.state();
    const beh = st.behaviour!;
    const voiceWith = (encounters: any[]) =>
      evaluateVoice({ health: { ...st.health, vitality: 90 }, perception: st.perception, species: SPECIES, intent: 'content', timeOfDay: 'day', season: beh.season, relationship: beh.relationship, habitat: { ...beh.habitat, encounters }, canopy: beh.canopy, now: b.clock });
    const met = voiceWith(['squirrel_sloth']).musings.find((m) => m.id === 'visitors_met');
    const none = voiceWith([]).musings.find((m) => m.id === 'visitors_met');
    const text = met ? renderMessage({ key: 'content', variant: 0, musing: { id: met.id, facts: met.facts, variant: 0 } } as any).text : '';
    check('EN6 a "shared the tree" thought only while they meet, naming the pair', !!met && !none && /squirrel and the sloth/.test(text), text);

    // Diary: overlapping visit windows → one line per pair and day
    const w = (h: number, m: number, len: number) => ({ from: at(20, h, m), to: at(20, h, m) + len * MIN });
    const lines = encounterDiary({ squirrel: [w(9, 0, 10), w(15, 0, 8)], sloth: [w(9, 5, 40), w(15, 2, 30)], dragonfly: [w(12, 0, 5)] }, at(19, 0), at(21, 0));
    const noLines = encounterDiary({ squirrel: [w(9, 0, 10)], sloth: [w(11, 0, 40)], dragonfly: [w(13, 0, 5)] }, at(19, 0), at(21, 0));
    check(
      'EN7 diary: a line when visits overlapped (n times), none without',
      lines.length === 1 && lines[0].title.includes('squirrel and the sloth') && /2 times/.test(lines[0].detail) && noLines.length === 0,
      lines.map((l) => `${l.title} · ${l.detail}`).join(' | ')
    );

    // ---- From choreography to relationships (familiarity, and the squirrel learning Lucy) ----
    const unknown = { squirrel_sloth: 0.5, squirrel_dragonfly: 0.5, dragonfly_sloth: 0.5, lucy_squirrel: 0.5 };
    const same = (f: (fam?: any) => unknown) => JSON.stringify(f()) === JSON.stringify(f(unknown));
    check(
      'EN8 unknown familiarity meets exactly as before (no history: previews, a fresh tree); the "visitors met" thought ignores Lucy',
      same((fam) => n.map((i) => meet({ squirrel: sq(i), dragonfly: null, sloth: sl(i), familiarity: fam }))) &&
        same((fam) => watch.map((_, k) => meet({ squirrel: sq(k % 20, spots[k % 5]), dragonfly: df(k % 20, perches[k % 4]), sloth: null, familiarity: fam }))) &&
        same((fam) => n.map((i) => meet({ squirrel: null, dragonfly: df(i), sloth: sl(i, 'right_branch'), familiarity: fam }))) &&
        !voiceWith(['lucy_squirrel']).musings.some((m) => m.id === 'visitors_met')
    );
    const lucyAwake = { id: 'lucy:x', awake: true };
    const wary = meet({ squirrel: sq(1, 'crown'), dragonfly: null, sloth: null, lucy: lucyAwake, wariness: 0.6 });
    const calm = meet({ squirrel: sq(1, 'crown'), dragonfly: null, sloth: null, lucy: lucyAwake, wariness: 0.1 });
    const asleep = meet({ squirrel: sq(1, 'crown'), dragonfly: null, sloth: null, lucy: { ...lucyAwake, awake: false }, wariness: 0.9 });
    const peace = meet({ squirrel: sq(1, 'crown'), dragonfly: null, sloth: null, lucy: lucyAwake, wariness: 0.9, familiarity: { lucy_squirrel: 0.9 } });
    const watched = encounterCues({ visitor: v, dragonfly: d, sloth: null }, calm.encounters.concat(['squirrel_dragonfly']));
    check(
      'EN10 Lucy awake below: a wary squirrel ducks into the leaves, an unwary one watches her (before the dragonfly); asleep, she meets nobody; at peace with her, it stays out',
      wary.squirrelShows === 'hiding' && calm.squirrelShows === null && calm.encounters.includes('lucy_squirrel') && watched.visitor!.lookAt === 'lucy' &&
        asleep.encounters.length === 0 && peace.squirrelShows === null,
      `wary ${wary.squirrelShows} · calm ${calm.squirrelShows} (looks at ${watched.visitor!.lookAt})`
    );
    {
      const { familiarity, familiarityStage } = await import('../src/behaviour/familiarity');
      const day = (k: number, h: number, len: number) => ({ from: at(10, h) + k * 24 * 60 * MIN, to: at(10, h) + k * 24 * 60 * MIN + len * MIN });
      const a = Array.from({ length: 18 }, (_, k) => day(k, 10, 20));
      const b = Array.from({ length: 18 }, (_, k) => day(k, 10, 30));
      const elsewhere = Array.from({ length: 10 }, (_, k) => day(k, 15, 30));
      const fNow = familiarity(a, b, at(10, 0) + 18 * 24 * 60 * MIN);
      const fLater = familiarity(a, b, at(10, 0) + 48 * 24 * 60 * MIN);
      const fNever = familiarity(a, elsewhere, at(10, 0) + 10 * 24 * 60 * MIN);
      const shy = meet({ squirrel: sq(1, 'crown'), dragonfly: null, sloth: sl(1), familiarity: { squirrel_sloth: 0.1 } });
      const friends = encounterCues({ visitor: v, dragonfly: null, sloth: s }, ['squirrel_sloth'], { squirrel_sloth: 0.9 });
      check(
        'EN11 familiarity grows with meetings and fades without them; strangers only peek at the sloth, old friends stop staring (and its play may hop onto the sloth\'s branch)',
        familiarityStage(fNow) === 'friends' && fLater < 0.3 && fNever === 0 && shy.squirrelShows === 'peek' && friends.visitor!.lookAt === null && friends.sloth!.lookAt === null && !friends.visitor!.avoid!.includes('left_branch'),
        `18 days together ${fNow} · a month later ${fLater} · never together ${fNever}`
      );
      const rideAt = (f: number) => n.filter((i) => meet({ squirrel: null, dragonfly: df(i), sloth: sl(i, 'right_branch'), familiarity: { dragonfly_sloth: f } }).dragonflyPerch === 'on_sloth').length / n.length;
      const [r0, r5, r1] = [rideAt(0), rideAt(0.5), rideAt(1)];
      check('EN12 the dragonfly rests on the sloth more the better they know each other (about 25 % → 50 % → 80 %)', r0 < r5 && r5 < r1 && r0 < 0.38 && r1 > 0.68, `${Math.round(r0 * 100)}% · ${Math.round(r5 * 100)}% · ${Math.round(r1 * 100)}%`);
    }
  }

  console.log('\n— The squirrel learns Lucy (wariness, its hours) —');
  {
    const { squirrelLife, replayHabitat, evaluateHabitat, habitatDiary } = await import('../src/behaviour/habitat');
    const { lucyDayVisits } = await import('../src/behaviour/lucy');
    type Ep = import('../src/history/historyTypes').BehaviourEpisode;
    const HOUR = 60 * MIN;
    let id = 0;
    const ep = (condition: Ep['condition'], startedAt: number, hours: number, open = false): Ep => ({
      id: ++id, startedAt, endedAt: open ? null : startedAt + hours * HOUR, lastSeenAt: startedAt + hours * HOUR, unobservedMs: 0, condition, modifiers: [], peakSeverity: 'none', engineVersion: 't',
    });
    const day0 = new Date(2026, 5, 1).getTime();
    const now = day0 + 30 * 24 * HOUR + 12 * HOUR;
    const episodes: Ep[] = [];
    for (let t = day0; t < now; t += 24 * HOUR) episodes.push(ep('sleeping', t, 7), ep('comfortable', t + 7 * HOUR, 14), ep('sleeping', t + 21 * HOUR, 3));
    const isDay = (t: number) => { const h = new Date(t).getHours(); return h >= 7 && h < 21; };
    const season = () => ({ id: 'summer', energy: 1 });
    const r = replayHabitat(episodes, now, true);
    const without = squirrelLife(episodes, now, r, isDay, season);
    const withLucy = squirrelLife(episodes, now, r, isDay, season, lucyDayVisits);
    const inHerHours = (life: typeof without, from: number) => {
      const vs = life.visits.filter((x) => x.presence === 'visiting' && x.startedAt >= from);
      const hit = vs.filter((x) => lucyDayVisits(x.startedAt).some((w) => w.from < x.endsAt && w.to > x.startedAt)).length;
      return { share: vs.length ? hit / vs.length : 0, n: vs.length };
    };
    const late = now - 10 * 24 * HOUR;
    const a = inHerHours(without, late);
    const b = inHerHours(withLucy, late);
    const lessons = withLucy.lucy!.days.reduce((k, d) => k + d.lessons.length, 0);
    check(
      'EN9 weeks of Lucy getting curious or excited about it: it grows wary, and comes less in her hours (they drift away from hers by themselves)',
      without.lucy === null && withLucy.lucy!.wariness > 0.3 && lessons > 0 && b.share < a.share,
      `wariness ${withLucy.lucy!.wariness} after ${lessons} lessons · visits in her hours ${Math.round(a.share * 100)}% → ${Math.round(b.share * 100)}% (${a.n} / ${b.n} visits in 10 days) · usual hour ${without.habits.usualHour} → ${withLucy.habits.usualHour}`
    );
    const plain = evaluateHabitat({ episodes, condition: 'comfortable', modifiers: [], isDay: true, season: season(), now });
    const learned = evaluateHabitat({ episodes, condition: 'comfortable', modifiers: [], isDay: true, season: season(), now, lucyVisitsOn: lucyDayVisits, airHistory: { sloth: [], dragonfly: [] } });
    check(
      'EN14 what it learns of the others never changes the habitat itself (value, welcoming, trust, the drey): only who shows where',
      plain.value === learned.value && plain.welcoming === learned.welcoming && plain.memory.trust === learned.memory.trust && JSON.stringify(plain.drey) === JSON.stringify(learned.drey) && plain.familiarity === undefined && learned.familiarity?.lucy_squirrel !== undefined,
      JSON.stringify(learned.familiarity)
    );
    // The diary names what happened: Lucy noticing it, waiting for her to go, a pair at ease
    const sloth = Array.from({ length: 30 }, (_, k) => ({ from: day0 + k * 24 * HOUR + 7 * HOUR, to: day0 + k * 24 * HOUR + 20 * HOUR }));
    const diary = habitatDiary({ episodes, now, days: 30, location: { latitude: null, longitude: null }, seasonAt: season, lucyVisitsOn: lucyDayVisits, airHistory: { sloth, dragonfly: [] } });
    const titles = diary.map((i) => i.title);
    const once = (t: string) => titles.filter((x) => x === t).length;
    check(
      'EN13 diary: Lucy spotted the squirrel, it waited until she had gone, and the squirrel and the sloth got used to each other (once)',
      titles.includes('Lucy spotted the squirrel') && titles.includes('The squirrel waited until Lucy had gone') && once('The squirrel and the sloth are used to each other now') === 1,
      [...new Set(titles.filter((t) => /Lucy|used to|friends|peace|new hour|minds/.test(t)))].join(' | ')
    );
  }

  console.log('\n— The dragonfly flies around (its route through a visit) —');
  {
    const { dragonflyRoute, stopAt } = await import('../src/behaviour/dragonfly');
    const { applyEncounters } = await import('../src/behaviour/encounters');
    const t0 = at(20, 12);
    const visit = (i: number, minutes = 6, style: 'perched' | 'hovering' = 'perched') => ({ id: `dragonfly:test:${i}`, startedAt: t0, endsAt: t0 + minutes * MIN, style });
    const ids = Array.from({ length: 120 }, (_, i) => i);
    const routes = ids.map((i) => dragonflyRoute(visit(i), { home: 'left_tip', liveliness: 0.5 }));
    const ordered = routes.every((r) => r[0].at === t0 && r[0].perch === 'left_tip' && r.every((s, k) => k === 0 || (s.at > r[k - 1].at && s.at < t0 + 6 * MIN)));
    const moving = routes.filter((r) => new Set(r.map((s) => `${s.perch}:${s.mode}`)).size > 1).length / routes.length;
    check('DF7 it flies around: a route of stops through the visit, starting on its home tip; most visits go somewhere', ordered && moving > 0.8, `${Math.round(moving * 100)}% of 6-min visits move · e.g. ${routes[0].map((s) => `${s.perch}${s.mode === 'hovering' ? '~' : ''}`).join(' → ')}`);

    const long = ids.map((i) => dragonflyRoute(visit(i, 120), { home: 'left_tip', liveliness: 0.5 }));
    const perched = long.flatMap((r) => r.filter((s) => s.mode === 'perched'));
    const homeShare = perched.filter((s) => s.perch === 'left_tip').length / perched.length;
    const away = perched.filter((s) => s.perch !== 'left_tip');
    const crown = away.filter((s) => s.perch === 'crown_tip').length / away.length;
    check('DF7b perch fidelity: it keeps coming back to its home tip; elsewhere, the high crown tip a little more often', homeShare > 0.4 && crown > 0.38, `home ${Math.round(homeShare * 100)}% of landings · crown ${Math.round(crown * 100)}% of the others`);

    const hov = ids.map((i) => dragonflyRoute(visit(i, 60, 'hovering'), { home: 'right_tip', liveliness: 0.5 })).flat();
    const hoverShare = hov.filter((s) => s.mode === 'hovering').length / hov.length;
    check('DF7c a hovering visit drifts in the air from tip to tip, landing only now and then', hoverShare > 0.6 && hoverShare < 0.95, `${Math.round(hoverShare * 100)}% hovering`);

    const cool = ids.map((i) => dragonflyRoute(visit(i, 60), { home: 'left_tip', liveliness: 0 }).length).reduce((a, b) => a + b, 0);
    const hot = ids.map((i) => dragonflyRoute(visit(i, 60), { home: 'left_tip', liveliness: 1 }).length).reduce((a, b) => a + b, 0);
    check('DF7d livelier in warmer air (shorter stays, more flights)', hot > cool * 1.3, `${cool} stops cool / ${hot} hot`);

    const avoided = ids.every((i) => dragonflyRoute(visit(i, 60), { home: 'crown_tip', avoid: ['left_tip', 'left_top'], liveliness: 0.5 }).every((s) => s.perch !== 'left_tip' && s.perch !== 'left_top'));
    check('DF7e deterministic, and it never flies to the tips it must avoid', avoided && JSON.stringify(routes) === JSON.stringify(ids.map((i) => dragonflyRoute(visit(i), { home: 'left_tip', liveliness: 0.5 }))));

    // Through the encounters: a squirrel on the left branch keeps the whole route off the left tips;
    // resting on the sloth makes the sloth its home
    const habitat = (dfId: string, withSloth: boolean): any => ({
      presence: 'visiting',
      visit: { kind: 'squirrel', id: 'sq', startedAt: t0, endsAt: t0 + 10 * MIN, spot: 'left_branch', carrying: null, cause: 'slot', action: null },
      dragonfly: { insideTemp: 26, visit: { id: dfId, startedAt: t0, endsAt: t0 + 30 * MIN, perch: 'right_tip', style: 'perched', route: [] } },
      sloth: withSloth ? { visit: { id: 'sl', startedAt: t0, endsAt: t0 + 40 * MIN, branch: 'right_branch', pose: 'hanging', grip: 'arms' } } : undefined,
    });
    const off = ids.slice(0, 40).map((i) => {
      const h = habitat(`df:${i}`, false);
      applyEncounters(h);
      return h.dragonfly.visit.route as { perch: string }[];
    });
    const onSloth = ids
      .slice(0, 40)
      .map((i) => {
        const h = habitat(`df:${i}`, true);
        applyEncounters(h);
        return h.dragonfly.visit;
      })
      .filter((v) => v.perch === 'on_sloth');
    check(
      "DF7f with the squirrel there its flights never reach the squirrel's tips; resting on the sloth, it keeps returning to the sloth",
      off.every((r) => r.length > 1 && r.every((s) => s.perch !== 'left_tip' && s.perch !== 'left_top')) &&
        onSloth.length > 0 && onSloth.every((v) => v.route[0].perch === 'on_sloth' && v.route.filter((s: any) => s.perch === 'on_sloth').length >= 2),
      `${onSloth.length}/40 on the sloth`
    );
    check('DF7g where it is now: the stop it last arrived at', stopAt(routes[0], routes[0][1]?.at ?? t0)?.at === (routes[0][1]?.at ?? t0) && stopAt(routes[0], t0 - 1) === routes[0][0]);
  }

  console.log('\n— Sunrise and sunset through the loop —');
  {
    const { expressBehaviour } = await import('../src/expression/ExpressionEngine');
    const { evaluatePlantHealth, initialHealthMemory } = await import('../src/health/HealthEngine');
    const { ACTIVE_SPECIES } = await import('../src/species');
    const b = new Bench();
    b.clock = at(16, 8);
    await b.boot();
    await b.run(90, () => day());
    const base = b.state();
    // The same moment with today's sun times placed differently
    const withSun = (now: number, sunrise: number, sunset: number, health = base.health) => {
      const perception = { ...base.perception, sun: { ...base.perception.sun, sunrise, sunset, isDay: now > sunrise && now < sunset, phase: 'day' as const } };
      const behaviour = evaluateBehaviour({ health, perception, episodes: [], events: [], species: ACTIVE_SPECIES, now });
      return { perception, behaviour, expression: expressBehaviour({ behaviour, health, perception, now }) };
    };
    const nine = at(16, 9);
    const june = withSun(nine, at(16, 5, 30), at(16, 19, 50)); // sunrise 05:30: 9:00 is past the morning
    const december = withSun(nine, at(16, 6, 50), at(16, 16, 40)); // sunrise 06:50: still morning at 9:00
    check('TW1 time of day follows the real sunrise / sunset (9:00 is day in June, morning in December)', june.behaviour.timeOfDay === 'day' && december.behaviour.timeOfDay === 'morning', `${june.behaviour.timeOfDay} / ${december.behaviour.timeOfDay}`);
    const evening = withSun(at(16, 15, 0), at(16, 6, 50), at(16, 16, 40));
    check('TW1b evening starts 2 h before the real sunset', evening.behaviour.timeOfDay === 'evening', evening.behaviour.timeOfDay);

    const rise = withSun(nine, nine - 10 * MIN, at(16, 19, 50));
    check('TW2 just after sunrise, calm: the sunrise line, a stretch toward the east, a little livelier', rise.behaviour.dayLine === 'sunrise_greeting' && rise.expression.avatar.gesture?.kind === 'stretch_up' && rise.expression.avatar.gaze === 'east' && rise.behaviour.energy >= june.behaviour.energy, `${rise.behaviour.dayLine}, ${rise.expression.avatar.gesture?.kind}, gaze ${rise.expression.avatar.gaze}, energy ${june.behaviour.energy} → ${rise.behaviour.energy}`);
    const set = withSun(nine, at(16, 5, 30), nine + 15 * MIN);
    check('TW3 before sunset, calm: the sunset line, a yawn toward the west, a softer sway', set.behaviour.dayLine === 'sunset_line' && set.expression.avatar.gesture?.kind === 'yawn' && set.expression.avatar.gaze === 'west' && set.expression.motion.swayAmount < june.expression.motion.swayAmount, `${set.behaviour.dayLine}, ${set.expression.avatar.gesture?.kind}, sway ${june.expression.motion.swayAmount} → ${set.expression.motion.swayAmount}`);
    const thirstyHealth = { ...base.health, condition: 'thirsty' as const, severity: 'moderate' as const };
    const thirstyRise = withSun(nine, nine - 10 * MIN, at(16, 19, 50), thirstyHealth);
    check('TW4 a thirsty tree at sunrise still looks thirsty (no greeting, no stretch)', thirstyRise.behaviour.dayLine !== 'sunrise_greeting' && thirstyRise.expression.avatar.gesture?.kind !== 'stretch_up', `${thirstyRise.behaviour.messageIntent}, ${thirstyRise.expression.avatar.gesture?.kind}`);
    // Health never reads the times: the same perception with the times moved gives the same health
    const h1 = evaluatePlantHealth({ perception: june.perception, species: ACTIVE_SPECIES, memory: initialHealthMemory() }).state;
    const h2 = evaluatePlantHealth({ perception: december.perception, species: ACTIVE_SPECIES, memory: initialHealthMemory() }).state;
    check('TW5 health is identical whatever the sunrise / sunset times', JSON.stringify(h1) === JSON.stringify(h2));
    const overcast = { ...rise.perception, outside: { at: nine, ageMs: 0, sky: 'overcast' as const, code: 3, temperature: 15, humidity: 70, precipitation: 0, cloudCover: 100, wind: 5, gusts: 8, isDay: true, windy: false, rainEndedAt: null } };
    const grey = expressBehaviour({ behaviour: rise.behaviour, health: base.health, perception: overcast, now: nine });
    check('TW6 under an overcast sky the twilight is muted; under a clear one it is not', grey.atmosphere.twilight.muted && !rise.expression.atmosphere.twilight.muted && grey.atmosphere.twilight.event === 'sunrise');
  }

  console.log('\n— Thoughts of the day —');
  {
    // A calm June day, sunrise to dusk: the tree shares a few grounded thoughts, spaced, never repeated
    const b = new Bench();
    b.clock = at(16, 5, 30);
    await b.boot();
    const l = new Listener(b);
    let soil = 70;
    await l.run(14 * 60, (i) => ({ soil: (soil = 70 - i * 0.02), light: i > 60 && i < 12 * 60 ? 55 : 20, temp: 22 + Math.sin(i / 240) * 3, hum: i < 180 ? 80 : 60 }));
    const thoughts = l.spoken.filter((x) => x.reason.startsWith('a thought'));
    const voice = b.state().behaviour.voice;
    const ids = thoughts.map((x) => x.reason.split(': ').pop());
    check('T1 a calm day: several thoughts, within the day budget', thoughts.length >= 2 && thoughts.length <= Math.max(voice.budget, 6), `${thoughts.length} thoughts (budget ${voice.budget}): ${ids.join(' / ')}`);
    check('T1b each thought at most once a day', new Set(ids).size === ids.length);
    const gaps = thoughts.slice(1).map((x, i) => x.t - thoughts[i].t);
    check('T2 spread over the day, never close together (at least 40 min)', gaps.every((g) => g >= 40 * MIN), gaps.map((g) => `${Math.round(g / MIN)}m`).join(', '));
    check('T3 every thought is grounded: its words and its detail', thoughts.every((x) => x.text.length > 0) && !thoughts.some((x) => /\{\w+\}/.test(x.text)), thoughts.map((x) => x.text).join(' | '));

    // A stressed tree talks about its stress, not about its day
    const t = new Bench();
    t.clock = at(17, 8);
    await t.boot();
    const lt = new Listener(t);
    await lt.run(60, () => day());
    lt.reset();
    await lt.run(6 * 60, () => ({ soil: 30 }));
    check('T4 thirsty: no thoughts of the day', !lt.spoken.some((x) => x.reason.startsWith('a thought')) && t.state().behaviour.voice.budget === 0, lt.keys());

    // Energy decides how much it has to say: summer thriving vs winter rest (pure)
    const { evaluateVoice } = await import('../src/behaviour/voice');
    const { ACTIVE_SPECIES } = await import('../src/species');
    const base = b.state();
    const voiceFor = (vitality: number, growth: 'flush' | 'active' | 'slowing' | 'resting') =>
      evaluateVoice({
        health: { ...base.health, vitality },
        perception: base.perception,
        species: ACTIVE_SPECIES,
        intent: 'content',
        timeOfDay: 'day',
        season: { ...base.behaviour.season, growth },
        relationship: base.behaviour.relationship,
        habitat: base.behaviour.habitat,
        canopy: base.behaviour.canopy,
        now: b.clock,
      }).budget;
    const summer = voiceFor(95, 'active');
    const autumn = voiceFor(85, 'slowing');
    const winter = voiceFor(85, 'resting');
    check('T5 the voice follows energy and season: thriving summer > calm autumn > winter rest', summer >= 9 && autumn >= 5 && autumn <= 7 && winter <= 4 && winter >= 2 && summer > autumn && autumn >= winter, `summer ${summer}, autumn ${autumn}, winter ${winter}`);
    const night = evaluateVoice({ health: base.health, perception: base.perception, species: ACTIVE_SPECIES, intent: 'content', timeOfDay: 'night', season: base.behaviour.season, relationship: base.behaviour.relationship, habitat: base.behaviour.habitat, canopy: base.behaviour.canopy, now: b.clock });
    check('T5b at night: no thoughts', night.budget === 0 && night.musings.length === 0);

    // The new thoughts (2026-10-18): each only when its measured condition holds
    type Voice = Parameters<typeof evaluateVoice>[0];
    const sp = ACTIVE_SPECIES;
    const thoughtsIf = (over: { timeOfDay?: Voice['timeOfDay']; readings?: Partial<Voice['perception']['readings']>; recent?: Voice['perception']['recent']; lastWateredAgo?: number }) =>
      evaluateVoice({
        health: { ...base.health, vitality: 90 },
        perception: {
          ...base.perception,
          readings: { ...base.perception.readings, ...over.readings },
          recent: over.recent ?? base.perception.recent,
          care: { ...base.perception.care, lastWatering: over.lastWateredAgo === undefined ? null : ({ timestamp: b.clock - over.lastWateredAgo } as any) },
        },
        species: sp,
        intent: 'content',
        timeOfDay: over.timeOfDay ?? 'day',
        season: base.behaviour.season,
        relationship: base.behaviour.relationship,
        habitat: base.behaviour.habitat,
        canopy: base.behaviour.canopy,
        now: b.clock,
      }).musings.map((m) => m.id);
    const useful = sp.light.usefulMinPercent;
    const sample = (minAgo: number, temp: number, hum: number) => ({ ...base.perception.recent[0], t: b.clock - minAgo * MIN, temp, hum });
    const hourOf = (hum: number) => Array.from({ length: 30 }, (_, i) => sample(i * 2, 22, hum));
    const cooling = [sample(120, 26, 60), ...Array.from({ length: 30 }, (_, i) => sample(110 - i * 3, 25, 60))];
    check(
      'T6 light now: only with useful light by day (not in the evening)',
      thoughtsIf({ readings: { lightPercent: useful + 10 } }).includes('light_now') && !thoughtsIf({ readings: { lightPercent: useful - 5 } }).includes('light_now') && !thoughtsIf({ timeOfDay: 'evening', readings: { lightPercent: useful + 10 } }).includes('light_now')
    );
    check(
      'T6b evening cooling: only in the evening and 2 °C below two hours ago',
      thoughtsIf({ timeOfDay: 'evening', readings: { temperature: 23.5 }, recent: cooling }).includes('evening_cooling') &&
        !thoughtsIf({ timeOfDay: 'evening', readings: { temperature: 25.5 }, recent: cooling }).includes('evening_cooling') &&
        !thoughtsIf({ timeOfDay: 'day', readings: { temperature: 23.5 }, recent: cooling }).includes('evening_cooling')
    );
    check(
      'T6c cool morning: in the morning, within 2 °C above the optimal minimum',
      thoughtsIf({ timeOfDay: 'morning', readings: { temperature: sp.temperature.minOptimal + 1 } }).includes('cool_morning') &&
        !thoughtsIf({ timeOfDay: 'morning', readings: { temperature: sp.temperature.minOptimal + 4 } }).includes('cool_morning') &&
        !thoughtsIf({ timeOfDay: 'morning', readings: { temperature: sp.temperature.minOptimal - 1 } }).includes('cool_morning')
    );
    check(
      'T6d gentle air: humidity optimal for the last hour and the VPD optimal',
      thoughtsIf({ readings: { vpd: 1, humidity: 60 }, recent: hourOf(60) }).includes('air_gentle') &&
        !thoughtsIf({ readings: { vpd: 1, humidity: 60 }, recent: [...hourOf(60).slice(0, 29), sample(40, 22, 85)] }).includes('air_gentle') &&
        !thoughtsIf({ readings: { vpd: 2, humidity: 60 }, recent: hourOf(60) }).includes('air_gentle')
    );
    check(
      'T6e settled after a drink: 3 to 24 h after a watering, soil in range',
      thoughtsIf({ readings: { soilMoisture: 60 }, lastWateredAgo: 5 * HOUR }).includes('settled_after_drink') &&
        !thoughtsIf({ readings: { soilMoisture: 60 }, lastWateredAgo: HOUR }).includes('settled_after_drink') &&
        !thoughtsIf({ readings: { soilMoisture: 60 }, lastWateredAgo: 30 * HOUR }).includes('settled_after_drink') &&
        !thoughtsIf({ readings: { soilMoisture: 30 }, lastWateredAgo: 5 * HOUR }).includes('settled_after_drink')
    );
  }

  console.log('\n— Canopy (the last weeks, drawn only) —');
  {
    const { evaluateCanopy } = await import('../src/behaviour/canopy');
    const { ACTIVE_SPECIES } = await import('../src/species');
    type Ep = import('../src/history/historyTypes').BehaviourEpisode;
    type C = Ep['condition'];
    const H = 60 * MIN;
    let n = 0;
    const ep = (condition: C, startedAt: number, hours: number): Ep => ({
      id: ++n, startedAt, endedAt: startedAt + hours * H, lastSeenAt: startedAt + hours * H, unobservedMs: 0, condition, modifiers: [], peakSeverity: 'none', engineVersion: 't',
    });
    // Ordinary days: awake comfortable, asleep at night
    const calm = (from: number, days: number) => {
      const out: Ep[] = [];
      for (let d = 0; d < days; d++) out.push(ep('comfortable', from + d * 24 * H, 14), ep('sleeping', from + d * 24 * H + 14 * H, 10));
      return out;
    };
    const t0 = new Date(2026, 4, 1, 7).getTime();
    const canopy = (episodes: Ep[], now: number, growth: 'flush' | 'active' | 'slowing' | 'resting' = 'active', events: import('../src/history/historyTypes').PlantEvent[] = []) =>
      evaluateCanopy({ episodes, events, growth, species: ACTIVE_SPECIES, now });

    const full = canopy(calm(t0, 30), t0 + 30 * 24 * H);
    check('C1 a calm month: full canopy', full.fullness === 1 && full.refilling === 0, JSON.stringify(full));
    const passing = canopy([...calm(t0, 10), ep('thirsty', t0 + 10 * 24 * H, 3), ...calm(t0 + 10 * 24 * H + 3 * H, 1)], t0 + 11 * 24 * H + 3 * H);
    check('C2 a passing thirst (3 h) costs no leaves', passing.fullness === 1, `${passing.fullness}`);
    const dryEnd = t0 + 10 * 24 * H + 48 * H;
    const drought = [...calm(t0, 10), ep('very_dry', t0 + 10 * 24 * H, 48)];
    const thin = canopy(drought, dryEnd);
    const nextDay = canopy([...drought, ...calm(dryEnd, 1)], dryEnd + 24 * H);
    check('C3 two days very dry: visibly thinner, still thin the next calm day', thin.fullness <= 0.8 && thin.fullness >= 0.7 && nextDay.fullness < 0.85 && thin.trend === 'thinning', `${thin.fullness} → next day ${nextDay.fullness} (${nextDay.trend})`);
    const summer = canopy([...drought, ...calm(dryEnd, 21)], dryEnd + 21 * 24 * H, 'active');
    const winter = canopy([...drought, ...calm(dryEnd, 21)], dryEnd + 21 * 24 * H, 'resting');
    check('C4 three calm summer weeks: mostly refilled', summer.fullness >= 0.93, `${summer.fullness}`);
    check('C5 the same gap in winter refills much more slowly', winter.fullness < summer.fullness - 0.05, `winter ${winter.fullness} vs summer ${summer.fullness}`);
    const mid = canopy([...drought, ...calm(dryEnd, 6)], dryEnd + 6 * 24 * H);
    check('C5b while refilling, fresh tips show', mid.trend === 'refilling' && mid.refilling > 0.2, `${mid.fullness}, tips ${mid.refilling}`);
    const ordeal = canopy([...calm(t0, 5), ep('very_dry', t0 + 5 * 24 * H, 24 * 10)], t0 + 15 * 24 * H);
    check('C6 never below the floor, however long the ordeal', ordeal.fullness === ACTIVE_SPECIES.canopy.floor, `${ordeal.fullness}`);
    const moveAt = t0 + 10 * 24 * H;
    const moved = canopy(calm(t0, 13), t0 + 13 * 24 * H, 'active', [{ id: 1, timestamp: moveAt, type: 'moved_location', note: null, metadata: {} }]);
    check('C7 a move: a small dip', moved.fullness < 1 && moved.fullness > 0.9, `${moved.fullness}`);
    check('C8 deterministic', JSON.stringify(canopy(drought, dryEnd)) === JSON.stringify(thin));
  }

  console.log('\n— Habitat (visitors) —');
  {
    const { evaluateHabitat, replayHabitat, habitatDiary } = await import('../src/behaviour/habitat');
    type Ep = import('../src/history/historyTypes').BehaviourEpisode;
    type C = Ep['condition'];
    const HOUR = 60 * MIN;
    let id = 0;
    const ep = (condition: C, startedAt: number, hours: number, unobservedMs = 0, open = false): Ep => ({
      id: ++id, startedAt, endedAt: open ? null : startedAt + hours * HOUR, lastSeenAt: startedAt + hours * HOUR, unobservedMs, condition, modifiers: [], peakSeverity: 'none', engineVersion: 't',
    });
    // Days of real life: 14 h awake (comfortable) and 10 h asleep, ending at `end`
    const calmDays = (days: number, end: number, awake: C = 'comfortable') => {
      const out: Ep[] = [];
      for (let t = end - days * 24 * HOUR; t < end; t += 24 * HOUR) out.push(ep(awake, t, 14), ep('sleeping', t + 14 * HOUR, 10));
      return out;
    };
    const habitat = (episodes: Ep[], now: number, condition: C = 'comfortable', modifiers: C[] = [], isDay = true) =>
      evaluateHabitat({ episodes, condition, modifiers, isDay, season: { id: 'summer', energy: 1 }, now });
    // The first minute of the day that holds a visit (visits are rare and fall in slots)
    const firstVisit = (episodes: (t: number) => Ep[], dayStart: number, condition: C = 'comfortable') => {
      for (let t = dayStart + 7 * HOUR; t < dayStart + 18 * HOUR; t += MIN) {
        const h = habitat(episodes(t), t, condition);
        if (h.visit) return { t, h };
      }
      return null;
    };

    const now = at(20, 7);
    check('V1 no history: nobody', habitat([], now).value === 0 && habitat([], now).presence === 'none');
    const one = replayHabitat(calmDays(1, now), now);
    const three = replayHabitat(calmDays(3, now), now);
    check('V2 slow to trust: one calm day is not enough, three are', !one.welcoming && three.welcoming, `1 day ${one.value}, 3 days ${three.value}`);

    const base = calmDays(5, now);
    const after = (c: C, hours: number) => replayHabitat([...base, ep(c, now, hours)], now + hours * HOUR);
    const thirsty1 = after('thirsty', 1);
    const thirsty6 = after('thirsty', 6);
    const dry1 = after('very_dry', 1.5);
    check('V3 quick to leave: a long thirst empties it, a short one does not', thirsty1.welcoming && !thirsty6.welcoming, `1h ${thirsty1.value}, 6h ${thirsty6.value}`);
    check('V3b critical stress empties it fastest', !dry1.welcoming && dry1.value < thirsty1.value, `very dry 1.5h ${dry1.value}`);
    const humid8 = after('high_humidity', 8);
    check('V3c a mild stress drains it slowly', humid8.welcoming && humid8.value < replayHabitat(base, now).value, `humid 8h ${humid8.value}`);

    // Hysteresis: between exit and enter the latch keeps whatever it was
    const falling = replayHabitat([...base, ep('thirsty', now, 2.5)], now + 2.5 * HOUR);
    const rising = replayHabitat(calmDays(2, now), now);
    check(
      'V4 Schmitt trigger: same value band, different history → different answer',
      falling.value < 0.6 && falling.value >= 0.4 && falling.welcoming && rising.value < 0.6 && !rising.welcoming,
      `falling ${falling.value} welcoming=${falling.welcoming}, rising ${rising.value} welcoming=${rising.welcoming}`
    );

    // Unobserved time teaches nothing; sleeping and recovering hold
    const blind = replayHabitat([ep('comfortable', now - 72 * HOUR, 72, 72 * HOUR)], now);
    check('V5 unobserved calm raises nothing', blind.value === 0, `${blind.value}`);
    const held = replayHabitat([...base, ep('recovering', now, 10), ep('sleeping', now + 10 * HOUR, 10)], now + 20 * HOUR);
    check('V5b recovering and sleeping hold it', held.value === replayHabitat(base, now).value, `${replayHabitat(base, now).value} → ${held.value}`);

    // Who shows right now
    const day0 = new Date(2026, 5, 22).getTime();
    const life = (t: number) => [...calmDays(5, day0), ep('comfortable', day0, (t - day0) / HOUR, 0, true)];
    const v = firstVisit(life, day0);
    check('V6 a welcoming calm day has visits', !!v && v.h.presence === 'visiting' && v.h.visit!.endsAt > v.t, v ? `${new Date(v.t).toTimeString().slice(0, 5)} at ${v.h.visit!.spot}` : 'none');
    if (v) {
      const again = habitat(life(v.t), v.t);
      check('V6b deterministic: the same moment gives the same visit', JSON.stringify(again.visit) === JSON.stringify(v.h.visit));
      check('V7 a passing moderate stress: hiding in the leaves', habitat(life(v.t), v.t, 'thirsty').presence === 'hiding');
      check('V7b critical stress: fled, even while the latch holds', habitat(life(v.t), v.t, 'very_dry').presence === 'none');
      check('V8 no trustworthy data (overlay): nobody shown', habitat(life(v.t), v.t, 'comfortable', ['sensor_uncertain']).presence === 'none');
      check('V8b night: nobody', habitat(life(v.t), v.t, 'comfortable', [], false).presence === 'none');
    }
    let visits = 0;
    for (let t = day0 + 6 * HOUR; t < day0 + 19 * HOUR; t += 10 * MIN) if (habitat(life(t), t).visit) visits++;
    check('V9 visits are occasional, not constant', visits > 0 && visits < 30, `${visits} of 78 ten-minute checks`);

    // The real collector: a calm week brings visitors, and the avatar is told
    const b = new Bench();
    for (const e of calmDays(4, b.clock)) {
      const row = b.db.insertEpisode({ startedAt: e.startedAt, condition: e.condition, modifiers: [], peakSeverity: 'none', engineVersion: 't' });
      b.db.closeEpisode(row.id, e.endedAt!);
    }
    await b.boot();
    await b.run(5, () => day());
    const st = b.state();
    check('V10 the collector reads the habitat from stored episodes', st.behaviour.habitat.welcoming && 'visitor' in st.expression, `habitat ${st.behaviour.habitat.value}, ${st.behaviour.habitat.why}`);

    // Play: how the squirrel answers petting comes from the tree's state, and its tail from the tree's sway
    const { visitorPlay } = await import('../src/expression/ExpressionEngine');
    const bh = { ...st.behaviour, afterglow: false, concern: null };
    const lively = { swaySpeed: 1.1, swayAmount: 1.1, flutter: 1, blinkEveryMs: 3000 };
    const tired = { swaySpeed: 0.55, swayAmount: 0.45, flutter: 0.3, blinkEveryMs: 7000 };
    const pThriving = visitorPlay('thriving', 'visiting', bh, lively);
    const pCalm = visitorPlay('comfortable', 'visiting', bh, tired);
    const pShy = visitorPlay('thirsty', 'hiding', bh, tired);
    check(
      'V11 play by state: thriving playful, comfortable gentle, hiding through a stress shy (no hopping)',
      pThriving.kind === 'playful' && pCalm.kind === 'gentle' && pShy.kind === 'shy' && pShy.hopEveryMs === 0 && pThriving.hopEveryMs < pCalm.hopEveryMs && pCalm.returnMs === 10_000,
      `${pThriving.kind} ${pThriving.hopEveryMs}ms · ${pCalm.kind} ${pCalm.hopEveryMs}ms · ${pShy.kind}`
    );
    check(
      'V12 the tail wags in the tree rhythm: a lively tree wags faster and wider than a tired one; shy = small quick flicks',
      pThriving.wag.tempo === lively.swaySpeed && pCalm.wag.tempo === tired.swaySpeed && pThriving.wag.amount > pCalm.wag.amount && pShy.wag.tempo > tired.swaySpeed && pShy.wag.amount < tired.swayAmount,
      `thriving ${JSON.stringify(pThriving.wag)} · calm ${JSON.stringify(pCalm.wag)} · shy ${JSON.stringify(pShy.wag)}`
    );
    const carefulPlay = visitorPlay('comfortable', 'visiting', { ...bh, afterglow: true }, tired);
    check('V12b afterglow: more careful play (slower hops, hides more)', carefulPlay.hopEveryMs > pCalm.hopEveryMs && carefulPlay.hideChance > pCalm.hideChance);
    {
      // Petting never changes the habitat or the visitor (no reward loop)
      const seed = (x: Bench) => {
        for (const e of calmDays(4, x.clock)) {
          const row = x.db.insertEpisode({ startedAt: e.startedAt, condition: e.condition, modifiers: [], peakSeverity: 'none', engineVersion: 't' });
          x.db.closeEpisode(row.id, e.endedAt!);
        }
      };
      const plain = new Bench();
      const petted = new Bench();
      seed(plain);
      seed(petted);
      await plain.boot();
      await petted.boot();
      for (let i = 0; i < 120; i++) {
        await plain.poll(day());
        if (i % 5 === 0) petted.collector.recordInteraction({ kind: 'pet', startedAt: petted.clock - 40_000, endedAt: petted.clock, count: 6, activeMs: 30_000 });
        await petted.poll(day());
      }
      const a = plain.state();
      const z = petted.state();
      // Play only makes it bolder (how it plays): never more visits, other times or another habitat
      const noBold = (h: typeof a.behaviour.habitat) => JSON.stringify({ ...h, memory: { ...h.memory, boldness: 0 } });
      const noPlay = (v: typeof a.expression.visitor) => JSON.stringify(v ? { ...v, play: null } : null);
      check(
        'V13 petting changes nothing in the habitat (drey, visits, trust, habits included) or the visitor, only its boldness',
        noBold(a.behaviour.habitat) === noBold(z.behaviour.habitat) && noPlay(a.expression.visitor) === noPlay(z.expression.visitor),
        `habitat ${a.behaviour.habitat.value} vs ${z.behaviour.habitat.value} · boldness ${a.behaviour.habitat.memory.boldness} vs ${z.behaviour.habitat.memory.boldness}`
      );
    }

    // ---- The drey: weeks of a welcoming tree, made visible ----
    {
      const t0 = new Date(2026, 5, 30, 7).getTime();
      const drey = (days: number) => replayHabitat(calmDays(days, t0), t0).drey;
      const d4 = drey(4);
      const d9 = drey(9);
      const d18 = drey(18);
      check('V14 the drey takes weeks: none after 4 calm days, a few twigs after ~9, built after ~18', d4.stage === 'none' && d9.stage === 'started' && d18.stage === 'built', `4d ${d4.value} ${d4.stage} · 9d ${d9.value} ${d9.stage} · 18d ${d18.value} ${d18.stage}`);
      const hard = (hours: number) => {
        const eps = [...calmDays(18, t0), ep('very_dry', t0, hours)];
        return replayHabitat(eps, t0 + hours * HOUR).drey;
      };
      const h1 = hard(24);
      const h7 = hard(24 * 7);
      check('V15 a long stress thins it, a sustained one empties it (days, not hours)', h1.stage === 'built' && h1.value < d18.value && h7.stage === 'none', `1 day ${h1.value} ${h1.stage} · 7 days ${h7.value} ${h7.stage}`);
      const night = new Date(2026, 5, 30, 1).getTime();
      const asleep = evaluateHabitat({ episodes: [...calmDays(18, night - 2 * HOUR), ep('sleeping', night - 2 * HOUR, 2, 0, true)], condition: 'sleeping', modifiers: [], isDay: false, season: { id: 'summer', energy: 1 }, now: night });
      const noDrey = evaluateHabitat({ episodes: [...calmDays(4, night - 2 * HOUR), ep('sleeping', night - 2 * HOUR, 2, 0, true)], condition: 'sleeping', modifiers: [], isDay: false, season: { id: 'summer', energy: 1 }, now: night });
      const unsure = evaluateHabitat({ episodes: [...calmDays(18, night - 2 * HOUR), ep('sleeping', night - 2 * HOUR, 2, 0, true)], condition: 'sleeping', modifiers: ['sensor_uncertain'], isDay: false, season: { id: 'summer', energy: 1 }, now: night });
      check('V16 at night: asleep in a built drey; no drey → nobody; no trustworthy data → nobody', asleep.presence === 'sleeping' && asleep.visit?.cause === 'drey' && noDrey.presence === 'none' && unsure.presence === 'none', `${asleep.presence} / ${noDrey.presence} / ${unsure.presence}`);
    }

    // ---- Shelter from the outside weather (context: the habitat never sees it) ----
    if (v) {
      const at = v.t;
      const dry = habitat(life(at), at);
      const wet = evaluateHabitat({ episodes: life(at), condition: 'comfortable', modifiers: [], isDay: true, season: { id: 'summer', energy: 1 }, now: at, outside: { sky: 'rain', rainEndedAt: null } });
      check('V17 rain outside: it shelters in the leaves; the habitat value and drey are identical', dry.presence === 'visiting' && wet.presence === 'hiding' && wet.value === dry.value && wet.welcoming === dry.welcoming && JSON.stringify(wet.drey) === JSON.stringify(dry.drey), wet.why);
      const after = evaluateHabitat({ episodes: life(at), condition: 'comfortable', modifiers: [], isDay: true, season: { id: 'summer', energy: 1 }, now: at, outside: { sky: 'overcast', rainEndedAt: at - 10 * MIN } });
      check('V17b just after the rain: out again, shaking off', after.presence === 'visiting' && after.visit?.action === 'shake_off', after.why);
      const coming = evaluateHabitat({ episodes: life(at), condition: 'comfortable', modifiers: [], isDay: true, season: { id: 'summer', energy: 1 }, now: at, outside: { sky: 'clear', rainEndedAt: null, weatherComing: true } });
      const steady = evaluateHabitat({ episodes: life(at), condition: 'comfortable', modifiers: [], isDay: true, season: { id: 'summer', energy: 1 }, now: at, outside: { sky: 'clear', rainEndedAt: null, weatherComing: false } });
      check(
        'PA3 the weather coming (the barometer falling fast for a while) under a clear sky: it tucks into the leaves before the weather; without it nothing changes; the habitat value is identical',
        coming.presence === 'hiding' && steady.presence === 'visiting' && coming.value === dry.value && coming.welcoming === dry.welcoming,
        `${coming.why} / ${steady.presence}`
      );
    }

    // ---- Answers to care ----
    {
      const at = new Date(2026, 5, 22, 13, 7).getTime();
      const eps = life(at);
      const care = (kind: Parameters<typeof evaluateHabitat>[0]['reaction'] extends infer R ? R extends { kind: infer K } ? K : never : never, ageMin: number, condition: C = 'comfortable', seasonal: string | null = null, episodes = eps) =>
        evaluateHabitat({ episodes, condition, modifiers: [], isDay: true, season: { id: 'summer', energy: 1 }, now: at, reaction: { kind, eventId: 42, at: at - ageMin * MIN, seasonal } });
      const drink = care('watering_relief', 3);
      check('V18 after a needed watering on a calm, welcoming tree: it comes down to drink (one visit per event)', drink.visit?.cause === 'care' && drink.visit.action === 'drinking' && drink.visit.spot === 'pot_rim' && drink.visit.id === 'care:42', drink.why);
      check('V18b watering on wet soil gets no answer (more water is never rewarded)', care('watering_enough', 3).visit?.cause !== 'care');
      check('V18c the answer passes: 20 min later it is an ordinary day again', care('watering_relief', 20).visit?.cause !== 'care');
      const prune = care('care_pruning', 5);
      check('V19 after a pruning it inspects the cut; off-season only briefly', prune.visit?.action === 'inspecting' && care('care_pruning', 5, 'comfortable', 'resting_prune').visit?.cause !== 'care', prune.why);
      check('V19b a stressed tree or a place that is not welcoming yet: no answer', care('watering_relief', 3, 'thirsty').visit?.cause !== 'care' && care('watering_relief', 3, 'comfortable', null, calmDays(1, at)).visit === null);
    }

    // ---- The diary ----
    {
      const end = new Date(2026, 6, 20, 20).getTime();
      // Three calm weeks, a week of drought, then calm again
      const story = [...calmDays(21, end - 14 * 24 * HOUR), ep('very_dry', end - 14 * 24 * HOUR, 24 * 7), ...calmDays(7, end)];
      const diary = (now = end) =>
        habitatDiary({ episodes: story.filter((e) => e.startedAt < now), now, days: 30, location: { latitude: 33.97, longitude: 35.73 }, seasonAt: () => ({ id: 'summer', energy: 1 }) });
      const items = diary();
      const kinds = new Set(items.map((i) => i.habitat));
      check(
        'V20 diary: visits, staying away during the drought, coming back, the drey built and abandoned',
        kinds.has('visit') && kinds.has('left') && kinds.has('returned') && kinds.has('drey_built') && kinds.has('drey_gone'),
        [...kinds].join(', ')
      );
      check('V20b the diary is deterministic', JSON.stringify(diary()) === JSON.stringify(items));
      const left = items.find((i) => i.habitat === 'left');
      check('V20c staying away names what the tree went through', /very dry/i.test(left?.detail ?? ''), left?.detail);
    }

    // ---- The squirrel as an individual: trust in stages, habits, boldness ----
    {
      const { squirrelLife } = await import('../src/behaviour/habitat');
      const { APP_CONFIG } = await import('../src/config/appConfig');
      const t0 = new Date(2026, 6, 1, 7).getTime();
      const ORDER = ['none', 'traces', 'peeking', 'visiting', 'settled'];
      const stages = Array.from({ length: 12 }, (_, i) => replayHabitat(calmDays(i + 1, t0), t0).stage);
      const firstDay = (st: string) => stages.indexOf(st as never) + 1;
      check(
        'V21 trust in stages over calm days: traces → peeking → visiting → settled, never backwards',
        stages.every((x, i) => i === 0 || ORDER.indexOf(x) >= ORDER.indexOf(stages[i - 1])) && ['traces', 'peeking', 'visiting', 'settled'].every((x) => stages.includes(x as never)),
        stages.map((x, i) => `${i + 1}d ${x}`).join(' · ')
      );
      // Live: signs before the first visits; the first visits are peeks, and a peeking squirrel doesn't
      // come down for care yet
      const scan = (days: number, want: 'traces' | 'visit', condition: C = 'comfortable') => {
        const d0 = new Date(2026, 6, 1).getTime() + days * 24 * HOUR;
        for (let t = d0 + 7 * HOUR; t < d0 + 19 * HOUR; t += 2 * MIN) {
          const eps = [...calmDays(days, d0 + 7 * HOUR), ep('comfortable', d0 + 7 * HOUR, (t - d0 - 7 * HOUR) / HOUR, 0, true)];
          const h = evaluateHabitat({ episodes: eps, condition, modifiers: [], isDay: true, season: { id: 'summer', energy: 1 }, now: t });
          if (want === 'visit' ? h.visit : h.traces) return { t, eps, h };
        }
        return null;
      };
      const tr = scan(firstDay('traces'), 'traces');
      const pk = scan(firstDay('peeking'), 'visit');
      const peekCare = pk && evaluateHabitat({ episodes: pk.eps, condition: 'comfortable', modifiers: [], isDay: true, season: { id: 'summer', energy: 1 }, now: pk.t, reaction: { kind: 'watering_relief', eventId: 7, at: pk.t - 2 * MIN, seasonal: null } });
      check(
        'V21b live: first only its traces (nobody there), then peeks from the leaves; a peeking squirrel does not come down to drink',
        !!tr && tr.h.traces !== null && tr.h.visit === null && !!pk && pk.h.presence === 'peeking' && peekCare?.visit?.cause !== 'care',
        `${tr?.h.traces} / ${pk?.h.presence} ${pk?.h.why} / care ${peekCare?.visit?.cause ?? 'none'}`
      );

      // Broken trust: settled, then a day of drought; back it only peeks, and settling takes longer
      const firstSettled = firstDay('settled');
      const story = (n: number) => [...calmDays(14, t0), ep('very_dry', t0, 24), ...calmDays(n, t0 + 24 * HOUR + n * 24 * HOUR)];
      const after = (n: number) => replayHabitat(story(n), t0 + 24 * HOUR + n * 24 * HOUR);
      const back = Array.from({ length: 16 }, (_, i) => after(i + 1));
      const firstBack = back.find((x) => x.welcoming);
      const settledAgain = back.findIndex((x) => x.stage === 'settled') + 1;
      check(
        'V22 broken trust: after a drought it comes back warily (peeking first), and settles later than the first time',
        !!firstBack && firstBack.stage === 'peeking' && firstBack.brokenAt !== null && (settledAgain === 0 || settledAgain > firstSettled),
        `first settled after ${firstSettled} days · back: ${back.map((x) => x.stage).join(',')}`
      );
      const diary = habitatDiary({ episodes: story(16), now: t0 + 17 * 24 * HOUR, days: 30, location: { latitude: null, longitude: null }, seasonAt: () => ({ id: 'summer', energy: 1 }) });
      const tags = new Set(diary.map((i) => i.habitat));
      check('V22b diary: its traces, first peeks, settling in and the wary return', tags.has('traces') && tags.has('peek') && tags.has('settled') && tags.has('wary'), [...tags].join(', '));

      // Habits: visits gather around its usual hour and its favourite spot (against the habit-free life)
      const end = new Date(2026, 6, 20, 7).getTime();
      const eps = calmDays(16, end);
      const daytime = (t: number) => new Date(t).getHours() >= 7 && new Date(t).getHours() < 21;
      const lifeOf = () => squirrelLife(eps, end, replayHabitat(eps, end, true), daytime, () => ({ id: 'summer', energy: 1 }));
      const withHabits = lifeOf();
      const H = APP_CONFIG.habitat.habits as any;
      const saved = { ...H };
      Object.assign(H, { nearHour: 1, otherHours: 1, favouriteBase: 0, favouritePerTrust: 0 });
      const plainLife = lifeOf();
      Object.assign(H, saved);
      const { usualHour, favouriteSpot } = withHabits.habits;
      const recent = (l: typeof withHabits) => l.visits.filter((v) => v.startedAt >= end - 6 * 24 * HOUR);
      const hourOf = (t: number) => new Date(t).getHours() + new Date(t).getMinutes() / 60;
      const share = (l: typeof withHabits, f: (v: (typeof l.visits)[number]) => boolean) => recent(l).filter(f).length / Math.max(1, recent(l).length);
      const near = (l: typeof withHabits) => share(l, (v) => Math.abs(hourOf(v.startedAt) - (usualHour ?? -9)) <= 1.25);
      const fav = (l: typeof withHabits) => share(l, (v) => v.spot === favouriteSpot);
      check(
        'V23 habits from its own past visits: more visits around its usual hour and on its favourite spot; deterministic',
        usualHour !== null && favouriteSpot !== null && near(withHabits) > near(plainLife) && fav(withHabits) > fav(plainLife) && JSON.stringify(lifeOf()) === JSON.stringify(withHabits),
        `usual ${usualHour}h, ${favouriteSpot} · near ${near(plainLife).toFixed(2)} → ${near(withHabits).toFixed(2)} · favourite ${fav(plainLife).toFixed(2)} → ${fav(withHabits).toFixed(2)}`
      );

      // Boldness: play during its visits makes it bolder, and changes nothing else
      const now = end + 6 * HOUR;
      const live = [...eps, ep('comfortable', end, 6, 0, true)];
      const lifeNow = squirrelLife(live, now, replayHabitat(live, now, true), daytime, () => ({ id: 'summer', energy: 1 }));
      const pets = lifeNow.visits.filter((v) => v.presence === 'visiting' && v.stage !== 'peeking').slice(-8).map((v, i) => ({ id: i + 1, kind: 'pet' as const, startedAt: v.startedAt + MIN, endedAt: v.startedAt + 2 * MIN, count: 8, metadata: {} }));
      const ask = (interactions: typeof pets) => evaluateHabitat({ episodes: live, condition: 'comfortable', modifiers: [], isDay: true, season: { id: 'summer', energy: 1 }, now, interactions });
      const shy = ask([]);
      const bold = ask(pets);
      const noBold = (h: typeof shy) => JSON.stringify({ ...h, memory: { ...h.memory, boldness: 0 } });
      check('V24 play during its visits makes it bolder, and changes nothing else (visits, trust, habits)', pets.length > 0 && bold.memory.boldness > shy.memory.boldness && noBold(bold) === noBold(shy), `${pets.length} play sessions · boldness ${shy.memory.boldness} → ${bold.memory.boldness}`);
      const { visitorPlay } = await import('../src/expression/ExpressionEngine');
      const motion = { swaySpeed: 1, swayAmount: 1, flutter: 1, blinkEveryMs: 4000 };
      const asB = (b: number) => visitorPlay('comfortable', 'visiting', { habitat: { memory: { boldness: b } }, afterglow: false, concern: null } as any, motion);
      check('V24b a bold squirrel hops sooner and hides less; a peeking one only ducks', asB(0.9).hopEveryMs < asB(0.2).hopEveryMs && asB(0.9).hideChance < asB(0.2).hideChance && visitorPlay('comfortable', 'peek', {} as any, motion).kind === 'shy');
    }

  }

  console.log('\n— Mood: its own layer, anchored by health —');
  {
    const { evaluateMood, MOOD_POINT } = await import('../src/behaviour/mood');
    const { ACTIVE_SPECIES } = await import('../src/species');
    const calmB = new Bench();
    await calmB.boot();
    await calmB.run(60, () => day());
    const calm = calmB.state();
    const dryB = new Bench();
    await dryB.boot();
    await dryB.run(120, (i) => (i < 30 ? day() : { soil: 28 }));
    const dry = dryB.state();
    type St = typeof calm;
    const now = calm.behaviour.evaluatedAt;
    const pet = (at: number) => ({ id: 1, kind: 'pet' as const, startedAt: at - 60_000, endedAt: at, count: 12, metadata: {} });
    const sky = (sky: string) => ({ at: now, sky, code: 0, temperature: 15, humidity: 80, precipitation: 0, cloudCover: 100, wind: 5, gusts: 10, isDay: true, windy: false, ageMs: 0, rainEndedAt: null });
    const visiting = (h: St['behaviour']['habitat']) => ({ ...h, presence: 'visiting' as const, visit: { kind: 'squirrel' as const, id: 'x', startedAt: now - 60_000, endsAt: now + 300_000, spot: 'crown' as const, carrying: null, cause: 'slot' as const, action: null } });
    const mood = (st: St, o: { interactions?: any[]; habitat?: any; outside?: any; memory?: any; base?: any; at?: number } = {}) =>
      evaluateMood({
        base: o.base ?? st.behaviour.moodState.base,
        forced: false,
        condition: st.health.condition,
        modifiers: st.health.modifiers,
        concern: !!st.behaviour.concern,
        perception: o.outside !== undefined ? { ...st.perception, outside: o.outside } : st.perception,
        species: ACTIVE_SPECIES,
        interactions: o.interactions ?? [],
        events: [],
        habitat: o.habitat ?? st.behaviour.habitat,
        twilight: { event: null, minutes: null },
        seasonEnergy: 1,
        memory: o.memory ?? null,
        now: o.at ?? st.behaviour.evaluatedAt,
      });
    const dryNow = dry.behaviour.evaluatedAt;
    const spoiled = mood(dry, { interactions: [pet(dryNow), pet(dryNow - 5 * MIN)], habitat: visiting(dry.behaviour.habitat), outside: sky('rain') });
    check(
      'MO1 anchored: a thirsty tree petted, visited and in cosy rain is comforted, never happy',
      dry.health.condition === 'thirsty' && spoiled.target.valence <= spoiled.ceiling && !['joyful', 'content', 'grateful', 'relieved'].includes(spoiled.label),
      `${dry.health.condition}: ${spoiled.label} v${spoiled.valence} (ceiling ${spoiled.ceiling})`
    );
    const plain = mood(calm);
    const petted = mood(calm, { interactions: [pet(now)] });
    const later = mood(calm, { interactions: [pet(now - 4 * 60 * MIN)] });
    check('MO2 petting warms a calm tree, and it fades within hours', petted.valence > plain.valence && later.valence === plain.valence, `${plain.valence} → ${petted.valence} → 4 h later ${later.valence}`);
    // Inertia: from content to a stressed anchor falls fast; from distressed to content rises slowly
    const [cv, ca] = MOOD_POINT.content;
    const [dv, da] = MOOD_POINT.distressed;
    const fall = mood(dry, { memory: { valence: cv, arousal: ca, label: 'content', at: dryNow - 5 * MIN } });
    const rise = mood(calm, { memory: { valence: dv, arousal: da, label: 'distressed', at: now - 5 * MIN } });
    const fellBy = (cv - fall.valence) / (cv - fall.target.valence);
    const roseBy = (rise.valence - dv) / (rise.target.valence - dv);
    check('MO3 inertia: in 5 minutes a stress pulls the mood down fast; recovery lifts it slowly', fellBy > roseBy && fellBy < 1 && roseBy > 0, `fell ${Math.round(fellBy * 100)}% of the way, rose ${Math.round(roseBy * 100)}%`);
    // Hysteresis: the same point between content and tired keeps whichever label it already had
    const mid = { valence: (MOOD_POINT.content[0] + MOOD_POINT.tired[0]) / 2 - 0.01, arousal: (MOOD_POINT.content[1] + MOOD_POINT.tired[1]) / 2 };
    const asContent = mood(calm, { memory: { ...mid, label: 'content', at: now } });
    const asTired = mood(calm, { memory: { ...mid, label: 'tired', at: now } });
    check('MO4 the label has hysteresis: between two moods it keeps the one it had', asContent.label === 'content' && asTired.label === 'tired', `${asContent.label} / ${asTired.label}`);
    const company = mood(calm, { habitat: visiting(calm.behaviour.habitat) });
    check('MO5 a visitor\'s company lifts the mood a little', company.valence > plain.valence && company.valence - plain.valence <= 0.1 + 1e-9, `${plain.valence} → ${company.valence}`);
    const storm = mood(calm, { outside: sky('thunderstorm') });
    const rain = mood(calm, { outside: sky('rain') });
    check('MO6 a storm outside unsettles a calm tree, rain makes it cosy (lower arousal)', storm.valence < plain.valence && storm.arousal > plain.arousal && rain.arousal < plain.arousal && rain.valence >= plain.valence, `storm v${storm.valence} a${storm.arousal} · rain v${rain.valence} a${rain.arousal} · none v${plain.valence} a${plain.arousal}`);
    // Restart: the mood memory is persisted, so a restart doesn't reset it
    const x = new Bench();
    const y = new Bench();
    await x.boot();
    await y.boot();
    await x.run(40, () => day());
    await y.run(20, () => day());
    y.collector.stop();
    await y.boot();
    await y.run(20, () => day());
    check('MO7 a restart keeps the mood where it was', JSON.stringify(x.state().behaviour.moodState) === JSON.stringify(y.state().behaviour.moodState), `${x.state().behaviour.mood} v${x.state().behaviour.moodState.valence} / ${y.state().behaviour.mood} v${y.state().behaviour.moodState.valence}`);
  }

  console.log('\n— Visitors with a memory: the sloth\'s loyalty, the dragonfly\'s territory, restarts —');
  {
    const { slothMemory, slothLife, withLoyalty, NO_SLOTH_MEMORY } = await import('../src/behaviour/sloth');
    const { evaluateDragonfly, territoryOf } = await import('../src/behaviour/dragonfly');
    const { replayAir } = await import('../src/behaviour/wanderer');
    const { dayKeyOf } = await import('../src/behaviour/habitat');
    const { ACTIVE_SPECIES } = await import('../src/species');
    const DAY = 24 * 60 * MIN;
    const cad = 3 * MIN;
    const smp = (t: number, temp = 26, hum = 70, light = 50) => ({ t, soil: 60, soilRaw: null, temp, hum, light, radiation: null, lightRaw: null, isDay: true, lightExpected: true });
    const air = (from: number, minutes: number, temp = 26, hum = 70) => Array.from({ length: minutes }, (_, i) => smp(from + i * MIN, temp, hum));

    // Loyalty from its days: a week with it makes it loyal with a home branch; days away fade it
    const d0 = new Date(2026, 6, 1).getTime();
    const week = Array.from({ length: 7 }, (_, i) => ({ day: d0 + i * DAY, minutes: 200, spots: { left_branch: 150, right_branch: 50 } }));
    const loyal = slothMemory(week, d0 + 7 * DAY);
    const faded = slothMemory(week, d0 + 14 * DAY);
    check('SL8 a week of long days makes the sloth loyal, with a home branch; a week away fades it', loyal.loyalty > 0.6 && loyal.homeBranch === 'left_branch' && faded.loyalty < loyal.loyalty / 2 && slothMemory([], d0).loyalty === 0, `loyal ${loyal.loyalty} (${loyal.homeBranch}) · a week later ${faded.loyalty}`);
    check('SL8b no loyalty: exactly the plain sloth', withLoyalty(NO_SLOTH_MEMORY) === withLoyalty(null));

    // Slow to give up: through a 90-min cool spell a loyal sloth stays, a new one leaves
    const t0 = new Date(2026, 6, 8, 9).getTime();
    const spell = [...air(t0, 4 * 60), ...air(t0 + 240 * MIN, 90, 18)];
    const stays = replayAir(withLoyalty(loyal), spell, [], ACTIVE_SPECIES, cad, t0 + 330 * MIN);
    const leaves = replayAir(withLoyalty(NO_SLOTH_MEMORY), spell, [], ACTIVE_SPECIES, cad, t0 + 330 * MIN);
    check('SL8c through a 90-min cool spell a loyal sloth holds on; a new one leaves', stays.active && !leaves.active, `loyal ${stays.value} / new ${leaves.value}`);

    // Its days, each with the loyalty of the days before: it comes to hang on its home branch
    const days = Array.from({ length: 10 }, (_, k) => air(d0 + k * DAY + 8 * 60 * MIN, 12 * 60)).flat();
    const life = slothLife(days, [], [], ACTIVE_SPECIES, cad, d0 + 10 * DAY, 10);
    const late = life.days.slice(-3);
    const home = life.memory.homeBranch!;
    const onHome = late.reduce((a, d) => a + (d.spots[home] ?? 0), 0) / Math.max(1, late.reduce((a, d) => a + d.minutes, 0));
    const longer = late.reduce((a, d) => a + d.minutes / d.count, 0) / late.length > life.days[0].minutes / life.days[0].count;
    check('SL8d after a week its visits are mostly on its home branch, and longer', life.memory.loyalty > 0.6 && onHome > 0.7 && longer, `loyalty ${life.memory.loyalty}, ${Math.round(onHome * 100)}% of the last days on the ${home.replace('_', ' ')}`);

    // The dragonfly: a territory for the day, no memory across days
    const perches = (k: number) => {
      const from = new Date(2026, 6, 1 + k, 9).getTime();
      const samples = air(from, 9 * 60, 26, 50);
      const seen: string[] = [];
      for (let m = 60; m < 9 * 60; m += 2) {
        const v = evaluateDragonfly({ samples: samples.filter((x) => x.t <= from + m * MIN), outsideToday: [], species: ACTIVE_SPECIES, cadenceMs: cad, condition: 'comfortable', modifiers: [], isDay: true, insideTemp: 26, now: from + m * MIN });
        if (v.visit && seen[seen.length - 1] !== v.visit.id) seen.push(v.visit.id, v.visit.perch);
      }
      const visits = seen.filter((_, i) => i % 2 === 1);
      return { home: territoryOf(dayKeyOf(from)), share: visits.filter((p) => p === territoryOf(dayKeyOf(from))).length / Math.max(1, visits.length), n: visits.length };
    };
    const tdays = Array.from({ length: 10 }, (_, k) => perches(k));
    check(
      'DF8 the dragonfly holds a tip as its own for the day (most visits start there); another day, maybe another tip',
      tdays.every((d) => d.n > 0 && d.share >= 0.5) && new Set(tdays.map((d) => d.home)).size > 1,
      tdays.map((d) => `${d.home} ${Math.round(d.share * 100)}%/${d.n}`).join(' · ')
    );

    // Restart: the memories are derived, so a restart changes nothing
    {
      type Ep = Parameters<typeof import('../src/behaviour/habitat').replayHabitat>[0][number];
      const seed = (x: Bench) => {
        for (let t = x.clock - 9 * DAY; t < x.clock; t += DAY) {
          for (const [c, s, h] of [['comfortable', t, 14], ['sleeping', t + 14 * 60 * MIN, 10]] as [Ep['condition'], number, number][]) {
            const row = x.db.insertEpisode({ startedAt: s, condition: c, modifiers: [], peakSeverity: 'none', engineVersion: 't' });
            x.db.closeEpisode(row.id, s + h * 60 * MIN);
          }
        }
      };
      const a = new Bench();
      const b = new Bench();
      seed(a);
      seed(b);
      await a.boot();
      await b.boot();
      await a.run(20, () => day());
      await b.run(10, () => day());
      b.collector.stop();
      await b.boot();
      await b.run(10, () => day());
      const ma = a.state().behaviour.habitat;
      const mb = b.state().behaviour.habitat;
      check('V25 a restart keeps the squirrel\'s trust, stage and habits and the sloth\'s loyalty (all derived)', JSON.stringify(ma.memory) === JSON.stringify(mb.memory) && JSON.stringify(ma.sloth?.memory) === JSON.stringify(mb.sloth?.memory), `${ma.memory.stage} trust ${ma.memory.trust} usual ${ma.memory.usualHour}h · sloth ${ma.sloth?.memory.loyalty}`);
    }
  }

  console.log('\n— Lucy (the household dog by the pot) —');
  {
    const { lucyDay, lucyWeather, lucyPhase, evaluateLucy, lucyDiary } = await import('../src/behaviour/lucy');
    const wx = (from: number, n: number, sky: string, temperature: number | null = 18, gusts = 10) =>
      Array.from({ length: n }, (_, k) => ({ at: from + k * 15 * MIN, sky, code: 0, temperature, humidity: 70, precipitation: sky.includes('rain') ? 2 : 0, cloudCover: 50, wind: gusts / 2, gusts, isDay: true })) as any[];
    const ev = (now: number, o: Partial<Parameters<typeof evaluateLucy>[0]> = {}) => evaluateLucy({ outsideToday: [], rainEndedAt: null, condition: 'comfortable', modifiers: [], now, ...o });

    // LU1: 4–6 visits every day of a year, never overlapping (the night one included)
    let badCount = 0;
    let overlaps = 0;
    let nights = 0;
    for (let d = 0; d < 365; d++) {
      const p = lucyDay(new Date(2026, 0, 1 + d, 12).getTime());
      const dayVisits = p.visits.filter((v) => v.kind === 'day').length;
      if (dayVisits !== 10) badCount++;
      for (let i = 1; i < p.visits.length; i++) if (p.visits[i].startedAt < p.visits[i - 1].endsAt) overlaps++;
      if (p.visits.some((v) => v.kind === 'night')) nights++;
    }
    check('LU1 10 visits every day of a year, never overlapping', badCount === 0 && overlaps === 0, `${badCount} days off count, ${overlaps} overlaps`);
    check('LU2 most nights on her pillow (≈ 85 %)', nights / 365 > 0.75 && nights / 365 < 0.95, `${nights}/365 nights`);
    const p22 = lucyDay(at(22, 12));
    const night = lucyDay(at(23, 12)).visits.find((v) => v.kind === 'night') ?? p22.visits.find((v) => v.kind === 'night');
    const mid = night ? night.startedAt + 3 * HOUR : 0;
    check('LU2b a night visit runs past midnight and is the same visit before and after it', !!night && ev(mid).visit?.id === night.id && ['sleeping', 'down'].includes(ev(mid).presence) && ev(night.startedAt + 30 * MIN).visit?.id === night.id, night?.id);

    // LU3: poses only move one way through a visit
    const order = ['walking', 'sitting', 'down', 'sleeping'];
    let backward = 0;
    let slept = 0;
    for (const settle of [0, 0.3, 0.5, 0.8, 1]) {
      const s0 = at(22, 13);
      const end = s0 + 45 * MIN;
      let rank = 0;
      for (let t = s0; t < end - 1.5 * MIN; t += MIN) {
        const r = order.indexOf(lucyPhase('day', s0, end, settle, t, false).pose);
        if (r < rank) backward++;
        rank = Math.max(rank, r);
      }
      if (rank === 3) slept++;
    }
    check('LU3 walking in → sitting → down → asleep, never back up; restless visits stay awake', backward === 0 && slept >= 1 && slept < 5 && lucyPhase('day', at(22, 13), at(22, 13) + 45 * MIN, 0.8, at(22, 13) + 44 * MIN, false).pose === 'walking', `${backward} steps back, ${slept}/5 settle levels fell asleep`);

    // LU4: the weather latches have hysteresis (no flapping at a threshold, no blocking either)
    const t0 = at(22, 6);
    const temps = [...Array.from({ length: 8 }, (_, k) => (k % 2 ? 31 : 29.5)), ...Array.from({ length: 8 }, (_, k) => (k % 2 ? 27.5 : 29)), 25, 25, 25, 25];
    const series = temps.map((temperature, k) => ({ ...wx(t0 + k * 15 * MIN, 1, 'clear', temperature)[0] }));
    const flips: boolean[] = series.map((o) => lucyWeather(series, o.at).heat);
    const switches = flips.filter((h, i) => i > 0 && h !== flips[i - 1]).length;
    check('LU4 heat: hovering at the entry turns it on, hovering above the exit keeps it, a real cool-down ends it (2 switches)', switches === 2 && flips[7] && flips[15] && !flips[19], flips.map((f) => (f ? 'H' : '.')).join(''));

    // LU5: the weather never moves her visits (it only changes how she spends them)
    const ids = (obs: any[]) => {
      const seen = new Set<string>();
      for (let t = at(22, 6); t < at(22, 22); t += 5 * MIN) {
        const v = ev(t, { outsideToday: obs.filter((o) => o.at <= t) }).visit;
        if (v && v.kind === 'day') seen.add(`${v.id}@${v.startedAt}`);
      }
      return [...seen].join(',');
    };
    const clearDay = wx(at(22, 0), 96, 'clear', 22);
    const rainyDay = wx(at(22, 0), 96, 'rain', 12);
    check('LU5 the same visits at the same times on a clear and on a rainy day', ids(clearDay) === ids(rainyDay) && ids(clearDay).length > 0, ids(clearDay));
    const firstDay = p22.visits.find((v) => v.kind === 'day')!;
    const into = firstDay.startedAt + 6 * MIN;
    const hot = ev(into, { outsideToday: wx(at(22, 0), 96, 'clear', 33) });
    const cold = ev(into, { outsideToday: wx(at(22, 0), 96, 'overcast', 4) });
    check('LU5b heat: she rests on the cool floor, panting; cold: on her pillow', hot.visit?.rest === 'floor_left' && hot.visit.cue === 'panting' && cold.visit?.rest === 'pillow', `heat ${hot.visit?.rest}/${hot.visit?.cue} · cold ${cold.visit?.rest}`);

    // LU6: a struggling tree: she stays close, longer, with check-ins, awake
    const stressed = ev(into, { condition: 'very_dry' });
    const calm = ev(into);
    const longer = stressed.visit && calm.visit ? (stressed.visit.endsAt - stressed.visit.startedAt) / (calm.visit.endsAt - calm.visit.startedAt) : 0;
    let checks = 0;
    let asleepWhileStressed = 0;
    for (let t = at(22, 6); t < at(22, 22); t += 5 * MIN) {
      const v = ev(t, { condition: 'very_dry' }).visit;
      if (v?.kind === 'check') checks++;
      if (v && v.kind !== 'night' && v.pose === 'sleeping') asleepWhileStressed++;
    }
    check('LU6 stress: by the pot, watching (concern), 1.5× longer, check-ins between visits, never asleep', stressed.visit?.rest === 'by_pot' && stressed.visit.route.every((x) => x.spot === 'by_pot' || x.spot === 'pot_front') && stressed.visit.cue === 'concern' && Math.abs(longer - 1.5) < 0.01 && checks > 0 && asleepWhileStressed === 0, `${stressed.visit?.spot}/${stressed.visit?.cue} ×${longer.toFixed(2)} · ${checks} check polls`);
    // LU7: no trustworthy data: still here, only neutral
    const unsure = ev(into, { condition: 'very_dry', modifiers: ['sensor_uncertain'] });
    check('LU7 uncertain data: she is still there, without concern', unsure.visit?.id === calm.visit?.id && unsure.visit?.cue !== 'concern' && unsure.visit?.rest !== 'by_pot', `${unsure.visit?.spot}/${unsure.visit?.cue}`);

    // LU8: hike day: away around the best hours, then a tired nap on the pillow
    const hike = { today: true, detail: { from: 9, to: 13 } as any };
    const hiking = ev(at(22, 11), { hike });
    const back = ev(at(22, 14), { hike });
    check('LU8 hike day: away on the hike, then back for a tired nap', hiking.presence === 'away_hiking' && back.visit?.kind === 'after_hike' && back.visit.rest === 'pillow' && back.presence === 'sleeping', `${hiking.presence} · ${back.visit?.kind} ${back.presence}`);

    // LU9: deterministic; a storm brings her close; after the rain she comes in with a shake
    check('LU9 deterministic (refresh, restart)', JSON.stringify(ev(into, { outsideToday: rainyDay })) === JSON.stringify(ev(into, { outsideToday: rainyDay })));
    const free = (() => {
      for (let t = at(22, 8); t < at(22, 20); t += 5 * MIN) if (!ev(t).visit && !ev(t - 60 * MIN).visit) return t;
      return at(22, 12);
    })();
    const storm = ev(free, { outsideToday: wx(free - 60 * MIN, 5, 'thunderstorm', 18, 60) });
    check('LU9b a storm brings her to the pot, awake', storm.visit?.kind === 'storm' && storm.visit.rest === 'by_pot' && storm.presence !== 'sleeping', storm.why);
    const shake = ev(firstDay.startedAt + MIN, { rainEndedAt: firstDay.startedAt - 10 * MIN });
    check('LU9c after the rain she comes in with a shake (while she arrives)', shake.visit?.cue === 'shake_off' && ev(firstDay.startedAt + 5 * MIN, { rainEndedAt: firstDay.startedAt - 10 * MIN }).visit?.cue !== 'shake_off', shake.why);

    const diary = lucyDiary(wx(at(21, 0), 4 * 24 * 2, 'clear', 20), at(22, 23, 59), 2);
    // LU10: her company calms the mood a little; it changes nothing else (energy, words, the other visitors)
    {
      const visit = lucyDay(at(24, 12)).visits.find((v) => v.kind === 'day' && v.startedAt > at(24, 9))!;
      const bb = new Bench();
      bb.clock = visit.startedAt + 15 * MIN - 150 * MIN;
      await bb.boot();
      await bb.run(150, () => ({ soil: 60, light: 55, temp: 24, hum: 60 }));
      const st = bb.state();
      const { ACTIVE_SPECIES } = await import('../src/species');
      const evalAt = (now: number) => evaluateBehaviour({ health: st.health, perception: st.perception, episodes: bb.db.episodesSince(0), events: [], species: ACTIVE_SPECIES, now });
      const here = evalAt(bb.clock);
      const lift = here.moodState.influences.find((x) => x.source === 'visitors');
      check('LU10 her company calms the mood a little (warmer, stiller), never more than the visitors\' cap', !!here.habitat.lucy?.visit && !!lift && /Lucy/.test(lift.why) && lift.v > 0 && lift.v <= 0.1 && lift.a < 0, `${here.habitat.lucy?.why} · ${lift?.why} v ${lift?.v} a ${lift?.a}`);
    }

    // LU11: visitors interest her at various levels (the squirrel most, the sloth least); watching over the
    // tree she only glances; a hiding squirrel or a sleeping sloth isn't noticed
    {
      const { withLucyInterest, lucyPresentation } = await import('../src/expression/ExpressionEngine');
      const base = (id: string, cue: any = null) => lucyPresentation({ id, kind: 'day', pose: 'sitting', spot: 'floor_left', rest: 'pillow', route: [], cue, startedAt: 0, endsAt: 1 });
      const sq = (id: string): any => ({ kind: 'squirrel', id, mode: 'visiting', spot: 'crown' });
      const df: any = { id: 'd', presence: 'perched', perch: 'left_tip' };
      const sl = (pose: string): any => ({ id: 'sl', pose, branch: 'left_branch', grip: 'arms', tempo: 0.5 });
      const levels = (who: 'squirrel' | 'sloth') => {
        const n: Record<string, number> = {};
        for (let k = 0; k < 400; k++) {
          const l = who === 'squirrel' ? withLucyInterest(base(`l${k}`), sq(`s${k}`), null, null) : withLucyInterest(base(`l${k}`), null, null, sl('hanging'));
          n[l!.interest!.level] = (n[l!.interest!.level] ?? 0) + 1;
        }
        return n;
      };
      const ls = levels('squirrel');
      const lsl = levels('sloth');
      const picks = [
        withLucyInterest(base('a'), sq('s'), df, sl('hanging'))?.interest?.who,
        withLucyInterest(base('a'), null, df, sl('hanging'))?.interest?.who,
        withLucyInterest(base('a', 'concern'), sq('s'), null, null)?.interest?.level,
        withLucyInterest(base('a'), { ...sq('s'), mode: 'hiding' }, null, sl('sleeping'))?.interest ?? null,
      ];
      check(
        'LU11 interest in visitors at four levels (the squirrel can excite her, the sloth never does); watching over the tree only a glance',
        Object.keys(ls).length === 4 && !lsl.excited && (ls.excited ?? 0) > (lsl.curious ?? 0) && JSON.stringify(picks) === JSON.stringify(['squirrel', 'dragonfly', 'glance', null]),
        `squirrel ${JSON.stringify(ls)} · sloth ${JSON.stringify(lsl)} · ${JSON.stringify(picks)}`
      );
    }

    // LU12: some nights on the floor (looking up at you now and then), most on her pillow (sound asleep)
    {
      const { lucyRest, lucyRoute } = await import('../src/behaviour/lucy');
      const none = { heat: false, cold: false, storm: false, rain: false, fineDay: false };
      let floor = 0;
      let watchStops = 0;
      let pillowWatch = 0;
      for (let d = 0; d < 300; d++) {
        const v = { id: `lucy:night:2026-1-${d}`, kind: 'night' as const, startedAt: at(1, 22, 45) + d * 24 * HOUR, endsAt: at(2, 6, 15) + d * 24 * HOUR };
        const rest = lucyRest(v.id, 'night', none, false);
        const route = lucyRoute(v, { settle: 0.8, rest, awake: false, close: false });
        const watching = route.filter((x) => x.act === 'down' && x.look === 'user' && x.at > v.startedAt + 10 * MIN).length;
        if (rest === 'floor_left') {
          floor++;
          watchStops += watching;
        } else pillowWatch += watching;
      }
      const coldRest = lucyRest('lucy:night:x', 'night', { ...none, cold: true }, false);
      check('LU12 about a third of nights on the floor, waking now and then to lie looking at you; on her pillow she sleeps through; cold nights on the pillow', floor / 300 > 0.25 && floor / 300 < 0.45 && watchStops / floor > 5 && pillowWatch === 0 && coldRest === 'pillow', `${floor}/300 floor nights, ${(watchStops / floor).toFixed(1)} looks per floor night, pillow ${pillowWatch}`);
    }

    // LU13: a visit is lively: she sniffs, sits in different places, looks at you and at the tree, then
    // settles; the route is deterministic, keeps off the right of the stand on hike day
    {
      const { lucyRoute } = await import('../src/behaviour/lucy');
      const v = { id: 'lucy:2026-6-22:3', kind: 'day' as const, startedAt: at(22, 11), endsAt: at(22, 11, 45) };
      const r1 = lucyRoute(v, { settle: 0.2, rest: 'pillow', awake: false, close: false });
      const r2 = lucyRoute(v, { settle: 0.2, rest: 'pillow', awake: false, close: false });
      const spots = new Set(r1.map((x) => x.spot));
      const acts = new Set(r1.map((x) => x.act));
      const looks = new Set(r1.filter((x) => x.act === 'sit' || x.act === 'down').map((x) => x.look));
      let offRight = true;
      for (let k = 0; k < 60; k++) if (lucyRoute({ ...v, id: `lucy:h:${k}` }, { settle: 0.2, rest: 'pillow', awake: false, close: false, avoid: ['floor_right'] }).some((x) => x.spot === 'floor_right')) offRight = false;
      const ordered = r1.every((x, j) => j === 0 || x.at > r1[j - 1].at);
      check('LU13 a lively visit: sniffing, sitting in different places, looking at you and at the tree; deterministic; off the boots on hike day', spots.size >= 3 && acts.has('sniff') && acts.has('sit') && acts.has('down') && looks.has('user') && looks.has('tree') && JSON.stringify(r1) === JSON.stringify(r2) && offRight && ordered, `${r1.length} stops · spots ${[...spots].join(',')} · acts ${[...acts].join(',')}`);
    }

    {
      // LU14: the weather coming (the barometer falling fast for a while): between her visits she comes to the
      // pot, awake and restless, ears down; without it, nobody; the storm itself, once it comes, takes over
      const plan = lucyDay(at(22, 12)).visits.filter((v) => v.kind === 'day');
      const gap = plan.findIndex((v, i) => i > 0 && v.startedAt - plan[i - 1].endsAt > 40 * MIN);
      const t = plan[gap - 1].endsAt + 20 * MIN;
      const since = t - 10 * MIN;
      const usual = ev(t);
      const uneasy = ev(t, { weatherComing: { since } });
      const stormy = ev(t, { weatherComing: { since }, outsideToday: wx(t - 2 * 60 * MIN, 9, 'thunderstorm') });
      check(
        'LU14 the weather coming: between her visits she comes to the pot, awake, ears down (restless); without it she is elsewhere; a real storm takes over',
        usual.visit === null && uneasy.visit?.spot === 'by_pot' && uneasy.visit.pose !== 'sleeping' && uneasy.visit.cue === 'storm' && /storm coming/.test(uneasy.why) && /^lucy:storm:/.test(stormy.visit?.id ?? ''),
        `${uneasy.why} · then ${stormy.why}`
      );
    }

    check('LU9d diary: her company per day and her nights by the pot', diary.filter((d) => d.title === 'Lucy kept me company').length === 2 && diary.every((d) => d.habitat === 'lucy'), diary.map((d) => `${d.title} · ${d.detail}`).join(' | '));
  }

  finish();
}

void main();

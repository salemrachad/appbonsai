// Behaviour + speech scenarios (npm run test:behaviour): mood, energy, duration, recovery,
// silence, cooldowns, once-per-episode lines, time of day, restarts. Runs the real collector
// (so speech memory is persisted exactly as in production) on the shared bench.
import { evaluateBehaviour } from '../src/behaviour/BehaviourEngine';
import { DAY_LINES, MESSAGE_CATALOG } from '../src/behaviour/messages';
import { stableVariant } from '../src/behaviour/speech';
import { Bench, check, cond, finish, Reading } from './bench';

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
    check('S1b mostly silent (animation only)', l.visiblePolls / l.polls < 0.2, `${Math.round((100 * l.visiblePolls) / l.polls)}% of polls showed a line`);
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
    const bio = (s: typeof a) =>
      JSON.stringify({
        health: s.health,
        behaviour: { ...s.behaviour, relationship: { ...s.behaviour.relationship, attention: null } },
        expression: { ...s.expression, touch: null }, // the touch answer may warm with familiarity (checked below)
      });
    check('P1 petting changes nothing biological (health, behaviour, expression identical)', bio(a) === bio(z), `${a.health.condition} v${a.health.vitality} vs ${z.health.condition} v${z.health.vitality}`);
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
    const strip = (s: typeof dry) => JSON.stringify({ health: { ...s.health, metrics: s.health.metrics.map(({ guide, ...m }) => m) }, mood: s.behaviour.mood, energy: s.behaviour.energy, intent: s.behaviour.messageIntent, habitat: { ...s.behaviour.habitat, dragonfly: undefined, sloth: undefined }, avatar: s.expression.avatar, droop: s.expression.leafDroop, scene: s.expression.atmosphere.scene });
    check('O1 outside weather never changes the tree beyond explaining light (health, mood, look, scene, the squirrel; the air wanderers read it by design)', strip(dry) === strip(storm), `${dry.health.condition} vs ${storm.health.condition}`);
    check('O2 the weather layer carries it instead', dry.expression.atmosphere.weather === null && storm.expression.atmosphere.weather?.sky === 'thunderstorm' && storm.expression.atmosphere.weather.windy);
    const looks = OUTSIDE_SKIES.map((sky) => weatherLook({ at: 0, ageMs: 0, sky, code: 0, temperature: 10, humidity: null, precipitation: null, cloudCover: null, wind: null, gusts: null, isDay: true, windy: false, rainEndedAt: null }));
    check('O3 every sky has a look and a label', looks.every((l) => l && l.label.length > 0 && l.intensity >= 0 && l.intensity <= 1), looks.map((l) => l?.label).join(' | '));
    check('O3b WMO codes map sensibly', skyFromCode(0) === 'clear' && skyFromCode(45) === 'fog' && skyFromCode(61) === 'rain' && skyFromCode(65) === 'heavy_rain' && skyFromCode(73) === 'snow' && skyFromCode(95) === 'thunderstorm');

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
    const strip = (x: typeof sunnyB) => JSON.stringify({ mood: x.mood, energy: x.energy, intent: x.messageIntent, squirrel: { ...x.habitat, dragonfly: undefined, sloth: undefined } });
    check('DF5 the dragonfly changes nothing else (mood, energy, words, the squirrel)', strip(sunnyB) === strip(rainyB) && sunnyB.habitat.dragonfly!.active && !rainyB.habitat.dragonfly!.active, `sunny ${sunnyB.habitat.dragonfly!.value} / rainy ${rainyB.habitat.dragonfly!.value}`);

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
    const strip = (x: typeof c) => JSON.stringify({ mood: x.mood, energy: x.energy, intent: x.messageIntent, others: { ...x.habitat, sloth: undefined } });
    check('SL5 the sloth changes nothing else (mood, energy, words, the squirrel, the dragonfly)', strip(c) === strip(w) && c.habitat.sloth!.active && !w.habitat.sloth!.active, `calm ${c.habitat.sloth!.value} / breezy ${w.habitat.sloth!.value}`);

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
    check('T2 spread over the day, never close together', gaps.every((g) => g >= 60 * MIN), gaps.map((g) => `${Math.round(g / MIN)}m`).join(', '));
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
    check('T5 the voice follows energy and season: thriving summer > calm autumn > winter rest', summer >= 5 && autumn >= 3 && autumn <= 4 && winter <= 2 && winter >= 1, `summer ${summer}, autumn ${autumn}, winter ${winter}`);
    const night = evaluateVoice({ health: base.health, perception: base.perception, species: ACTIVE_SPECIES, intent: 'content', timeOfDay: 'night', season: base.behaviour.season, relationship: base.behaviour.relationship, habitat: base.behaviour.habitat, canopy: base.behaviour.canopy, now: b.clock });
    check('T5b at night: no thoughts', night.budget === 0 && night.musings.length === 0);
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
      check(
        'V13 petting changes nothing in the habitat (drey included) or the visitor',
        JSON.stringify(a.behaviour.habitat) === JSON.stringify(z.behaviour.habitat) && JSON.stringify(a.expression.visitor) === JSON.stringify(z.expression.visitor),
        `habitat ${a.behaviour.habitat.value} vs ${z.behaviour.habitat.value}`
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

  }

  finish();
}

void main();

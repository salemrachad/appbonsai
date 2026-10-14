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
    check('S1 comfortable 4h: at most 2 lines', l.spoken.length <= 2, l.keys());
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
    for (const k of Object.keys(MESSAGE_CATALOG)) MESSAGE_CATALOG[k] = ['(reworded)'];
    for (const k of Object.keys(DAY_LINES) as (keyof typeof DAY_LINES)[]) DAY_LINES[k] = ['(reworded)'];
    const after = evaluateBehaviour(input);
    Object.assign(MESSAGE_CATALOG, saved);
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

  finish();
}

void main();

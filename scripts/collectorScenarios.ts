// Collector-level scenarios (npm run test:collector): watering detection, data quality, outages,
// restarts, long gaps and DB migration, on the shared test bench (scripts/bench.ts).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AppDatabase } from '../server/database';
import { SCHEMA_VERSION } from '../server/schema';
import { Bench, check, cond, epList, finish, HOUR, MIN, START } from './bench';

async function main() {
  console.log('— Watering detection —');

  {
    const b = new Bench();
    await b.boot();
    await b.run(20, () => ({ soil: 50 }));
    await b.poll({ soil: 80 });
    await b.run(5, () => ({ soil: 50 }));
    check('W1 single spike: no watering', b.waterings().length === 0, b.decision());
  }

  {
    const b = new Bench();
    await b.boot();
    await b.run(20, () => ({ soil: 50 }));
    await b.run(2, () => ({ soil: 0, raw: 4095 }));
    await b.run(5, () => ({ soil: 52 }));
    check('W2 probe pulled (0%) and reinserted: no watering', b.waterings().length === 0, b.decision());
    await b.run(2, () => ({ soil: 12 }));
    await b.run(5, () => ({ soil: 50 }));
    check('W2b pulled with air reading 12% then reinserted: no watering', b.waterings().length === 0, b.decision());
  }

  {
    const b = new Bench();
    await b.boot();
    await b.run(20, () => ({ soil: 30 }));
    for (const s of [38, 46, 54, 55, 55]) await b.poll({ soil: s });
    const w = b.waterings();
    const m = w[0]?.metadata;
    check(
      'W3 gradual watering across polls: one event, accumulated',
      w.length === 1 && m?.detectionMethod === 'accumulated_rise' && m.moistureBefore === 30 && (m.moistureAfter ?? 0) >= 54,
      JSON.stringify(m)
    );
  }

  {
    const b = new Bench();
    await b.boot();
    await b.run(20, () => ({ soil: 50 }));
    for (const s of [80, 50, 82, 50, 50]) await b.poll({ soil: s });
    check('W4 two spikes close together: no watering', b.waterings().length === 0, b.decision());
  }

  {
    const b = new Bench();
    await b.boot();
    await b.run(45, () => ({ soil: 30 }));
    const before = b.state().health.condition;
    await b.poll({ soil: 75 });
    await b.poll({ soil: 76 });
    await b.run(5, () => ({ soil: 76 }));
    await b.poll({ soil: 86 }); // a second pour in the same session
    await b.run(10, () => ({ soil: 86 }));
    const w = b.waterings();
    const m = w[0]?.metadata;
    check('W5 real watering: exactly one event (second pour = same session)', w.length === 1, `${w.length} events`);
    check(
      'W5 evidence stored',
      m?.source === 'sensor' && m.moistureBefore === 30 && m.moistureAfter === 86 && m.rawBefore != null && m.rawAfter != null && m.confirmationReadings === 1 && m.detectionMethod === 'single_jump' && m.accumulatedRise === 46 && m.risingReadings === 1,
      JSON.stringify(m)
    );
    check('W5 condition before recorded (thirsty)', before === 'thirsty' && m?.conditionBefore === 'thirsty', `${before} / ${m?.conditionBefore}`);
    await b.run(40, () => ({ soil: 86 }));
    await b.run(5, () => ({ soil: 60 })); // slow drying is fine
    await b.poll({ soil: 85 });
    await b.poll({ soil: 85 });
    check('W5b a new watering after the cooldown is a new event', b.waterings().length === 2, `${b.waterings().length} events`);
  }

  {
    const b = new Bench();
    await b.boot();
    await b.run(20, () => ({ soil: 35 }));
    b.collector.logEvent('watering', 'gave it a drink', b.clock);
    await b.poll({ soil: 70 });
    await b.poll({ soil: 71 });
    const w = b.waterings();
    check(
      'W6 manual then sensor: merged into one event with evidence',
      w.length === 1 && w[0].metadata.source === 'manual' && w[0].metadata.confirmedBySensor === true && w[0].metadata.moistureAfter === 71,
      JSON.stringify(w.map((e) => e.metadata))
    );
    await b.run(5, () => ({ soil: 71 }));
    b.collector.logEvent('watering', 'logged again by mistake', b.clock);
    check('W6b logging it again by hand: still one event', b.waterings().length === 1, `${b.waterings().length} events`);

    const c = new Bench();
    await c.boot();
    await c.run(20, () => ({ soil: 35 }));
    await c.poll({ soil: 70 });
    await c.poll({ soil: 71 });
    c.collector.logEvent('watering', 'I watered it', c.clock + 2 * MIN);
    const w2 = c.waterings();
    check('W6c sensor then manual: one event, note added', w2.length === 1 && w2[0].metadata.confirmedByUser === true && w2[0].note === 'I watered it', JSON.stringify(w2.map((e) => [e.note, e.metadata.source])));
  }

  {
    const b = new Bench();
    await b.boot();
    await b.run(60, () => ({ soil: 100 }));
    check('W7 saturated sensor: watering is invisible, nothing invented', b.waterings().length === 0);
    b.collector.logEvent('watering', null, b.clock);
    check('W7b manual watering still recorded', b.waterings().length === 1 && b.waterings()[0].metadata.source === 'manual');
  }

  {
    const b = new Bench();
    await b.boot();
    await b.run(20, () => ({ soil: 50 }));
    b.collector.suppressWateringDetection(15);
    for (const s of [0, 0, 100, 100, 3, 55, 56]) await b.poll({ soil: s });
    await b.run(15, () => ({ soil: 55 }));
    check('W8 calibration pause: handling the probe creates no event', b.waterings().length === 0, b.decision());
    await b.run(5, () => ({ soil: 55 }));
    await b.poll({ soil: 85 });
    await b.poll({ soil: 85 });
    check('W8b detection works again after the pause', b.waterings().length === 1);

    const c = new Bench();
    await c.boot();
    await c.run(20, () => ({ soil: 40 }));
    c.collector.updateSettings({ useAppSoilCalibration: true, soilRawDry: 3600, soilRawWet: 1800 });
    for (const s of [40, 40, 40]) await c.poll({ soil: s, raw: 2200 });
    check('W9 changing calibration (soil scale jumps) creates no event', c.waterings().length === 0, c.decision());
  }

  console.log('\n— Sensor reality / data quality —');

  {
    const b = new Bench();
    await b.boot();
    await b.run(4 * 60, () => ({ soil: 100 }));
    const s = b.state();
    check('Q1 soil pinned at 100% for hours: flagged, soil left out', s.perception.quality.suspect.soil && s.health.dataIssues.some((i) => i.includes('pinned')), s.health.dataIssues[0]);
    check('Q1b pinned soil is not plant stress (no too wet / thirsty)', !['too_wet', 'thirsty', 'very_dry'].includes(s.health.condition) && !s.health.modifiers.some((m) => ['too_wet', 'thirsty'].includes(m)), cond(b));
    check('Q1c moisture score left out of vitality', s.health.scores.moisture === null);
  }

  {
    const b = new Bench();
    await b.boot();
    await b.run(150, () => ({ soil: 60, raw: 2600 }));
    const s = b.state();
    check('Q2 raw value frozen for 2.5h: stuck probe flagged', s.perception.quality.suspect.soil && s.health.dataIssues.some((i) => i.includes("hasn't changed")), s.health.dataIssues[0]);
  }

  {
    const b = new Bench();
    await b.boot();
    await b.run(5, () => ({ soil: 60 }));
    await b.poll({ soil: 135, extra: { soil_raw: 5000 } });
    const s = b.state();
    check('Q3 out-of-range soil flagged before clamping', s.health.dataIssues.some((i) => i.includes('soil_moisture 135')) && s.health.dataIssues.some((i) => i.includes('soil_raw 5000')), s.health.dataIssues.slice(0, 2).join(' | '));
    await b.poll({ soil: 60, extra: { hts221_connected: false, temperature: 0, humidity: 0 } });
    const h = b.state();
    check('Q4 HTS221 flag false: temperature/humidity not trusted', h.perception.readings.temperature === null && h.health.dataIssues.some((i) => i.includes('HTS221')), String(h.perception.readings.temperature));
  }

  {
    const b = new Bench();
    b.clock = new Date(2026, 5, 15, 11, 0).getTime();
    await b.boot();
    await b.run(70, () => ({ soil: 60, light: 0, extra: { light_raw: 0 } }));
    const s = b.state();
    check('Q5 LDR at 0 in full daylight for an hour: flagged, not "too dark"', s.perception.quality.suspect.light && s.health.condition !== 'too_dark', s.health.dataIssues[0]);
  }

  {
    const b = new Bench();
    await b.boot();
    await b.run(10, () => ({ soil: 60 }));
    check('Q6 short history lowers confidence (medium), not plant stress', b.state().health.confidence === 'medium' && b.state().health.condition !== 'sensor_uncertain', cond(b));
  }

  console.log('\n— Continuity —');

  {
    const b = new Bench();
    await b.boot();
    await b.run(100, () => ({ soil: 30 }));
    const dryBefore = b.state().health.stress.dryHours;
    const vBefore = b.state().health.vitality;
    await b.run(3, () => null);
    const during = b.state().health;
    await b.run(3, () => ({ soil: 30 }));
    const eps = b.episodes();
    check('C1 Wi-Fi outage while thirsty: state held + overlay', during.condition === 'thirsty' && during.modifiers.includes('sensor_uncertain') && during.observation.status === 'unobserved', `${during.condition} +${during.modifiers}`);
    check('C1b vitality frozen during the outage', during.breakdown.frozen && during.vitality === vBefore);
    check('C1c no sensor_uncertain episode, thirsty episode continues', !eps.some((e) => e.condition === 'sensor_uncertain') && eps.filter((e) => e.condition === 'thirsty').length === 1, epList(b));
    const thirsty = eps.find((e) => e.condition === 'thirsty')!;
    check('C1d outage recorded as unobserved time in the episode', thirsty.unobservedMs >= 2 * MIN, `${Math.round(thirsty.unobservedMs / 1000)}s`);
    const dryAfter = b.state().health.stress.dryHours;
    check('C1e dry duration did not count the outage', dryAfter - dryBefore < (3 + 0.5) / 60 + 0.01, `${dryBefore.toFixed(2)}h → ${dryAfter.toFixed(2)}h`);
  }

  {
    const b = new Bench();
    await b.boot();
    await b.run(45, () => ({ soil: 30 }));
    await b.run(30, () => ({ soil: 70 }));
    const rec = b.state().health;
    await b.run(10, () => null);
    const during = b.state().health;
    await b.run(2, () => ({ soil: 70 }));
    const after = b.state().health;
    check('C2 outage during recovery: still recovering + overlay', rec.condition === 'recovering' && during.condition === 'recovering' && during.modifiers.includes('sensor_uncertain'), `${rec.condition} → ${during.condition}`);
    const lost = (rec.stress.recoveryRemainingHours ?? 0) - (after.stress.recoveryRemainingHours ?? 0);
    check('C2b recovery clock paused while unobserved', lost < 4 / 60, `remaining ${rec.stress.recoveryRemainingHours?.toFixed(2)}h → ${after.stress.recoveryRemainingHours?.toFixed(2)}h`);
    check('C2c no uncertain episode', !b.episodes().some((e) => e.condition === 'sensor_uncertain'), epList(b));
  }

  {
    const b = new Bench();
    await b.boot();
    await b.run(100, () => ({ soil: 30 }));
    const before = b.state().health;
    const openBefore = b.db.openEpisode();
    b.collector.stop();
    b.clock += 2 * MIN; // quick restart
    await b.boot();
    await b.poll({ soil: 30 });
    const after = b.state().health;
    check('C3 restart during thirsty: still thirsty right away', after.condition === 'thirsty', cond(b));
    check('C3b same episode continues', b.db.openEpisode()?.id === openBefore?.id, epList(b));
    check('C3c thirst start time and duration preserved', after.activeSince.thirsty === before.activeSince.thirsty && after.stress.dryHours >= before.stress.dryHours, `${before.stress.dryHours.toFixed(2)}h → ${after.stress.dryHours.toFixed(2)}h`);
    check('C3d vitality continues (no reset to target)', Math.abs(after.vitality - before.vitality) <= 1, `${before.vitality} → ${after.vitality}`);
    check('C3e restored from saved memory, not replay', b.logs.some((l) => l.includes('resumed saved health memory')));
  }

  {
    const b = new Bench();
    await b.boot();
    await b.run(45, () => ({ soil: 30 }));
    await b.run(40, () => ({ soil: 70 }));
    const before = b.state().health;
    b.collector.stop();
    b.clock += 3 * MIN;
    await b.boot();
    await b.poll({ soil: 70 });
    const after = b.state().health;
    check('C4 restart during recovery: still recovering from the same stress', after.condition === 'recovering' && after.stress.recoveringFrom === before.stress.recoveringFrom, `${before.stress.recoveringFrom} → ${after.stress.recoveringFrom}`);
    check('C4b recovery progress kept', Math.abs((after.stress.recoveryRemainingHours ?? 0) - (before.stress.recoveryRemainingHours ?? 0)) < 0.1, `${before.stress.recoveryRemainingHours?.toFixed(2)}h → ${after.stress.recoveryRemainingHours?.toFixed(2)}h`);
  }

  {
    const b = new Bench();
    await b.boot();
    await b.run(100, () => ({ soil: 30 }));
    const before = b.state().health;
    b.collector.stop();
    b.clock += 8 * HOUR; // PC off overnight
    await b.boot();
    await b.poll({ soil: 30 });
    const after = b.state().health;
    const eps = b.episodes();
    const closed = eps.filter((e) => e.condition === 'thirsty' && e.endedAt !== null)[0];
    check('C5 long gap: old episode closed where it was last seen', !!closed && closed.endedAt === closed.lastSeenAt && closed.endedAt! < START + 102 * MIN, epList(b));
    check('C5b unobserved 8h not counted as thirst', after.stress.dryHours < before.stress.dryHours + 0.2, `${before.stress.dryHours.toFixed(2)}h → ${after.stress.dryHours.toFixed(2)}h`);
    check('C5c vitality not penalised for the gap', after.vitality >= before.vitality - 2, `${before.vitality} → ${after.vitality}`);
    check('C5d still thirsty (soil still dry), not a brand-new plant', after.condition === 'thirsty', cond(b));
  }

  {
    const b = new Bench();
    await b.boot();
    await b.run(100, () => ({ soil: 30 }));
    await b.run(40, () => null);
    const long = b.state().health;
    await b.run(5, () => ({ soil: 30 }));
    check('C6 outage > 30 min: sensor_uncertain becomes primary', long.condition === 'sensor_uncertain' && long.observation.status === 'unknown', `${long.condition}`);
    check('C6b reconnect: back to the biological state', b.state().health.condition === 'thirsty', cond(b));
    const eps = b.episodes();
    check('C6c no episode shorter than one poll cycle', eps.every((e) => (e.endedAt ?? e.lastSeenAt) - e.startedAt >= 1.5 * MIN || e.endedAt === null), eps.map((e) => `${e.condition} ${Math.round(((e.endedAt ?? e.lastSeenAt) - e.startedAt) / 1000)}s`).join(', '));
  }

  {
    // An A → blip → A flicker is stitched back into one episode
    const b = new Bench();
    await b.boot();
    await b.run(10, () => ({ soil: 60 }));
    const n = b.episodes().length;
    check('C7 first readings make no zero-length episodes', b.episodes().every((e) => e.endedAt === null || e.endedAt - e.startedAt >= 1.5 * MIN), `${n}: ${epList(b)}`);
  }

  console.log('\n— Attention (petting sessions) —');
  {
    const b = new Bench();
    await b.boot();
    await b.run(10, () => ({ soil: 60 }));
    const c = b.collector;
    const pet = (startMin: number, lenS: number, count = 3, kind: string = 'pet') =>
      c.recordInteraction({ kind, startedAt: b.clock + startMin * MIN, endedAt: b.clock + startMin * MIN + lenS * 1000, count, activeMs: lenS * 800 });
    const first = pet(-20, 20);
    const merged = pet(-19, 15);
    const separate = pet(-5, 10);
    const rows = b.db.interactionsSince(0);
    check(
      'A1 sessions within 2 min merge into one row; later ones are separate',
      'interaction' in first && 'interaction' in merged && merged.merged && 'interaction' in separate && !separate.merged && rows.length === 2 && rows.some((r) => r.count === 6),
      rows.map((r) => `${r.kind}×${r.count}`).join(', ')
    );
    const bad = pet(-1, 5, 1, 'water');
    check('A2 unknown interaction kinds are refused', 'error' in bad && bad.status === 400);
    const future = c.recordInteraction({ kind: 'pet', startedAt: b.clock + HOUR, endedAt: b.clock + 2 * HOUR, count: 1 });
    check('A3 sessions in the future are refused', 'error' in future);
    check('A4 petting never creates a care event', b.db.eventsSince(0).length === 0, `${b.db.eventsSince(0).length} events`);
    // Compulsive petting stays small: 200 rapid sessions become one row (sessions, never movements)
    const busy = new Bench();
    await busy.boot();
    await busy.run(2, () => ({ soil: 60 }));
    for (let i = 0; i < 200; i++) {
      const t0 = busy.clock - 40 * MIN + i * 10 * 1000;
      busy.collector.recordInteraction({ kind: 'pet', startedAt: t0, endedAt: t0 + 4000, count: 2, activeMs: 3000 });
    }
    const one = busy.db.interactionsSince(0);
    check('A5 rapid sessions collapse into one row', one.length === 1 && one[0].count === 400, `${one.length} rows, ${one[0]?.count} strokes`);
  }

  console.log('\n— Database migration —');
  {
    const file = path.join(os.tmpdir(), `appbonsai-migrate-${Date.now()}.db`);
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE behaviour_episodes (id INTEGER PRIMARY KEY AUTOINCREMENT, started_at INTEGER NOT NULL, ended_at INTEGER, last_seen_at INTEGER NOT NULL,
      condition TEXT NOT NULL, modifiers_json TEXT NOT NULL DEFAULT '[]', peak_severity TEXT NOT NULL DEFAULT 'none', engine_version TEXT NOT NULL);
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO meta VALUES ('schema_version', '1');
      INSERT INTO behaviour_episodes (started_at, last_seen_at, condition, engine_version) VALUES (1, 1, 'comfortable', 'living-2.0');`);
    old.close();
    const db = new AppDatabase(file);
    const ep = db.openEpisode();
    check('M1 v1 database upgraded: unobserved_ms added, old rows kept', ep?.unobservedMs === 0 && db.getMeta<number>('schema_version') === SCHEMA_VERSION);
    check('M2 old database gains the interactions table, empty', db.interactionCount() === 0 && db.getMeta<number>('schema_version') === SCHEMA_VERSION);
    db.close();
    for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
  }

  finish();
}

void main();

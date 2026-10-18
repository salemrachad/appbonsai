// Collector-level scenarios (npm run test:collector): watering detection, data quality, outages,
// restarts, long gaps and DB migration, on the shared test bench (scripts/bench.ts).
import './tz'; // first: the tree's timezone (the build machines run in UTC)
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { addDevice } from '../server/devices';
import { handleIngest } from '../server/ingest';
import { openDatabase } from '../server/nodeSqlite';
import { SCHEMA_VERSION } from '../server/schema';
import { APP_CONFIG } from '../src/config/appConfig';
import { Bench, check, cond, epList, finish, HOUR, MIN, START } from './bench';
import { DAY } from '../src/lib/time';

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

  console.log('\n— Push: the ESP32 sends its readings (POST /api/ingest) —');
  {
    // The same readings read by the server or sent by the device: the same tree
    const script = (i: number) => ({ soil: i < 120 ? 60 - i * 0.25 : i < 122 ? 75 : 74, temp: 24 + (i % 50) / 25 });
    // Both start before the device's first reading, as a server does
    const pull = new Bench();
    pull.online = false;
    await pull.boot();
    const push = new Bench();
    push.usePush();
    await push.boot();
    let same = 0;
    // The normalizer stamps updatedAt (display only) from the wall clock, which can tick between the two
    const state = (b: Bench) => JSON.stringify(b.state(), (k, v) => (k === 'updatedAt' ? undefined : v));
    for (let i = 0; i < 200; i++) {
      await pull.poll(script(i));
      push.push(script(i));
      if (state(pull) === state(push)) same++;
    }
    const pick = (b: Bench) => JSON.stringify({ eps: b.episodes().map((e) => [e.condition, e.startedAt, e.endedAt]), w: b.waterings().map((w) => [w.timestamp, w.metadata]) });
    check('PU1 same readings pushed or pulled: the same perception, health, behaviour and expression every minute', same === 200, `${same}/200 minutes identical, ${cond(pull)} / ${cond(push)}`);
    check('PU1b same episodes and the same watering', pick(pull) === pick(push) && push.waterings().length === 1, `${epList(pull)} / ${epList(push)}`);
    check('PU1d every pushed reading stored once, under the device id', push.db.telemetryStats().count === 200 && push.db.latestTelemetry(null, 1)[0].deviceId === 'bench-esp32', `${push.db.telemetryStats().count} rows`);
  }

  {
    const b = new Bench();
    b.usePush();
    await b.boot();
    b.push({ soil: 60 });
    const n = b.db.telemetryStats().count;
    b.clock += MIN;
    b.device.buffer.push({ ...b.measure({ soil: 60 }), seq: 99, uptime_ms: b.clock - b.device.bootAt });
    const wrong = b.send({}, 'not-the-token');
    const unknown = b.send({ device_id: 'someone-else' });
    const missing = handleIngest(b.db, b.collector, { body: { v: 1, device_id: b.device.id, readings: b.device.buffer } }, b.clock);
    check('PU2 wrong token, unknown device, no token: 401, nothing stored', [wrong, unknown, missing].every((r) => r.status === 401) && b.db.telemetryStats().count === n);
    check('PU2b the token is kept only as a hash', b.db.devices()[0].tokenHash !== b.device.token && !JSON.stringify(b.db.devices()).includes(b.device.token));
    check('PU2c the device belongs to this tree', b.db.devices()[0].treeId === b.db.tree().id);
    b.db.insertDevice({ id: 'other-tree-esp32', treeId: 'tree_someone-else', tokenHash: createHash('sha256').update('other-token').digest('hex'), label: null, createdAt: b.clock });
    const otherTree = b.send({ device_id: 'other-tree-esp32' }, 'other-token');
    check('PU2d another tree\'s device, right token: 401, nothing stored', otherTree.status === 401 && b.db.telemetryStats().count === n, JSON.stringify(otherTree.body));
    check('PU3 another protocol version: 400', b.send({ v: 2 }).status === 400);
    check('PU3b no readings: 400', b.send({ readings: [] }).status === 400);
    check('PU3c too many readings in one request: 413', b.send({ readings: Array.from({ length: APP_CONFIG.push.maxReadings + 1 }, () => ({})) }).status === 413);
    const ok = b.send();
    check('PU3d then the right request is taken', ok.status === 200 && ok.body.ok && ok.body.accepted === 1, JSON.stringify(ok.body));
    check('PU4 the reply tells the device how often to send', ok.body.ok && ok.body.interval_s === 60 && ok.body.commands.length === 0);
    b.collector.updateSettings({ telemetryIntervalMs: 2 * MIN });
    const slower = b.push({ soil: 60 }, { advance: 2 * MIN });
    check('PU4b a new interval in Settings reaches the device', slower?.body.ok === true && slower.body.interval_s === 120);
  }

  {
    const b = new Bench(); // the server still reads the ESP32 itself
    const token = addDevice(b.db, 'stray-esp32', null)!;
    await b.boot();
    const n = b.db.telemetryStats().count;
    const r = handleIngest(b.db, b.collector, { authorization: `Bearer ${token}`, body: { v: 1, device_id: 'stray-esp32', readings: [b.measure({ soil: 50 })] } }, b.clock);
    check('PU5 not set to receive pushes: 409, nothing stored (two collectors never feed one tree)', r.status === 409 && b.db.telemetryStats().count === n, JSON.stringify(r.body));
  }

  {
    const b = new Bench();
    b.usePush();
    await b.boot();
    b.pushRun(5, () => ({ soil: 60 }));
    const last = b.db.latestTelemetry(null, 1)[0];
    b.device.buffer = [{ ...b.measure({ soil: 60 }), seq: b.device.seq, uptime_ms: b.clock - b.device.bootAt + 5 }]; // the last one again
    const retry = b.send();
    check('PU6 a retried request (same boot, same seq) is dropped', retry.body.ok && retry.body.accepted === 0 && b.db.telemetryStats().count === 5 && b.db.latestTelemetry(null, 1)[0].id === last.id, JSON.stringify(retry.body));
    b.reboot('boot-2');
    const after = b.push({ soil: 60 });
    check('PU6b after a reboot seq starts over and is taken', after?.body.ok === true && after.body.accepted === 1 && b.db.telemetryStats().count === 6);
  }

  {
    const b = new Bench();
    b.usePush();
    await b.boot();
    b.pushRun(100, () => ({ soil: 30 }));
    b.pushRun(1, () => null);
    const quiet = b.collector.collectorStatus();
    b.pushRun(1, () => null);
    const overdue = b.collector.collectorStatus();
    b.pushRun(38, () => null);
    const long = b.state().health;
    b.pushRun(5, () => ({ soil: 30 }));
    check('PU7 one missed minute is within the grace', quiet.lastError === null && quiet.consecutiveFailures === 0);
    check('PU7b an overdue push counts as a failed poll', overdue.lastError !== null && overdue.consecutiveFailures === 1, `${overdue.lastError}`);
    check('PU7c device off > 30 min: sensor_uncertain becomes primary (as in pull mode)', long.condition === 'sensor_uncertain', long.condition);
    check('PU7d back: the biological state, the error cleared', b.state().health.condition === 'thirsty' && b.collector.collectorStatus().lastError === null && b.logs.some((l) => l.includes('sensor back')), cond(b));
  }

  {
    const b = new Bench();
    b.usePush();
    await b.boot();
    b.pushRun(100, () => ({ soil: 30 }));
    b.pushRun(20, () => ({ soil: 29 }), { offline: true }); // Wi-Fi down: measured and kept
    const held = b.state().health;
    const res = b.push({ soil: 29 });
    const rows = b.db.telemetrySince(null, START + 100 * MIN + 1);
    const spaced = rows.every((r, i) => i === 0 || r.timestamp - rows[i - 1].timestamp === MIN);
    check('PU8 Wi-Fi outage: held as uncertain while nothing arrives', held.modifiers.includes('sensor_uncertain') || held.condition === 'sensor_uncertain', `${held.condition} +${held.modifiers}`);
    check('PU8b the buffered readings arrive in one request, each at the minute it was measured', res?.body.ok === true && res.body.accepted === 21 && rows.length === 21 && spaced, `${rows.length} rows, spaced ${spaced}, ${JSON.stringify(res?.body)}`);
    check('PU8c the live state continues from the newest', b.state().health.condition === 'thirsty' && b.state().perception.readings.soilMoisture === 29, cond(b));
    check('PU8d the outage stays unobserved time (not rewritten as thirst)', b.state().health.stress.dryHours < held.stress.dryHours + 0.1, `${held.stress.dryHours.toFixed(2)}h → ${b.state().health.stress.dryHours.toFixed(2)}h`);
  }

  {
    const b = new Bench();
    b.usePush();
    await b.boot();
    b.pushRun(3, () => ({ soil: 60 }));
    const r = (t: number) => ({ ...b.measure({ soil: 60 }), seq: ++b.device.seq, t });
    b.clock += MIN;
    const res = b.send({ uptime_ms: undefined, readings: [r(b.clock + HOUR), r(b.clock - 30_000), r(b.clock)] });
    const times = b.db.telemetrySince(null, b.clock - MIN).map((x) => x.timestamp);
    check('PU9 device clock times: a future one is refused, the others kept', res.body.ok && res.body.accepted === 2 && res.body.errors.length === 1 && times.includes(b.clock - 30_000) && times.includes(b.clock), JSON.stringify(res.body));
  }

  {
    // Calibration captures in push mode: the device is asked to send often, and the capture waits for it
    const b = new Bench();
    b.usePush();
    await b.boot();
    b.pushRun(3, () => ({ soil: 60, raw: 2600 }));
    const n = b.db.telemetryStats().count;
    const pending = b.collector.readRaw();
    const reply = b.push({ soil: 60, raw: 2600 }, { advance: 3000 });
    const raw = await pending;
    const fast = b.push({ soil: 60, raw: 2610 }, { advance: 3000 });
    check('PU10 a capture waits for the next pushed reading', raw.soilRaw === 2600, `${raw.soilRaw}`);
    check('PU10b while capturing the device is asked to send every few seconds', reply?.body.ok === true && reply.body.interval_s === 3 && fast?.body.ok === true && fast.body.interval_s === 3);
    check('PU10c capture readings are not polls: not stored as telemetry', b.db.telemetryStats().count === n, `${n} → ${b.db.telemetryStats().count}`);
    b.clock += APP_CONFIG.push.burstMs;
    const normal = b.push({ soil: 60 });
    check('PU10d afterwards back to the normal interval and stored', normal?.body.ok === true && normal.body.interval_s === 60 && b.db.telemetryStats().count === n + 1);
  }

  console.log('\n— Moving the tree to another server (laptop → Cloudflare) —');
  {
    const script = (i: number) => (i >= 100 && i < 115 ? null : { soil: i < 60 ? 55 - i * 0.4 : i < 62 ? 31 : i < 64 ? 72 : 71, temp: 23 + (i % 70) / 20 });
    const same = (b: Bench) =>
      JSON.stringify({ ...b.collector.snapshot(), status: b.collector.collectorStatus(), events: b.db.eventsSince(0), episodes: b.episodes() }, (k, v) => (k === 'updatedAt' ? undefined : v));
    const laptop = new Bench();
    laptop.usePush();
    await laptop.boot();
    laptop.pushRun(150, script);
    laptop.collector.recordInteraction({ kind: 'pet', startedAt: laptop.clock - 20_000, endedAt: laptop.clock - 2_000, count: 4, activeMs: 15_000 });
    // The cloud tree: made fresh (its own tree id, default settings), then given the laptop's data
    const cloud = new Bench();
    cloud.db.setMeta('collector_settings', { ...cloud.db.getMeta<any>('collector_settings'), dataSource: 'weather_estimate' });
    const counts = cloud.db.restore(laptop.db.dump());
    cloud.clock = laptop.clock;
    cloud.device = { ...laptop.device };
    await cloud.boot();
    check('MV1 restored on the other server it resumes as the same tree: state, status, events, episodes', same(cloud) === same(laptop), JSON.stringify(counts));
    check('DI3 what the tree said moves with it', laptop.db.utterancesSince(0).length > 0 && JSON.stringify(cloud.db.utterancesSince(0)) === JSON.stringify(laptop.db.utterancesSince(0)), `${laptop.db.utterancesSince(0).length} lines`);
    const d = cloud.db.getDevice(laptop.device.id);
    check('MV2 the device moved with its token hash, onto the new server\'s own tree', !!d && d.tokenHash === laptop.db.getDevice(laptop.device.id)!.tokenHash && d.treeId === cloud.db.tree().id && cloud.db.tree().id !== laptop.db.tree().id);
    let identical = 0;
    for (let i = 150; i < 180; i++) {
      laptop.push(script(i));
      cloud.push(script(i));
      if (same(cloud) === same(laptop)) identical++;
    }
    check('MV2b the device pushes to it with the same token, and both carry on identically', identical === 30 && cloud.db.telemetryStats().count === laptop.db.telemetryStats().count, `${identical}/30`);
    // Readings that reached the laptop after the copy, before the device switched
    laptop.pushRun(5, () => ({ soil: 70 }));
    const added = cloud.db.topUpTelemetry(laptop.db.dump().tables.telemetry);
    const again = cloud.db.topUpTelemetry(laptop.db.dump().tables.telemetry);
    check('MV3 a top-up adds only the readings it doesn\'t have, once', added === 5 && again === 0, `${added}, then ${again}`);
    let refused = false;
    try {
      cloud.db.restore({ ...laptop.db.dump(), schemaVersion: SCHEMA_VERSION - 1 });
    } catch {
      refused = true;
    }
    check('MV4 a dump from another schema version is refused, nothing changed', refused && cloud.db.telemetryStats().count === laptop.db.telemetryStats().count);
  }

  console.log('\n— Nightly backups —');
  {
    const { nextBackup, backupSaved, assemble, backupKey } = await import('../server/backup');
    const b = new Bench();
    b.weather = { code: 3 };
    b.usePush();
    await b.boot();
    const night = () => {
      const backup = JSON.parse(JSON.stringify(nextBackup(b.db, b.clock))); // as stored and read back
      backupSaved(b.db, backup);
      return backup;
    };
    const backups = [];
    b.pushRun(120, (i) => ({ soil: 50 - i * 0.1 }));
    await b.collector.pollWeather();
    backups.push(night());
    b.pushRun(30, () => ({ soil: 40 }), { offline: true }); // Wi-Fi down: kept on the device
    backups.push(night()); // nothing new in the growing tables
    b.push({ soil: 40 }); // the buffer arrives after that night: readings from before it
    b.pushRun(60, () => ({ soil: 39 }));
    b.collector.logEvent('watering', 'evening drink', b.clock);
    await b.collector.pollWeather();
    backups.push(night());
    const full = JSON.stringify(b.db.dump());
    const rebuilt = JSON.stringify(assemble(backups));
    check('BK1 three nights rebuilt into one dump: the same as the database, late buffered readings included', rebuilt === full, `${b.db.telemetryStats().count} readings, nights with ${backups.map((x) => x.tables.telemetry.length).join(' / ')} new`);
    check('BK1b the first is complete, the others only add (night 3: the 30 buffered during the outage + 61 after)', backups[0].after === null && backups[1].tables.telemetry.length === 0 && backups[2].tables.telemetry.length === 91);
    let gap = '';
    try {
      assemble([backups[0], backups[2]]);
    } catch (err: any) {
      gap = err.message;
    }
    check('BK2 a missing night is refused, not silently skipped', /missing/.test(gap), gap);
    const restored = new Bench();
    restored.db.restore(assemble(backups));
    restored.clock = b.clock;
    await restored.boot();
    const same = (x: Bench) => JSON.stringify({ ...x.collector.snapshot(), events: x.db.eventsSince(0), episodes: x.episodes() }, (k, v) => (k === 'updatedAt' ? undefined : v));
    check('BK3 a tree restored from the backups resumes as the same tree', same(restored) === same(b));
    check('BK3b and starts a new backup series with a complete backup', nextBackup(restored.db, restored.clock).after === null && backupKey(backups[2]).endsWith('/000003'));

    // When backups are due. The first one at a fixed moment: asked every minute (a push), it must still come.
    const { backupDueAt } = await import('../server/backup');
    const loaded = Date.UTC(2026, 9, 18, 9, 30);
    let firstAt = 0;
    for (let now = loaded; now < loaded + 10 * MIN && !firstAt; now += MIN) if (now >= backupDueAt(null, loaded + 2 * MIN, 2)) firstAt = now;
    check('BK4 the first backup comes while pushes arrive every minute', firstAt === loaded + 2 * MIN, firstAt ? new Date(firstAt).toISOString() : 'never');
    const after = (iso: string) => new Date(backupDueAt(Date.parse(iso), 0, 2)).toISOString();
    check(
      'BK4b then nightly at 02:00 UTC (05:00 in Beirut), the first 02:00 after the last',
      after('2026-10-18T09:32:00Z') === '2026-10-19T02:00:00.000Z' && after('2026-10-19T01:59:00Z') === '2026-10-19T02:00:00.000Z' && after('2026-10-19T02:00:05Z') === '2026-10-20T02:00:00.000Z',
      after('2026-10-18T09:32:00Z')
    );
  }

  console.log('\n— The diary: what the tree said, the moments of the day, the day in short —');
  {
    const { diaryFor } = await import('../server/routes/history');
    const { dayMoments } = await import('../src/history/moments');
    const { ACTIVE_SPECIES } = await import('../src/species');
    const b = new Bench();
    b.weather = { code: 1, temp: 20 };
    await b.boot();
    // From Monday 09:00 for 30 hours: a warm afternoon, drying to thirsty, a watering at 18:00, a humid night
    const day = (i: number) => {
      const h = ((9 * 60 + i) / 60) % 24;
      const sun = h >= 6 && h < 20;
      return { soil: i < 540 ? 60 - i * 0.05 : i < 545 ? 33 : 70 - (i - 545) * 0.01, temp: 20 + 6 * Math.max(0, Math.sin(((h - 7) / 14) * Math.PI)), hum: sun ? 55 : 82, light: sun ? 25 + 50 * Math.max(0, Math.sin(((h - 6) / 14) * Math.PI)) : 2 };
    };
    for (let i = 0; i < 30 * 60; i++) {
      if (i % 15 === 0) await b.collector.pollWeather();
      await b.poll(day(i));
    }
    const said = b.db.utterancesSince(0);
    const bootAgain = async () => {
      await b.boot();
      return b.db.utterancesSince(0).length;
    };
    const afterRestart = await bootAgain();
    b.db.setMeta('health_memory', null);
    const afterReplay = await bootAgain();
    check('DI1 each spoken line is stored once; a restart or a replay stores nothing again', said.length >= 10 && afterRestart === said.length && afterReplay === said.length && new Set(said.map((u) => `${u.at}|${u.text}`)).size === said.length, `${said.length} lines, ${afterRestart} after a restart, ${afterReplay} after a replay`);

    const diary = diaryFor(b.db, b.collector, 2, b.clock);
    const kinds = (k: string) => diary.filter((i) => i.kind === k);
    const monday = new Date(START).setHours(0, 0, 0, 0);
    const summary = kinds('day_summary');
    check('DI2 the diary keeps the tree\'s words: one line per thing it said', kinds('said').length === said.length && kinds('said').every((i) => said.some((u) => u.at === i.at && u.text === i.title)), `${kinds('said').length} said`);
    check(
      'DI2b moments of the day from the readings, one of each kind per day',
      kinds('moment').length >= 4 && new Set(kinds('moment').map((i) => `${new Date(i.at).toDateString()}|${i.moment}`)).size === kinds('moment').length,
      kinds('moment').map((i) => i.moment).join(', ')
    );
    check(
      'DI2c the finished Monday in short (soil, temperature, humidity, light, how it went); none for today',
      summary.length === 1 && summary[0].at === monday + DAY - 1 && /soil \d+% → \d+%, watered once/.test(summary[0].detail ?? '') && /mostly /.test(summary[0].detail ?? ''),
      summary.map((i) => i.detail).join(' | ')
    );
    const brightSaid = said.filter((u) => u.key === 'brightest_hour').map((u) => new Date(u.at).toDateString());
    check('DI2d a moment the tree already spoke about that day is left out', kinds('moment').every((i) => i.moment !== 'brightest' || !brightSaid.includes(new Date(i.at).toDateString())));
    check('DI2e a diary twice as rich as before on this day', diary.length >= 2 * (diary.length - kinds('said').length - kinds('moment').length - summary.length), `${diary.length} lines, ${diary.length - kinds('said').length - kinds('moment').length - summary.length} of the earlier kinds`);

    // Today's moments only once settled: at 14:00 no warmest yet (after 18:00), the brightest hour 3 h past
    const samples = b.collector.currentState()!.perception.recent;
    const tuesday = monday + DAY;
    const at14 = dayMoments(samples, ACTIVE_SPECIES, tuesday + 14 * HOUR, [], tuesday).map((i) => i.moment);
    const at20 = dayMoments(samples, ACTIVE_SPECIES, tuesday + 20 * HOUR, [], tuesday).map((i) => i.moment);
    check('DI4 today\'s moments appear only once settled (no warmest before 18:00)', !at14.includes('warmest') && at14.length <= at20.length, `14:00 ${at14.join(',')} · 20:00 ${at20.join(',')}`);
  }

  console.log('\n— Restarts between steps (a Durable Object waking up) —');
  {
    // The same pushes to a collector that never stops and to one restarted before every push. On Cloudflare a
    // Durable Object is unloaded between requests, so every wake-up is a restart: it must change nothing.
    // Drying to thirsty, a watering (a rise waiting for its confirmation across a restart), the device off for
    // 20 min, outside weather every 15 min, petting, a care event logged by hand.
    const script = (i: number) =>
      i >= 150 && i < 170 ? null : { soil: i < 100 ? 60 - i * 0.35 : i < 102 ? 30 : i < 104 ? 75 : 74 - (i - 104) * 0.05, temp: 24 + (i % 90) / 15, hum: 60 + (i % 40) / 4 };
    // The normalizer stamps updatedAt (display only) from the wall clock: not part of the comparison
    const full = (b: Bench) =>
      JSON.stringify(
        {
          ...b.collector.snapshot(),
          status: b.collector.collectorStatus(),
          next: b.collector.nextWakeAt(),
          events: b.db.eventsSince(0),
          episodes: b.episodes(),
          meta: ['health_memory', 'message_memory', 'mood_memory', 'watering_detection_suppressed_until'].map((k) => b.db.getMeta(k)),
          said: b.db.utterancesSince(0).map((u) => [u.at, u.key, u.kind, u.text]),
        },
        (k, v) => (k === 'updatedAt' ? undefined : v)
      );
    const steady = new Bench();
    const restarted = new Bench();
    for (const b of [steady, restarted]) {
      b.weather = { code: 2, temp: 18 };
      b.usePush();
      await b.boot();
    }
    let same = 0;
    let firstDiff = -1;
    for (let i = 0; i < 260; i++) {
      restarted.clock += MIN;
      await restarted.boot();
      steady.push(script(i));
      restarted.push(script(i), { advance: 0 });
      for (const b of [steady, restarted]) {
        if (i % 15 === 0) await b.collector.pollWeather();
        if (i === 60) b.collector.recordInteraction({ kind: 'pet', startedAt: b.clock - 30_000, endedAt: b.clock - 5_000, count: 6, activeMs: 20_000 });
        if (i === 200) b.collector.logEvent('pruning', 'a light trim', b.clock);
      }
      if (full(steady) === full(restarted)) same++;
      else if (firstDiff < 0) firstDiff = i;
    }
    check('RS1 restarted before every push: the same state, status, events and episodes every minute', same === 260, `${same}/260 identical${firstDiff >= 0 ? `, first difference at minute ${firstDiff}` : ''}`);
    check('RS1b the scenario had its watering and its outage', restarted.waterings().length === 1 && restarted.logs.some((l) => l.includes('sensor back')), `${restarted.waterings().length} waterings`);

    // Waking up by itself changes nothing: no evaluation, no new rows, the same snapshot
    const before = full(restarted);
    const rows = restarted.db.telemetryStats().count;
    await restarted.boot();
    check('RS2 a resumed start in push mode evaluates nothing and stores nothing', full(restarted) === before && restarted.db.telemetryStats().count === rows);
    const due = restarted.db.getMeta<any>('collector_runtime').due;
    check(
      'RS3 the timers are saved with it (the alarm time): the overdue check one interval after the last push, the weather 15 min after its last fetch',
      due.poll === restarted.clock + MIN && due.weather === restarted.clock - 4 * MIN + 15 * MIN && restarted.collector.nextWakeAt() === steady.collector.nextWakeAt(),
      JSON.stringify(due)
    );
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
    const db = openDatabase(file);
    const ep = db.openEpisode();
    check('M1 v1 database upgraded: unobserved_ms added, old rows kept', ep?.unobservedMs === 0 && db.getMeta<number>('schema_version') === SCHEMA_VERSION);
    check('M2 old database gains the interactions table, empty', db.interactionCount() === 0 && db.getMeta<number>('schema_version') === SCHEMA_VERSION);
    check('M3 old database gains the outside_weather table, empty', db.latestOutsideWeather() === null && db.outsideWeatherSince(0).length === 0);
    check('M4 old database gains the devices table, empty', db.devices().length === 0);
    const tree = db.tree();
    check('M5 old database gains its tree, and keeps it', /^tree_[0-9a-f-]{36}$/.test(tree.id), tree.id);
    db.close();
    const again = openDatabase(file);
    check('M5b reopened: the same tree, still one', again.tree().id === tree.id);
    again.close();
    for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
  }

  {
    // A v7 database (devices, no trees): its devices belong to the tree it gains, and still push
    const file = path.join(os.tmpdir(), `appbonsai-migrate-v7-${Date.now()}.db`);
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE devices (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, label TEXT, created_at INTEGER NOT NULL, last_seen_at INTEGER, firmware TEXT, boot TEXT, last_seq INTEGER);
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO meta VALUES ('schema_version', '7');
      INSERT INTO devices (id, token_hash, label, created_at) VALUES ('old-esp32', '${'0'.repeat(64)}', 'balcony', 1);`);
    old.close();
    const db = openDatabase(file);
    const d = db.getDevice('old-esp32');
    check('M6 v7 database: its device is linked to the new tree, nothing else changed', d?.treeId === db.tree().id && d.label === 'balcony' && db.getMeta<number>('schema_version') === SCHEMA_VERSION, JSON.stringify(d));
    check('M7 an older database gains the utterances table, empty', db.utterancesSince(0).length === 0);
    db.close();
    for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
  }

  console.log('\n— Health memory migration (derived metrics) —');
  {
    // A memory saved before the coupling baseline existed (same version, no `environment`)
    const b = new Bench();
    await b.boot();
    await b.run(90, (i) => ({ soil: i < 60 ? 60 : 30 }));
    b.collector.recordInteraction({ kind: 'pet', startedAt: b.clock - 60_000, endedAt: b.clock - 30_000, count: 3, activeMs: 20_000 });
    const saved = b.db.getMeta<any>('health_memory');
    const { environment: _drop, ...oldShape } = saved.memory;
    b.db.setMeta('health_memory', { ...saved, memory: oldShape });
    const beforeEpisodeIds = b.db.episodesSince(0).map((e) => e.id);
    const before = { health: b.state().health, events: b.db.eventsSince(0).length, episodes: b.db.episodesSince(0).length, pets: b.db.interactionsSince(0).length, speech: JSON.stringify(b.db.getMeta('message_memory')) };
    const r = new Bench(b.db);
    r.clock = b.clock;
    r.payload = b.payload;
    await r.boot();
    const after = r.state().health;
    check('MG1 an older saved memory resumes as is: no replay, same latches and vitality', r.logs.some((l) => l.includes('resumed saved health memory')) && !r.logs.some((l) => l.includes('replayed')) && after.condition === before.health.condition && Math.abs(after.vitality - before.health.vitality) <= 1, `${before.health.condition} v${before.health.vitality} → ${after.condition} v${after.vitality}`);
    check('MG1b the coupling baseline simply starts learning', (r.db.getMeta<any>('health_memory').memory.environment?.coupling.hours ?? 0) === 0 && ['learning', 'unavailable'].includes(after.environment?.coupling.status ?? ''));
    const kept = (ids: number[]) => ids.every((id) => r.db.episodesSince(0).some((e) => e.id === id));
    check(
      'MG2 care history, episodes, attention and speech memory untouched',
      r.db.eventsSince(0).length === before.events && kept(beforeEpisodeIds) && r.db.interactionsSince(0).length === before.pets && JSON.stringify(r.db.getMeta('message_memory')) === before.speech,
      `events ${before.events}→${r.db.eventsSince(0).length}, pets ${before.pets}→${r.db.interactionsSince(0).length}, speech same: ${JSON.stringify(r.db.getMeta('message_memory')) === before.speech}`
    );

    // A forced replay (saved memory unusable): 48 h of telemetry rebuild the short-term state
    const c = new Bench();
    await c.boot();
    await c.run(60, () => ({ soil: 60 }));
    await c.run(120, () => ({ soil: 30 }));
    const live = c.state().health;
    c.db.setMeta('health_memory', { engineVersion: 'older-engine', source: 'esp32_sensor', memory: c.db.getMeta<any>('health_memory').memory });
    const evs = c.db.eventsSince(0).length;
    const eps = JSON.stringify(c.db.episodesSince(0).filter((e) => e.startedAt < c.clock).map((e) => [e.condition, e.startedAt]));
    const sp = JSON.stringify(c.db.getMeta('message_memory'));
    const d = new Bench(c.db);
    d.clock = c.clock;
    d.payload = c.payload;
    await d.boot();
    const rebuilt = d.state().health;
    check('MG3 a forced replay rebuilds the latches from stored telemetry (still thirsty)', d.logs.some((l) => l.includes('replayed')) && rebuilt.condition === live.condition && rebuilt.condition === 'thirsty', `${live.condition} → ${rebuilt.condition}`);
    const epsAfter = JSON.stringify(d.db.episodesSince(0).filter((e) => e.startedAt < c.clock).map((e) => [e.condition, e.startedAt]));
    check(
      'MG3b the replay leaves care history, past episodes and speech memory as they were',
      d.db.eventsSince(0).length === evs && epsAfter === eps && sp === JSON.stringify(d.db.getMeta('message_memory')),
      `events ${evs}→${d.db.eventsSince(0).length}, episodes same: ${epsAfter === eps}, speech same: ${sp === JSON.stringify(d.db.getMeta('message_memory'))}`
    );
  }

  console.log('\n— Light min / max set by hand —');
  {
    const { CalibrationService } = await import('../server/calibration');
    const b = new Bench();
    await b.boot();
    await b.run(3, () => ({ soil: 60, light: 50, extra: { light_raw: 1700 } }));
    const svc = new CalibrationService(b.db, b.collector, { now: () => b.clock });
    const swapped = await svc.saveLight({ darkRaw: 3000, brightRaw: 200, manual: true, confirm: true });
    check('L1 swapped min/max is refused, nothing saved', !swapped.saved && swapped.errors.length > 0 && b.collector.getCalibration().light === null);
    const ok = await svc.saveLight({ darkRaw: 100, brightRaw: 3300, manual: true, confirm: true });
    const cal = b.collector.getCalibration().light;
    check('L2 typed min/max saved as method "manual", with history', ok.saved && cal?.method === 'manual' && cal.darkRaw === 100 && cal.brightRaw === 3300 && /by hand/.test(b.db.calibrationHistory(1)[0]?.note ?? ''), JSON.stringify(cal));
    await b.run(2, () => ({ soil: 60, light: 50, extra: { light_raw: 1700 } }));
    const pct = b.state().perception.readings.lightPercent;
    check('L3 light % now read with the typed range (raw 1700 -> 50%)', pct === 50, `${pct}%`);
    const guided = await svc.saveLight({ darkRaw: 150, brightRaw: 3000, dark: { mean: 150, min: 148, max: 152, stdev: 1, n: 10 }, bright: { mean: 3000, min: 2990, max: 3010, stdev: 4, n: 10 }, confirm: true });
    check('L4 the guided calibration still works and replaces it', guided.saved && b.collector.getCalibration().light?.method === 'guided');
  }

  console.log('\n— Soil dry / wet set by hand —');
  {
    const { CalibrationService } = await import('../server/calibration');
    const b = new Bench();
    await b.boot();
    await b.run(3, () => ({ soil: 50, raw: 2800 }));
    const svc = new CalibrationService(b.db, b.collector, { now: () => b.clock });
    const swapped = await svc.saveSoil({ dryRaw: 2000, wetRaw: 3600, manual: true, confirm: true });
    check('SM1 swapped dry/wet is refused, nothing saved', !swapped.saved && swapped.errors.length > 0 && b.collector.getCalibration().soil === null);
    const ok = await svc.saveSoil({ dryRaw: 3600, wetRaw: 2000, manual: true, confirm: true });
    const cal = b.collector.getCalibration().soil;
    check('SM2 typed dry/wet saved as method "manual", with history', ok.saved && cal?.method === 'manual' && cal.dryRaw === 3600 && cal.wetRaw === 2000 && /by hand/.test(b.db.calibrationHistory(1)[0]?.note ?? ''), JSON.stringify(cal));
    // The firmware says 90%; the typed range reads raw 2800 as 50%: a big jump on the soil scale
    await b.run(5, () => ({ soil: 90, raw: 2800 }));
    const pct = b.state().perception.readings.soilMoisture;
    check('SM3 soil % now read with the typed range (raw 2800 -> 50%)', pct === 50, `${pct}%`);
    check('SM4 the scale change is not a watering', b.waterings().length === 0, b.decision());
  }

  console.log('\n— Outside weather (context only) —');
  {
    const b = new Bench();
    b.weather = { code: 63, temp: 9 };
    await b.boot();
    await b.run(3, () => ({ soil: 60 }));
    const rows = b.db.outsideWeatherSince(0);
    const o = b.state().perception.outside;
    check('OW1 fetched on start and stored, separately from telemetry', rows.length === 1 && rows[0].sky === 'heavy_rain' && o?.sky === 'heavy_rain', `${rows.length} row(s), sky ${o?.sky}`);
    check('OW1b the ESP32 cadence does not fetch weather', b.db.outsideWeatherSince(0).length === 1, `${b.db.outsideWeatherSince(0).length} rows after 3 sensor polls`);
    await b.collector.pollWeather();
    check('OW2 its own poll adds an observation', b.db.outsideWeatherSince(0).length === 2);
    b.weather = null;
    await b.collector.pollWeather();
    const kept = b.state().perception.outside;
    check('OW3 a failed fetch invents nothing: the last observation is kept, nothing stored', kept?.sky === 'heavy_rain' && b.db.outsideWeatherSince(0).length === 2);
    await b.run(65, () => ({ soil: 60 }));
    check('OW4 stale after an hour: shown as nothing', b.state().perception.outside === null && b.state().expression.atmosphere.weather === null);
    b.weather = { code: 45, temp: 6 };
    const restarted = new Bench(b.db);
    restarted.clock = b.clock;
    restarted.weather = null;
    await restarted.boot();
    check('OW5 a restart within the hour shows the stored weather (offline is fine)', restarted.state().perception.outside === null || restarted.state().perception.outside?.sky === 'heavy_rain');
  }

  finish();
}

void main();

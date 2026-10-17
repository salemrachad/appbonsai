// Shared test bench for the scenario scripts: the real LivingCollector with an in-memory SQLite DB,
// the real normalizer and engines, a fake ESP32 and a simulated clock.
import { LivingCollector } from '../server/collector';
import { AppDatabase } from '../server/database';
import { addDevice } from '../server/devices';
import { handleIngest } from '../server/ingest';
import { DEFAULT_SETTINGS, TreeSettings } from '../src/settings/settings';
import { normalizeESP32Payload } from '../src/telemetry/telemetryNormalizer';
import { skyFromCode, type OutsideObservation } from '../src/telemetry/outsideWeather';
import type { TelemetryFetchResult } from '../src/telemetry/types';
import type { DayForecast } from '../src/telemetry/hikeForecast';

export const MIN = 60 * 1000;
export const HOUR = 60 * MIN;
export const START = new Date(2026, 5, 15, 9, 0).getTime(); // a June morning in Feytroun

let fails = 0;
export const check = (name: string, ok: boolean, info = '') => {
  if (!ok) fails++;
  console.log(`${ok ? '✓' : '✗'} ${name}${info ? `  — ${info}` : ''}`);
};
export const finish = () => {
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exitCode = fails ? 1 : 0;
};

export interface Reading {
  soil: number;
  raw?: number;
  temp?: number;
  hum?: number;
  light?: number;
  extra?: Record<string, unknown>;
}

// A test bench: one database, a clock, a fake ESP32, and a collector that can be "restarted".
export class Bench {
  clock = START;
  online = true;
  payload: Record<string, unknown> = {};
  // Fake outside weather (WMO code, °C). null = Open-Meteo unreachable. Never the real network in tests.
  weather: { code: number; temp?: number; gusts?: number } | null = null;
  // Fake daily forecast for the hike pick (empty: none). Never the real network in tests.
  hikeDays: DayForecast[] = [];
  collector!: LivingCollector;
  logs: string[] = [];
  constructor(public db = new AppDatabase(':memory:')) {
    const settings: TreeSettings = {
      ...DEFAULT_SETTINGS,
      dataSource: 'esp32_sensor',
      esp32EndpointUrl: 'http://bonsai.test',
      telemetryIntervalMs: MIN,
      latitude: 33.97,
      longitude: 35.73,
    };
    this.db.setMeta('collector_settings', settings);
  }
  private fetch = async (settings: TreeSettings): Promise<TelemetryFetchResult> => {
    if (!this.online) throw new Error('ETIMEDOUT');
    const current = normalizeESP32Payload(this.payload, settings);
    current.timestamp = this.clock;
    return { current, hourly: [], timeline: [], raw: this.payload };
  };
  private fetchWeather = async (_s: TreeSettings, now: number): Promise<{ observation: OutsideObservation; raw: unknown }> => {
    if (!this.weather) throw new Error('ENOTFOUND');
    const w = this.weather;
    const observation: OutsideObservation = {
      at: now, sky: skyFromCode(w.code), code: w.code, temperature: w.temp ?? 15, humidity: 80, precipitation: 0, cloudCover: 50, wind: 10, gusts: w.gusts ?? 15, isDay: true,
    };
    return { observation, raw: w };
  };
  async boot() {
    this.collector = new LivingCollector(this.db, {
      now: () => this.clock,
      fetchTelemetry: this.fetch,
      fetchOutsideWeather: this.fetchWeather,
      fetchHikeForecast: async (_s, now) => ({ fetchedAt: now, days: this.hikeDays }),
      autoSchedule: false,
      log: (m) => this.logs.push(m),
    });
    await this.collector.start();
  }
  // What the fake ESP32 measures now
  measure(r: Reading): Record<string, unknown> {
    const jitter = Math.round(Math.sin(this.clock / 61000) * 6);
    return {
      soil_moisture: r.soil,
      soil_raw: r.raw ?? Math.round(3600 - r.soil * 16) + jitter,
      temperature: r.temp ?? 24,
      humidity: r.hum ?? 60,
      light_percent: r.light ?? 50,
      light_raw: Math.round((r.light ?? 50) * 30) + jitter,
      light_lux: null,
      hts221_connected: true,
      wifi_rssi: -55,
      ...r.extra,
    };
  }
  // One poll, one minute later. null = ESP32 unreachable.
  async poll(r: Reading | null) {
    this.clock += MIN;
    this.online = r !== null;
    if (r) this.payload = this.measure(r);
    await this.collector.pollNow();
    return this.state();
  }

  // ---- push mode: the fake ESP32 sends its readings through the real POST /api/ingest handler ----
  device = { id: 'bench-esp32', token: '', boot: 'boot-1', bootAt: START, seq: 0, buffer: [] as Record<string, unknown>[] };
  // Before boot(): the device is added and the server is set to receive pushes
  usePush() {
    this.device.token = addDevice(this.db, this.device.id, 'bench', this.clock)!;
    this.db.setMeta('collector_settings', { ...this.db.getMeta<TreeSettings>('collector_settings'), esp32Transport: 'push' });
  }
  // The device restarts: a new boot, seq and uptime start over, the RAM buffer is lost
  reboot(boot: string) {
    this.device = { ...this.device, boot, bootAt: this.clock, seq: 0, buffer: [] };
  }
  // Send the buffer now, as the device would (the request is the device's to build: body overrides parts of it)
  send(body: Record<string, unknown> = {}, token = this.device.token) {
    const d = this.device;
    const res = handleIngest(
      this.db,
      this.collector,
      { authorization: `Bearer ${token}`, body: { v: 1, device_id: d.id, fw: 'bench', boot: d.boot, uptime_ms: this.clock - d.bootAt, readings: d.buffer, ...body } },
      this.clock
    );
    if (res.status === 200) d.buffer = [];
    return res;
  }
  // One minute later: the device measures and pushes (offline: its Wi-Fi is down and it keeps the reading;
  // null: it's off), and the server's timer looks for an overdue push. advance: 0 sends at the current minute.
  push(r: Reading | null, opts: { offline?: boolean; advance?: number } = {}) {
    this.clock += opts.advance ?? MIN;
    let res = null;
    if (r) {
      this.device.buffer.push({ ...this.measure(r), seq: ++this.device.seq, uptime_ms: this.clock - this.device.bootAt });
      if (!opts.offline) res = this.send();
    }
    this.collector.watchPush();
    return res;
  }
  pushRun(minutes: number, r: (i: number) => Reading | null, opts: { offline?: boolean } = {}) {
    for (let i = 0; i < minutes; i++) this.push(r(i), opts);
    return this.state();
  }
  async run(minutes: number, r: (i: number) => Reading | null) {
    for (let i = 0; i < minutes; i++) await this.poll(r(i));
    return this.state();
  }
  state() {
    return this.collector.currentState()!;
  }
  waterings() {
    return this.db.eventsSince(0).filter((e) => e.type === 'watering');
  }
  episodes() {
    return [...this.db.episodesSince(0)].sort((a, b) => a.startedAt - b.startedAt);
  }
  decision() {
    return this.collector.collectorStatus().wateringDetection.lastDecision ?? '';
  }
}

export const cond = (b: Bench) => {
  const h = b.state().health;
  return `${h.condition}${h.modifiers.length ? ` +${h.modifiers.join(',')}` : ''} v${h.vitality}`;
};
export const epList = (b: Bench) => b.episodes().map((e) => `${e.condition}${e.endedAt ? '' : '*'}`).join(' → ');

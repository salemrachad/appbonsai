// Shared test bench for the scenario scripts: the real LivingCollector with an in-memory SQLite DB,
// the real normalizer and engines, a fake ESP32 and a simulated clock.
import { LivingCollector } from '../server/collector';
import { AppDatabase } from '../server/database';
import { DEFAULT_SETTINGS, TreeSettings } from '../src/settings/settings';
import { normalizeESP32Payload } from '../src/telemetry/telemetryNormalizer';
import { skyFromCode, type OutsideObservation } from '../src/telemetry/outsideWeather';
import type { TelemetryFetchResult } from '../src/telemetry/types';

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
      autoSchedule: false,
      log: (m) => this.logs.push(m),
    });
    await this.collector.start();
  }
  // One poll, one minute later. null = ESP32 unreachable.
  async poll(r: Reading | null) {
    this.clock += MIN;
    this.online = r !== null;
    if (r) {
      const jitter = Math.round(Math.sin(this.clock / 61000) * 6);
      this.payload = {
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
    await this.collector.pollNow();
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

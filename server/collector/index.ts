import type { CollectorStatus, LivingSnapshot } from '../../src/api/types';
import { evaluateBehaviour } from '../../src/behaviour/BehaviourEngine';
import type { PlantBehaviourState, SlothMemory } from '../../src/behaviour/behaviourTypes';
import { slothLife } from '../../src/behaviour/sloth';
import { decideSpeech, INITIAL_MESSAGE_MEMORY, MessageMemory } from '../../src/behaviour/speech';
import { APP_CONFIG } from '../../src/config/appConfig';
import { expressBehaviour } from '../../src/expression/ExpressionEngine';
import type { ExpressionState } from '../../src/expression/expressionTypes';
import { evaluatePlantHealth, HEALTH_MEMORY_VERSION, HealthMemory, initialHealthMemory } from '../../src/health/HealthEngine';
import type { PlantHealthState } from '../../src/health/healthTypes';
import type { Interaction, PlantEvent, PlantEventType, TelemetryRecord } from '../../src/history/historyTypes';
import { continuityGapMs, perceive, toSample } from '../../src/perception/PerceptionEngine';
import type { PerceptionSample, PerceptionState } from '../../src/perception/perceptionTypes';
import type { TreeSettings } from '../../src/settings/settings';
import { ACTIVE_SPECIES } from '../../src/species';
import type { SensorCalibration } from '../../src/telemetry/calibration';
import { assessDataQuality } from '../../src/telemetry/dataQuality';
import { normalizeTelemetryEndpoint } from '../../src/telemetry/ESP32TelemetryProvider';
import { fetchOutsideWeather, type OutsideObservation } from '../../src/telemetry/outsideWeather';
import { fetchHikeForecast, type HikeForecast } from '../../src/telemetry/hikeForecast';
import { INITIAL_HIKE_MEMORY, planHike, type HikeMemory } from '../../src/behaviour/hike';
import { telemetryManager } from '../../src/telemetry/telemetryManager';
import type { HourlyTelemetryPoint, LiveReading, PlantTelemetry, TelemetryFetchResult, TelemetrySource, TimelineEvent } from '../../src/telemetry/types';
import type { AppDatabase } from '../database';
import { trackEpisode } from '../episodes';
import { logCareEvent } from './careEvents';
import { recordInteraction } from './interactions';
import { MetaStore } from './metaStore';
import { fromRecord, stamp, toLive } from './records';
import { SettingsStore } from './settings';
import { WateringDetection } from './watering';
import { DAY, HOUR } from '../../src/lib/time';

// The collector, one job per file:
//   index.ts        the living loop (below): poll → store → perception → health → episodes → behaviour → expression,
//                   restarts and replays, the outside weather, what the API reads
//   settings.ts     settings + sensor calibration as stored on the server
//   watering.ts     sensor-detected waterings and the detection pause
//   careEvents.ts   care logged by hand (merged with what the sensor saw)
//   interactions.ts petting sessions (attention, not care)
//   metaStore.ts    the typed `meta` keys (saved memories, settings, calibration)
//   records.ts      stored rows → the shapes the engines and the UI read
export { fromRecord } from './records';


export interface CollectorOptions {
  now?: () => number; // clock (scenario tests run simulated time)
  fetchTelemetry?: (settings: TreeSettings) => Promise<TelemetryFetchResult>;
  fetchOutsideWeather?: (settings: TreeSettings, now: number) => Promise<{ observation: OutsideObservation; raw: unknown }>;
  fetchHikeForecast?: (settings: TreeSettings, now: number) => Promise<HikeForecast>;
  autoSchedule?: boolean; // false: only poll when pollNow() is called (tests)
  log?: (msg: string) => void;
}

// What perception reads from the database, loaded once for a whole replay
interface PerceiveContext {
  skies: OutsideObservation[]; // outside observations from the replay's first day on (ascending)
  soilBreaks: number[];
}

const dayStartOf = (t: number) => new Date(t).setHours(0, 0, 0, 0);

// The living loop: ESP32 → SQLite → perception → health → episodes → behaviour → expression.
// Runs only while the local server runs; nothing is collected when the PC is off.
export class LivingCollector {
  private readonly meta: MetaStore;
  private readonly store: SettingsStore;
  private readonly watering: WateringDetection;
  private memory: HealthMemory = initialHealthMemory();
  private recent: PerceptionSample[] = [];
  private latest: PlantTelemetry | null = null;
  private previous: PlantTelemetry | null = null;
  private liveReadings: LiveReading[] = [];
  private forecast: { hourly: HourlyTelemetryPoint[]; timeline: TimelineEvent[] } = { hourly: [], timeline: [] };
  private timer: ReturnType<typeof setTimeout> | undefined;
  private weatherTimer: ReturnType<typeof setTimeout> | undefined;
  private outside: OutsideObservation | null = null; // latest outside weather (context only)
  private outsideError: string | null = null;
  private hikeTimer: ReturnType<typeof setTimeout> | undefined;
  private hikeMemory: HikeMemory = INITIAL_HIKE_MEMORY; // the daily forecast + the week's hike picks
  private hikeError: string | null = null;
  private polling: Promise<void> | null = null;
  private repoll = false;
  private messageMemory: MessageMemory = INITIAL_MESSAGE_MEMORY;
  private changeListeners = new Set<() => void>();
  private status: Pick<CollectorStatus, 'lastPollAt' | 'lastSuccessAt' | 'lastError' | 'consecutiveFailures'> = {
    lastPollAt: null,
    lastSuccessAt: null,
    lastError: null,
    consecutiveFailures: 0,
  };
  private state: { perception: PerceptionState; health: PlantHealthState; behaviour: PlantBehaviourState; expression: ExpressionState } | null = null;
  private readonly now: () => number;
  private readonly fetchTelemetry: (settings: TreeSettings) => Promise<TelemetryFetchResult>;
  private readonly fetchOutside: (settings: TreeSettings, now: number) => Promise<{ observation: OutsideObservation; raw: unknown }>;
  private readonly fetchHike: (settings: TreeSettings, now: number) => Promise<HikeForecast>;
  private readonly autoSchedule: boolean;
  private readonly log: (msg: string) => void;

  constructor(private db: AppDatabase, opts: CollectorOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.fetchTelemetry = opts.fetchTelemetry ?? ((s) => telemetryManager.getTelemetry(s));
    this.fetchOutside = opts.fetchOutsideWeather ?? fetchOutsideWeather;
    this.fetchHike = opts.fetchHikeForecast ?? fetchHikeForecast;
    this.autoSchedule = opts.autoSchedule ?? true;
    this.log = opts.log ?? ((m) => console.log(m));
    this.meta = new MetaStore(db);
    this.store = new SettingsStore(db, this.meta, this.now, this.log);
    this.watering = new WateringDetection(db, this.meta, this.log, (at) => this.store.watered(at));
    const speech = this.meta.get('message_memory');
    if (speech?.version === INITIAL_MESSAGE_MEMORY.version) this.messageMemory = { ...INITIAL_MESSAGE_MEMORY, ...speech };
    const hike = this.meta.get('hike_memory');
    if (hike?.version === INITIAL_HIKE_MEMORY.version) this.hikeMemory = hike;
  }

  private get settings(): TreeSettings {
    return this.store.settings;
  }
  private get calibration(): SensorCalibration {
    return this.store.calibration;
  }

  // ---- lifecycle ----
  start(): Promise<void> {
    this.restore();
    this.outside = this.db.latestOutsideWeather();
    void this.pollWeather();
    void this.pollHikeForecast();
    return this.pollNow();
  }

  stop() {
    clearTimeout(this.timer);
    clearTimeout(this.weatherTimer);
    clearTimeout(this.hikeTimer);
  }

  // The daily forecast for the weekly hike pick: every few hours, about the people (never the tree).
  // A failure keeps the last forecast (the plan shows its age) and retries sooner.
  async pollHikeForecast(): Promise<void> {
    clearTimeout(this.hikeTimer);
    if (this.settings.latitude == null || this.settings.longitude == null) return;
    let ok = false;
    try {
      const forecast = await this.fetchHike(this.settings, this.now());
      ok = true;
      if (this.hikeError) this.log('[collector] hike forecast back');
      this.hikeError = null;
      if (forecast.days.length) {
        this.hikeMemory = { ...this.hikeMemory, forecast };
        this.meta.set('hike_memory', this.hikeMemory);
        if (this.state) this.evaluate(this.now());
      }
    } catch (err: any) {
      const msg = err?.cause?.code ?? err?.message ?? String(err);
      if (!this.hikeError) this.log(`[collector] hike forecast unavailable: ${msg}`);
      this.hikeError = msg;
    }
    if (this.autoSchedule) this.hikeTimer = setTimeout(() => void this.pollHikeForecast(), ok ? APP_CONFIG.hike.forecastMs : APP_CONFIG.hike.retryMs);
  }

  // Outside weather: its own cadence (15 min) in every data source mode, independent of the ESP32.
  // Context only. A failure keeps the last observation, which goes stale on its own (never invented).
  async pollWeather(): Promise<void> {
    clearTimeout(this.weatherTimer);
    if (this.autoSchedule) this.weatherTimer = setTimeout(() => void this.pollWeather(), APP_CONFIG.polling.weatherMs);
    if (this.settings.latitude == null || this.settings.longitude == null) return;
    try {
      const { observation, raw } = await this.fetchOutside(this.settings, this.now());
      this.outside = observation;
      this.db.insertOutsideWeather(observation, raw);
      if (this.outsideError) this.log('[collector] outside weather back');
      this.outsideError = null;
    } catch (err: any) {
      const msg = err?.cause?.code ?? err?.message ?? String(err);
      if (!this.outsideError) this.log(`[collector] outside weather unavailable: ${msg}`);
      this.outsideError = msg;
    }
    if (this.state) this.evaluate(this.now());
  }

  // After importing old readings: rebuild state from the database.
  reloadHistory() {
    this.replay(this.now());
    this.evaluate(this.now());
  }

  private source(): TelemetrySource {
    return this.settings.dataSource === 'weather_estimate' ? 'weather_estimate' : 'esp32_sensor';
  }

  pollMs(): number {
    if (this.settings.dataSource === 'weather_estimate') return APP_CONFIG.polling.weatherMs;
    const p = APP_CONFIG.polling;
    return Math.min(p.telemetryMaxMs, Math.max(p.telemetryMinMs, this.settings.telemetryIntervalMs ?? p.telemetryMs));
  }

  private location() {
    return { latitude: this.settings.latitude ?? null, longitude: this.settings.longitude ?? null };
  }

  // The sloth's loyalty (art): derived from the stored readings of its last days, as of today's start. Kept
  // in memory for the day (a new day, source, location or calibration derives it again); never stored.
  private slothCache: { key: string; memory: SlothMemory } | null = null;
  private slothMemory(now: number, cadenceMs: number): SlothMemory {
    const today = new Date(now).setHours(0, 0, 0, 0);
    const loc = this.location();
    const key = JSON.stringify([today, this.source(), loc, this.calibration]);
    if (this.slothCache?.key === key) return this.slothCache.memory;
    const days = APP_CONFIG.habitat.sloth.loyalty.days;
    const from = today - days * DAY;
    const samples = this.db.telemetrySince(this.source(), from - 6 * HOUR, today).flatMap((r) => {
      const t = fromRecord(r, this.calibration, false);
      return t ? [toSample(t, ACTIVE_SPECIES, loc)] : [];
    });
    const { memory } = slothLife(samples, this.db.outsideWeatherSince(from - 6 * HOUR), this.db.episodesSince(from), ACTIVE_SPECIES, cadenceMs, today, days);
    this.slothCache = { key, memory };
    return memory;
  }

  // ---- continuity across restarts ----

  // Resume where the tree was: saved health memory (hysteresis, vitality, recovery, uncertainty),
  // the last 24 h of readings for perception, and the watering detector's recent context.
  // Without a usable saved memory, fall back to replaying stored telemetry.
  private restore() {
    const now = this.now();
    const saved = this.meta.get('health_memory');
    const usable =
      saved && saved.engineVersion === APP_CONFIG.engineVersion && saved.source === this.source() && saved.memory?.version === HEALTH_MEMORY_VERSION;
    if (!usable) {
      this.replay(now);
    } else {
      this.memory = saved.memory;
      this.loadRecent(now);
      // Readings stored after the memory was saved (normally none): catch up
      const rows = this.db.telemetrySince(this.source(), (saved.memory.at ?? 0) + 1, now);
      if (rows.length) this.replayRows(rows, this.db.eventsSince(now - 30 * DAY));
      this.log(`[collector] resumed saved health memory from ${saved.memory.at ? new Date(saved.memory.at).toLocaleString() : 'never'}`);
    }
    this.watering.restore(now, this.calibration);
  }

  private loadRecent(now: number) {
    const rows = this.db.telemetrySince(this.source(), now - DAY, now);
    const ts = rows.flatMap((r) => {
      const t = fromRecord(r, this.calibration, false);
      return t ? [t] : [];
    });
    this.recent = ts.map((t) => toSample(t, ACTIVE_SPECIES, this.location()));
    this.latest = stamp(ts[ts.length - 1] ?? null);
    this.previous = stamp(ts[ts.length - 2] ?? null);
    this.liveReadings = ts.slice(-APP_CONFIG.diagnostics.liveReadingsKept).map(toLive);
  }

  // Rebuild hysteresis + vitality from stored observations. Episodes are not rewritten.
  private replay(now: number) {
    const rows = this.db.telemetrySince(this.source(), now - APP_CONFIG.history.replayHours * HOUR, now);
    this.memory = initialHealthMemory();
    this.recent = [];
    this.latest = null;
    this.previous = null;
    this.replayRows(rows, this.db.eventsSince(now - 30 * DAY));
    this.liveReadings = rows.slice(-APP_CONFIG.diagnostics.liveReadingsKept).flatMap((r) => {
      const t = fromRecord(r, this.calibration, false);
      return t ? [toLive(t)] : [];
    });
    this.log(`[collector] replayed ${rows.length} readings from the last ${APP_CONFIG.history.replayHours}h`);
  }

  // The database doesn't change during a replay: today's skies and the soil breaks are read once, not per row
  private replayRows(rows: TelemetryRecord[], events: PlantEvent[]) {
    if (!rows.length) return;
    const context: PerceiveContext = { skies: this.db.outsideWeatherSince(dayStartOf(rows[0].timestamp) - HOUR), soilBreaks: this.soilBreaks() };
    for (const row of rows) {
      const t = fromRecord(row, this.calibration, false);
      if (!t) continue;
      this.previous = this.latest;
      this.latest = t;
      this.recent.push(toSample(t, ACTIVE_SPECIES, this.location()));
      const perception = this.perceiveAt(t.timestamp, events, null, null, context);
      this.memory = evaluatePlantHealth({ perception, species: ACTIVE_SPECIES, memory: this.memory, tempUnit: this.settings.temperatureUnit }).memory;
    }
    this.latest = stamp(this.latest);
    this.previous = stamp(this.previous);
  }

  private perceiveAt(now: number, events: PlantEvent[], deviceError: string | null = null, outside: OutsideObservation | null = null, context?: PerceiveContext): PerceptionState {
    const since = dayStartOf(now) - HOUR;
    const skies = context ? context.skies.filter((o) => o.at >= since) : this.db.outsideWeatherSince(since);
    return perceive({
      outside,
      soilBreaks: context?.soilBreaks ?? this.soilBreaks(),
      // Today's skies: a grey day explains dim light (also on replay, from the stored observations)
      outsideToday: skies.filter((o) => o.at <= now + 15 * 60_000),
      latest: this.latest,
      previous: this.previous,
      recent: this.recent,
      events: events.filter((e) => e.timestamp <= now),
      location: this.location(),
      pollMs: this.pollMs(),
      deviceError,
      species: ACTIVE_SPECIES,
      now,
    });
  }

  // Soil calibration changes and the detection pause (probe being handled): a dry-down never bridges them
  private soilBreaks(): number[] {
    const changes = this.db.calibrationHistory(20).filter((h) => h.sensor === 'soil').map((h) => h.timestamp);
    const pausedUntil = this.meta.get('watering_detection_suppressed_until') ?? 0;
    return pausedUntil > 0 ? [...changes, pausedUntil] : changes;
  }

  // ---- polling ----
  private schedule() {
    clearTimeout(this.timer);
    if (this.autoSchedule) this.timer = setTimeout(() => void this.pollNow(), this.pollMs());
  }

  // Read now. If a poll is already running (maybe with old settings), read again right after it.
  pollNow(): Promise<void> {
    if (this.polling) {
      this.repoll = true;
      return this.polling.then(() => this.polling ?? undefined);
    }
    this.polling = this.poll().finally(() => {
      this.polling = null;
      if (this.repoll) {
        this.repoll = false;
        void this.pollNow();
      } else {
        this.schedule();
      }
    });
    return this.polling;
  }

  private async poll() {
    this.status.lastPollAt = this.now();
    let result: TelemetryFetchResult;
    try {
      result = await this.fetchTelemetry(this.store.forFetch());
    } catch (err: any) {
      // Never invent a reading: the last one goes stale and the tree's state is held, then uncertain
      this.status.lastError = err?.cause?.code ?? err?.message ?? String(err);
      this.status.consecutiveFailures++;
      if (this.status.consecutiveFailures === 1) this.log(`[collector] poll failed: ${this.status.lastError}`);
      this.evaluate(this.now());
      return;
    }

    const t = result.current;
    if (this.status.consecutiveFailures > 0) this.log(`[collector] sensor back after ${this.status.consecutiveFailures} failed polls`);
    this.status.lastError = null;
    this.status.consecutiveFailures = 0;
    this.status.lastSuccessAt = t.timestamp;
    if (t.source === 'weather_estimate') this.forecast = { hourly: result.hourly, timeline: result.timeline };

    // Source changed (auto mode fell back, or settings changed): history continuity starts over
    if (this.latest && this.latest.source !== t.source) {
      this.latest = null;
      this.previous = null;
      this.recent = [];
    }

    const quality = assessDataQuality({ telemetry: t, previous: this.latest, pollMs: this.pollMs(), historyMinutes: 999, deviceError: null, now: t.timestamp });
    this.db.insertTelemetry(
      {
        timestamp: t.timestamp,
        source: t.source,
        deviceId: t.source === 'esp32_sensor' && this.settings.esp32EndpointUrl ? normalizeTelemetryEndpoint(this.settings.esp32EndpointUrl) : null,
        soilMoisture: t.soilMoisture,
        apiSoilMoisture: t.apiSoilMoisture ?? null,
        soilRaw: t.soilRaw ?? null,
        temperature: t.temperature,
        humidity: t.humidity,
        lightPercent: t.lightPercent ?? null,
        lightRaw: t.lightRaw ?? null,
        radiation: t.radiation ?? null,
        wifiRssi: t.wifiRssi ?? null,
        dataQuality: quality.confidence,
      },
      result.raw
    );

    if (t.source === 'esp32_sensor') this.watering.step(t, this.state?.health.condition ?? null, continuityGapMs(this.pollMs()));

    this.previous = this.latest;
    this.latest = t;
    this.recent.push(toSample(t, ACTIVE_SPECIES, this.location()));
    if (this.recent.length > 3000) this.recent = this.recent.filter((s) => s.t >= t.timestamp - DAY);
    this.liveReadings = [...this.liveReadings, toLive(t)].slice(-APP_CONFIG.diagnostics.liveReadingsKept);

    this.evaluate(this.now());
  }

  // Pause watering detection while the probe is handled (calibration). minutes = 0 ends the pause.
  suppressWateringDetection(minutes = APP_CONFIG.watering.calibrationSuppressMs / 60000) {
    return this.watering.suppress(this.now(), minutes);
  }

  // Perception → health → episodes → behaviour → expression, for the current moment.
  private evaluate(now: number) {
    const events = this.db.eventsSince(now - 30 * DAY);
    const perception = this.perceiveAt(now, events, this.status.lastError, this.outside);
    const { state: health, memory } = evaluatePlantHealth({
      perception,
      species: ACTIVE_SPECIES,
      memory: this.memory,
      tempUnit: this.settings.temperatureUnit,
    });
    this.memory = memory;
    this.meta.set('health_memory', { engineVersion: APP_CONFIG.engineVersion, source: this.source(), memory });
    trackEpisode(this.db, health, now, { pollMs: this.pollMs(), gapMs: perception.history.gapMs });
    const episodes = this.db.episodesSince(now - 30 * DAY);
    // Attention goes only into relationship memory (never perception or health)
    const interactions = this.db.interactionsSince(now - 30 * DAY);
    // The week's hike pick: follows the forecast until its day arrives, then locks (about the people)
    const hike = planHike(this.hikeMemory, now);
    if (hike.memory !== this.hikeMemory) {
      this.hikeMemory = hike.memory;
      this.meta.set('hike_memory', hike.memory);
    }
    const behaviour = evaluateBehaviour({
      health,
      perception,
      episodes,
      events,
      interactions,
      species: ACTIVE_SPECIES,
      now,
      location: this.location(),
      wanderers: { sloth: this.slothMemory(now, perception.history.cadenceMs) },
      moodMemory: this.meta.get('mood_memory'),
      hike: hike.plan,
    });
    this.meta.set('mood_memory', behaviour.moodState.memory);
    // When to speak or stay quiet; persisted so refreshes and restarts don't replay lines
    const speech = decideSpeech({ behaviour, severity: health.severity, memory: this.messageMemory, now });
    if (speech.memory !== this.messageMemory) {
      this.messageMemory = speech.memory;
      this.meta.set('message_memory', speech.memory);
    }
    const expression = expressBehaviour({ behaviour, health, perception, speech: speech.decision, now });
    this.state = { perception, health, behaviour, expression };
    for (const fn of this.changeListeners) fn();
  }

  // Told after every evaluation (poll, care, settings, weather): /api/stream pushes the new state
  onChange(fn: () => void): () => void {
    this.changeListeners.add(fn);
    return () => this.changeListeners.delete(fn);
  }

  // ---- settings ----
  getSettings(): { settings: TreeSettings; configured: boolean } {
    return { settings: this.settings, configured: this.store.configured };
  }

  updateSettings(next: Partial<TreeSettings>) {
    const changed = this.store.update(next);
    if (changed('dataSource') || changed('latitude') || changed('longitude')) {
      this.replay(this.now());
    }
    if (changed('latitude') || changed('longitude')) {
      this.outside = null; // weather from the old place no longer describes this one
      void this.pollWeather();
      this.hikeMemory = { ...this.hikeMemory, forecast: null }; // nor does its forecast (the picks stay)
      this.meta.set('hike_memory', this.hikeMemory);
      void this.pollHikeForecast();
    }
    // A new device or calibration changes the soil scale: that must never look like a watering
    if (changed('esp32EndpointUrl')) this.suppressWateringDetection();
    if (changed('dataSource') || changed('esp32EndpointUrl') || changed('telemetryIntervalMs')) {
      void this.pollNow();
    } else if (this.state) {
      this.evaluate(this.now());
    }
  }

  // ---- calibration (server-owned; changes interpretation, never stored raw telemetry) ----
  getCalibration(): SensorCalibration {
    return this.calibration;
  }

  // Save a new calibration for one sensor (null = back to the firmware's own %), with history.
  applyCalibration(sensor: 'soil' | 'light', value: SensorCalibration['soil'] | SensorCalibration['light'], note: string | null) {
    this.store.setCalibration(sensor, value, note);
    // The soil scale changed: that must not look like a watering, and recent state is re-read with it
    if (sensor === 'soil') this.suppressWateringDetection();
    this.replay(this.now());
    void this.pollNow();
  }

  // One raw reading straight from the device (calibration captures; not stored as telemetry).
  async readRaw(): Promise<{ soilRaw: number | null; lightRaw: number | null; soilPercent: number; lightPercent: number | null; at: number }> {
    const r = await this.fetchTelemetry(this.store.forFetch());
    const t = r.current;
    return { soilRaw: t.soilRaw ?? null, lightRaw: t.lightRaw ?? null, soilPercent: t.soilMoisture, lightPercent: t.lightPercent ?? null, at: t.timestamp };
  }

  // ---- attention (not care): stored for relationship memory only, never triggers an evaluation ----
  recordInteraction(body: unknown): { ok: true; interaction: Interaction; merged: boolean } | { ok: false; status: number; error: string } {
    return recordInteraction(this.db, body, this.now());
  }

  // ---- care events ----
  logEvent(type: PlantEventType, note: string | null, timestamp = this.now()): PlantEvent | null {
    const { event, wateredAt } = logCareEvent(
      this.db,
      { type, note, timestamp },
      { soilMoisture: this.state?.perception.readings.soilMoisture ?? null, condition: this.state?.health.condition ?? null }
    );
    if (wateredAt !== null) this.store.watered(wateredAt);
    this.evaluate(this.now());
    return event;
  }

  deleteEvent(id: number): boolean {
    const ok = this.db.deleteEvent(id);
    if (ok) this.evaluate(this.now());
    return ok;
  }

  // ---- outputs ----
  collectorStatus(): CollectorStatus {
    return {
      dataSource: this.settings.dataSource,
      endpoint: this.settings.esp32EndpointUrl ? normalizeTelemetryEndpoint(this.settings.esp32EndpointUrl) : null,
      pollMs: this.pollMs(),
      ...this.status,
      wateringDetection: {
        suppressedUntil: this.watering.suppressedUntil > this.now() ? this.watering.suppressedUntil : null,
        lastDecision: this.watering.lastDecision,
      },
    };
  }

  isConfigured() {
    return this.store.configured;
  }

  // For tests and diagnostics
  currentState() {
    return this.state;
  }

  snapshot(): Omit<LivingSnapshot, 'status' | 'serverTime'> {
    const now = this.now();
    const s = this.state;
    return {
      // The 24 h of samples and today's skies stay on the server: the UI never reads them (they were
      // most of the payload), and the browser's preview engines run without history anyway
      perception: s ? { ...s.perception, recent: [], outsideToday: [] } : null,
      health: s?.health ?? null,
      behaviour: s?.behaviour ?? null,
      expression: s?.expression ?? null,
      forecast: this.settings.dataSource === 'esp32_sensor' ? { hourly: [], timeline: [] } : this.forecast,
      liveReadings: this.liveReadings,
      recentEvents: this.db.eventsSince(now - 30 * DAY, 200),
      recentEpisodes: this.db.episodesSince(now - 30 * DAY),
    };
  }
}

import type { PlantBehaviourState } from '../behaviour/behaviourTypes';
import type { ExpressionState } from '../expression/expressionTypes';
import type { PlantHealthState } from '../health/healthTypes';
import type { BehaviourEpisode, PlantEvent } from '../history/historyTypes';
import type { PerceptionState } from '../perception/perceptionTypes';
import type { CaptureStats, SensorCalibration, Validation } from '../telemetry/calibration';
import type { HourlyTelemetryPoint, LiveReading, TimelineEvent } from '../telemetry/types';

export interface CalibrationHistoryEntry {
  id: number;
  timestamp: number;
  sensor: string;
  old: unknown;
  next: unknown;
  note: string | null;
}
export interface CalibrationState {
  calibration: SensorCalibration;
  history: CalibrationHistoryEntry[];
}
export interface CaptureResult extends CaptureStats {
  sensor: 'soil' | 'light';
  raws: number[];
  warnings: string[];
}
export interface CalibrationSaveResult extends Validation {
  saved: boolean;
  preview: { raw: number | null; percent: number | null } | null;
  calibration: SensorCalibration;
}

// Contract between the local Appbonsai server (port 3001) and the frontend.

export interface CollectorStatus {
  dataSource: string;
  transport?: 'pull' | 'push'; // missing on older servers (= pull)
  endpoint: string | null; // pull mode: the ESP32 address the server reads
  devices?: { id: string; label: string | null; lastSeenAt: number | null; firmware: string | null }[]; // devices allowed to push
  pollMs: number;
  lastPollAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  consecutiveFailures: number;
  wateringDetection: { suppressedUntil: number | null; lastDecision: string | null };
}

// Which backend this is, so the UI can say whose collector and database it is looking at.
export interface BackendInfo {
  mode: 'production' | 'local-dev'; // production = the authoritative Pi; local-dev = a separate dev database
  hostname: string; // machine the server runs on
  host: string; // address it listens on
  port: number;
  dbPath: string;
  collector: string;
  servesApp: boolean; // serves the built frontend from dist/
}

export interface ServerStatus {
  ok: true;
  backend?: BackendInfo; // missing on servers older than this field
  startedAt: number;
  engineVersion: string;
  dbPath: string;
  configured: boolean; // settings have been received from a browser at least once
  collector: CollectorStatus;
  counts: { telemetry: number; events: number; episodes: number; interactions?: number };
  oldestTelemetryAt: number | null;
}

// Everything the companion screen needs, in one poll.
export interface LivingSnapshot {
  serverTime: number;
  status: ServerStatus;
  perception: PerceptionState | null; // `recent` trimmed to the diagnostics window
  health: PlantHealthState | null;
  behaviour: PlantBehaviourState | null;
  expression: ExpressionState | null;
  forecast: { hourly: HourlyTelemetryPoint[]; timeline: TimelineEvent[] }; // weather mode only
  liveReadings: LiveReading[];
  recentEvents: PlantEvent[]; // last 30 days, newest first
  recentEpisodes: BehaviourEpisode[]; // last 30 days, newest first
}

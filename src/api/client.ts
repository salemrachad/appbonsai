import type { BehaviourEpisode, DailySummary, DiaryItem, HourlyBucket, PlantEvent, PlantEventType } from '../history/historyTypes';
import type { TreeSettings } from '../settings/settings';
import type { CalibrationSaveResult, CalibrationState, CaptureResult, LivingSnapshot, ServerStatus } from './types';
import type { CaptureStats } from '../telemetry/calibration';

// Frontend → local Appbonsai server. Vite proxies /api to http://localhost:3001.
async function call<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(init?.timeoutMs ?? 8000),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export interface ServerTestResult {
  success: boolean;
  soilMoisture?: number | null;
  soilRaw?: number | null;
  error?: string;
  normalizedUrl: string;
}

export const api = {
  current: () => call<LivingSnapshot>('/current', { timeoutMs: 5000 }),
  status: () => call<ServerStatus>('/status'),
  refresh: () => call<LivingSnapshot>('/refresh', { method: 'POST', timeoutMs: 15000 }),

  getConfig: () => call<{ settings: TreeSettings; configured: boolean }>('/config'),
  putConfig: (settings: TreeSettings) => call<{ settings: TreeSettings; configured: boolean }>('/config', { method: 'PUT', body: JSON.stringify(settings) }),

  events: (days = 30) => call<PlantEvent[]>(`/events?days=${days}`),
  logEvent: (type: PlantEventType, note?: string, timestamp?: number) =>
    call<PlantEvent>('/events', { method: 'POST', body: JSON.stringify({ type, note, timestamp }) }),
  deleteEvent: (id: number) => call<void>(`/events/${id}`, { method: 'DELETE' }),

  hourly: (hours = 24) => call<HourlyBucket[]>(`/history/hourly?hours=${hours}`),
  daily: (days = 7) => call<DailySummary[]>(`/history/daily?days=${days}`),
  diary: (days = 3) => call<DiaryItem[]>(`/history/diary?days=${days}`),
  episodes: (days = 30) => call<BehaviourEpisode[]>(`/history/episodes?days=${days}`),

  calibration: () => call<CalibrationState>('/calibration'),
  captureCalibration: (sensor: 'soil' | 'light') =>
    call<CaptureResult>('/calibration/capture', { method: 'POST', body: JSON.stringify({ sensor }), timeoutMs: 90000 }),
  saveSoilCalibration: (b: { dryRaw: number; wetRaw: number; dry?: CaptureStats; wet?: CaptureStats; confirm?: boolean; dryRun?: boolean }) =>
    call<CalibrationSaveResult>('/calibration/soil', { method: 'POST', body: JSON.stringify(b), timeoutMs: 15000 }),
  saveLightCalibration: (b: { darkRaw: number; brightRaw: number; dark?: CaptureStats; bright?: CaptureStats; confirm?: boolean; dryRun?: boolean }) =>
    call<CalibrationSaveResult>('/calibration/light', { method: 'POST', body: JSON.stringify(b), timeoutMs: 15000 }),
  clearCalibration: (sensor: 'soil' | 'light') => call<CalibrationState>(`/calibration/${sensor}`, { method: 'DELETE' }),
  pauseWateringDetection: (minutes: number) =>
    call<{ suppressedUntil: number | null }>('/collector/calibration', { method: 'POST', body: JSON.stringify({ minutes }) }),
  testFromServer: (url: string) => call<ServerTestResult>('/telemetry/test', { method: 'POST', body: JSON.stringify({ url }) }),
  importBrowserHistory: (entries: unknown[], watering: unknown[]) =>
    call<{ telemetry: number; events: number }>('/telemetry/import-browser', { method: 'POST', body: JSON.stringify({ entries, watering }), timeoutMs: 30000 }),
};

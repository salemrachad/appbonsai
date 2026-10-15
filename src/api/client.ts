import type { BehaviourEpisode, DailySummary, DiaryItem, HourlyBucket, PlantEvent, PlantEventType } from '../history/historyTypes';
import type { TreeSettings } from '../settings/settings';
import type { CalibrationSaveResult, CalibrationState, CaptureResult, LivingSnapshot, ServerStatus } from './types';
import type { CaptureStats } from '../telemetry/calibration';
import { apiUrl, BACKEND } from '../config/backend';

// Frontend → the Appbonsai server. Every API call goes through here, and the address comes only
// from src/config/backend.ts (the Raspberry Pi via VITE_API_BASE_URL, or the same origin).
async function call<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      ...init,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(init?.timeoutMs ?? 8000),
    });
  } catch (e) {
    const why = e instanceof DOMException && e.name === 'TimeoutError' ? 'timed out' : 'not reachable';
    throw new Error(`${BACKEND.label} ${why} (${BACKEND.displayUrl})`);
  }
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

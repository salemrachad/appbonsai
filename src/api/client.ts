import type { BehaviourEpisode, DailySummary, DiaryItem, HourlyBucket, Interaction, InteractionKind, PlantEvent, PlantEventType } from '../history/historyTypes';
import type { TreeSettings } from '../settings/settings';
import type { CalibrationSaveResult, CalibrationState, CaptureResult, LivingSnapshot, ServerStatus } from './types';
import type { CaptureStats } from '../telemetry/calibration';
import { apiUrl, BACKEND } from '../config/backend';

// Frontend → the Appbonsai server. Every API call goes through here, and the address comes only
// from src/config/backend.ts (the Raspberry Pi via VITE_API_BASE_URL, or the same origin).
async function send(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<Response> {
  try {
    return await fetch(apiUrl(path), {
      ...init,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(init?.timeoutMs ?? 8000),
    });
  } catch (e) {
    const why = e instanceof DOMException && e.name === 'TimeoutError' ? 'timed out' : 'not reachable';
    throw new Error(`${BACKEND.label} ${why} (${BACKEND.displayUrl})`);
  }
}

async function call<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const res = await send(path, init);
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

// The living state, unless it is unchanged since `etag` (then null: the server answered 304, no body).
// cache: 'no-store' keeps the browser from answering the 304 itself with its cached copy.
async function current(etag: string | null): Promise<{ snapshot: LivingSnapshot; etag: string | null } | null> {
  const res = await send('/current', { timeoutMs: 5000, cache: 'no-store', headers: etag ? { 'If-None-Match': etag } : {} });
  if (res.status === 304) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { snapshot: (await res.json()) as LivingSnapshot, etag: res.headers.get('ETag') };
}

// The living state pushed by the server (/api/stream) whenever it changes. EventSource reconnects
// by itself after a dropped connection; `closed` means it gave up (e.g. an older server without the
// route). Returns a function that closes the stream.
function stream(handlers: { onState: (s: LivingSnapshot) => void; onOpen: () => void; onError: (closed: boolean) => void }): () => void {
  const source = new EventSource(apiUrl('/stream'));
  source.addEventListener('state', (e) => handlers.onState(JSON.parse((e as MessageEvent<string>).data) as LivingSnapshot));
  source.onopen = handlers.onOpen;
  source.onerror = () => handlers.onError(source.readyState === EventSource.CLOSED);
  return () => source.close();
}

export const api = {
  current,
  stream,
  status: () => call<ServerStatus>('/status'),
  refresh: () => call<LivingSnapshot>('/refresh', { method: 'POST', timeoutMs: 15000 }),

  getConfig: () => call<{ settings: TreeSettings; configured: boolean }>('/config'),
  putConfig: (settings: TreeSettings) => call<{ settings: TreeSettings; configured: boolean }>('/config', { method: 'PUT', body: JSON.stringify(settings) }),

  events: (days = 30) => call<PlantEvent[]>(`/events?days=${days}`),
  logEvent: (type: PlantEventType, note?: string, timestamp?: number) =>
    call<PlantEvent>('/events', { method: 'POST', body: JSON.stringify({ type, note, timestamp }) }),
  deleteEvent: (id: number) => call<void>(`/events/${id}`, { method: 'DELETE' }),

  // Attention, not care: one call per finished session (keepalive so a session closed by leaving the page still lands)
  recordInteraction: (s: { kind: InteractionKind; startedAt: number; endedAt: number; count: number; activeMs: number }) =>
    call<Interaction>('/interactions', { method: 'POST', body: JSON.stringify(s), keepalive: true }),

  // The week's hike: choose one of the tree's two days
  chooseHike: (day: string) => call<LivingSnapshot>('/hike/choose', { method: 'POST', body: JSON.stringify({ day }) }),

  hourly: (hours = 24) => call<HourlyBucket[]>(`/history/hourly?hours=${hours}`),
  daily: (days = 7) => call<DailySummary[]>(`/history/daily?days=${days}`),
  diary: (days = 3) => call<DiaryItem[]>(`/history/diary?days=${days}`),
  episodes: (days = 30) => call<BehaviourEpisode[]>(`/history/episodes?days=${days}`),

  calibration: () => call<CalibrationState>('/calibration'),
  captureCalibration: (sensor: 'soil' | 'light') =>
    call<CaptureResult>('/calibration/capture', { method: 'POST', body: JSON.stringify({ sensor }), timeoutMs: 90000 }),
  saveSoilCalibration: (b: { dryRaw: number; wetRaw: number; dry?: CaptureStats; wet?: CaptureStats; confirm?: boolean; dryRun?: boolean; manual?: boolean }) =>
    call<CalibrationSaveResult>('/calibration/soil', { method: 'POST', body: JSON.stringify(b), timeoutMs: 15000 }),
  saveLightCalibration: (b: { darkRaw: number; brightRaw: number; dark?: CaptureStats; bright?: CaptureStats; confirm?: boolean; dryRun?: boolean; manual?: boolean }) =>
    call<CalibrationSaveResult>('/calibration/light', { method: 'POST', body: JSON.stringify(b), timeoutMs: 15000 }),
  clearCalibration: (sensor: 'soil' | 'light') => call<CalibrationState>(`/calibration/${sensor}`, { method: 'DELETE' }),
  pauseWateringDetection: (minutes: number) =>
    call<{ suppressedUntil: number | null }>('/collector/calibration', { method: 'POST', body: JSON.stringify({ minutes }) }),
  testFromServer: (url: string) => call<ServerTestResult>('/telemetry/test', { method: 'POST', body: JSON.stringify({ url }) }),
  importBrowserHistory: (entries: unknown[], watering: unknown[]) =>
    call<{ telemetry: number; events: number }>('/telemetry/import-browser', { method: 'POST', body: JSON.stringify({ entries, watering }), timeoutMs: 30000 }),
};

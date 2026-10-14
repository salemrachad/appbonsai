import { api } from '../api/client';

// Before the local server existed, history lived in this browser's localStorage.
// On first run it is copied into SQLite once. The browser copy is left in place (not deleted),
// but no longer written to.
const HISTORY_KEY = 'appbonsai_plant_history_v1';
const WATERING_KEY = 'appbonsai_watering_history_v1';
const IMPORTED_KEY = 'appbonsai_sqlite_import_v1';
// Old caches of telemetry that must never be shown as live readings
const STALE_CACHE_KEYS = ['appbonsai_telemetry_cache_v1', 'appbonsai_daily_history_v1'];

function read(key: string): unknown[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export async function importBrowserHistoryOnce(): Promise<{ telemetry: number; events: number } | null> {
  try {
    STALE_CACHE_KEYS.forEach((k) => localStorage.removeItem(k));
    if (localStorage.getItem(IMPORTED_KEY)) return null;
  } catch {
    return null; // storage unavailable
  }
  const entries = read(HISTORY_KEY);
  const watering = read(WATERING_KEY);
  const result = entries.length || watering.length ? await api.importBrowserHistory(entries, watering) : { telemetry: 0, events: 0 };
  try {
    localStorage.setItem(IMPORTED_KEY, JSON.stringify({ at: Date.now(), ...result }));
  } catch {
    /* storage unavailable */
  }
  return result;
}

// SQLite schema for the local Appbonsai database (data/appbonsai.db).
// All timestamps are INTEGER milliseconds since the Unix epoch (UTC).

export const SCHEMA_VERSION = 5; // 4: interactions, 5: outside_weather (both created by SCHEMA_SQL on open, no migration step needed)

export const SCHEMA_SQL = `
-- Raw observations: the permanent truth. Health can be re-evaluated from these later.
CREATE TABLE IF NOT EXISTS telemetry (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp         INTEGER NOT NULL,
  source            TEXT    NOT NULL,          -- esp32_sensor | weather_estimate
  device_id         TEXT,                      -- ESP32 endpoint the reading came from
  soil_moisture     REAL,                      -- % the app used (firmware value, or app-converted raw)
  api_soil_moisture REAL,                      -- firmware soil_moisture exactly as received
  soil_raw          INTEGER,
  temperature       REAL,
  humidity          REAL,
  light_percent     REAL,                      -- relative LDR %, never lux
  light_raw         INTEGER,
  radiation         REAL,                      -- weather mode, W/m²
  wifi_rssi         INTEGER,
  data_quality      TEXT,                      -- high | medium | low | imported
  raw_json          TEXT                       -- device payload as received
);
CREATE INDEX IF NOT EXISTS idx_telemetry_ts ON telemetry(timestamp);
CREATE UNIQUE INDEX IF NOT EXISTS ux_telemetry_source_ts ON telemetry(source, timestamp);

-- Care memory: what happened to the physical tree.
CREATE TABLE IF NOT EXISTS plant_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp     INTEGER NOT NULL,
  type          TEXT    NOT NULL CHECK (type IN ('watering','pruning','fertilizing','repotting','moved_location','manual_note')),
  note          TEXT,
  metadata_json TEXT    NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON plant_events(timestamp);
CREATE UNIQUE INDEX IF NOT EXISTS ux_events_type_ts ON plant_events(type, timestamp);

-- The tree's biography: one row per meaningful state, opened and closed on transitions.
CREATE TABLE IF NOT EXISTS behaviour_episodes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at     INTEGER NOT NULL,
  ended_at       INTEGER,                      -- NULL while still going
  last_seen_at   INTEGER NOT NULL,             -- last evaluation that confirmed it
  unobserved_ms  INTEGER NOT NULL DEFAULT 0,   -- time inside the episode without trustworthy data
  condition      TEXT    NOT NULL,
  modifiers_json TEXT    NOT NULL DEFAULT '[]',
  peak_severity  TEXT    NOT NULL DEFAULT 'none',
  engine_version TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_episodes_started ON behaviour_episodes(started_at);

-- Every calibration change: which sensor, old and new values. Explains later shifts in percentages.
-- (Raw telemetry is never rewritten; calibration only changes how raw values are interpreted.)
CREATE TABLE IF NOT EXISTS calibration_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp  INTEGER NOT NULL,
  sensor     TEXT    NOT NULL,               -- soil | light
  old_json   TEXT,                           -- previous calibration (NULL = firmware %)
  new_json   TEXT,                           -- new calibration (NULL = back to firmware %)
  note       TEXT
);

-- Attention: sessions of interaction with the DIGITAL tree (V1: petting). Not care: health never reads it.
-- kind is free text (validated by the API), so new interaction kinds need no table rebuild.
CREATE TABLE IF NOT EXISTS interactions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kind          TEXT    NOT NULL,              -- pet (future: visit, ...)
  started_at    INTEGER NOT NULL,
  ended_at      INTEGER NOT NULL,
  count         INTEGER NOT NULL DEFAULT 1,    -- pet: strokes in the session
  metadata_json TEXT    NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_interactions_kind_started ON interactions(kind, started_at);

-- Outside weather at the tree's location (Open-Meteo), every 15 min. CONTEXT only: the greenhouse sensors are
-- the truth about the tree; perception, health and episodes never read this table.
CREATE TABLE IF NOT EXISTS outside_weather (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp     INTEGER NOT NULL,
  sky           TEXT    NOT NULL,              -- clear, partly_cloudy, overcast, fog, drizzle, rain, heavy_rain, snow, thunderstorm
  code          INTEGER NOT NULL,              -- WMO weather code
  temperature   REAL,
  humidity      REAL,
  precipitation REAL,
  cloud_cover   REAL,
  wind          REAL,
  gusts         REAL,
  is_day        INTEGER,
  raw_json      TEXT
);
CREATE INDEX IF NOT EXISTS idx_outside_weather_ts ON outside_weather(timestamp);

-- Small key/value store: schema version, collector settings.
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

// Upgrades for databases created by older versions, applied in order (each must be idempotent).
export const MIGRATIONS: { version: number; sql: string; check?: { table: string; column: string } }[] = [
  {
    version: 2,
    sql: 'ALTER TABLE behaviour_episodes ADD COLUMN unobserved_ms INTEGER NOT NULL DEFAULT 0',
    check: { table: 'behaviour_episodes', column: 'unobserved_ms' },
  },
];

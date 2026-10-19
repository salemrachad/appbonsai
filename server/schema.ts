// SQLite schema for the local Appbonsai database (data/appbonsai.db).
// All timestamps are INTEGER milliseconds since the Unix epoch (UTC).

export const SCHEMA_VERSION = 10; // 4: interactions, 5: outside_weather (both created by SCHEMA_SQL), 6: sunrise/sunset on outside_weather, 7: devices, 8: trees + devices.tree_id, 9: utterances, 10: pressure + air quality on outside_weather

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
-- Episodes still relevant since a time (episodesSince, every poll) and the last closed one: by index, never a
-- scan of the whole (ever-growing) table (a Durable Object bills rows read)
CREATE INDEX IF NOT EXISTS idx_episodes_last_seen ON behaviour_episodes(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_episodes_ended ON behaviour_episodes(ended_at);

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
  sunrise_at    INTEGER,                       -- the day's published sunrise (ms)
  sunset_at     INTEGER,
  pressure      REAL,                          -- hPa at sea level
  aqi           REAL,                          -- European AQI (Open-Meteo's CAMS model)
  pm25          REAL,                          -- µg/m³
  pm10          REAL,
  raw_json      TEXT
);
CREATE INDEX IF NOT EXISTS idx_outside_weather_ts ON outside_weather(timestamp);

-- The tree this database belongs to: one row, made with the database (later: one Durable Object per tree, so
-- readings, events and episodes need no tree id). Its name, species and location are its settings (meta).
CREATE TABLE IF NOT EXISTS trees (
  id         TEXT    PRIMARY KEY,             -- tree_<uuid>
  created_at INTEGER NOT NULL
);

-- ESP32s allowed to push readings (POST /api/ingest). Only the token's SHA-256 is kept: the token itself is
-- shown once when the device is added (npm run device -- add <id>). boot + last_seq drop retried readings.
CREATE TABLE IF NOT EXISTS devices (
  id           TEXT    PRIMARY KEY,           -- the chip's id, as the firmware reports it
  tree_id      TEXT,                          -- the tree it measures: a replaced device keeps the tree's history
  token_hash   TEXT    NOT NULL,
  label        TEXT,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER,                       -- last accepted push
  firmware     TEXT,
  boot         TEXT,                          -- the device's current boot (random per start)
  last_seq     INTEGER                        -- highest reading seq accepted in that boot
);

-- What the tree said, as it said it (the diary keeps its words): one row per line spoken. Written by the live
-- evaluation only (replays never speak). kind: state | day_line | care_line | musing | observation.
CREATE TABLE IF NOT EXISTS utterances (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  at    INTEGER NOT NULL,
  key   TEXT    NOT NULL,                       -- catalog key or thought id, e.g. thirst:moderate, brightest_hour
  kind  TEXT    NOT NULL,
  text  TEXT    NOT NULL                        -- the words on screen (a later rewording doesn't rewrite them)
);
CREATE INDEX IF NOT EXISTS idx_utterances_at ON utterances(at);

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
  { version: 6, sql: 'ALTER TABLE outside_weather ADD COLUMN sunrise_at INTEGER', check: { table: 'outside_weather', column: 'sunrise_at' } },
  { version: 6, sql: 'ALTER TABLE outside_weather ADD COLUMN sunset_at INTEGER', check: { table: 'outside_weather', column: 'sunset_at' } },
  { version: 8, sql: 'ALTER TABLE devices ADD COLUMN tree_id TEXT', check: { table: 'devices', column: 'tree_id' } },
  ...['pressure', 'aqi', 'pm25', 'pm10'].map((column) => ({ version: 10, sql: `ALTER TABLE outside_weather ADD COLUMN ${column} REAL`, check: { table: 'outside_weather', column } })),
];

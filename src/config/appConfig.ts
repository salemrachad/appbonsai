// App-wide and hardware/prototype settings in one place.
// Plant biology (what the ficus likes, how long stress must last) lives in src/species/, not here.

export const APP_CONFIG = {
  server: {
    port: 3001, // local Appbonsai API + collector (Vite on 3000 proxies /api here)
    dbPath: 'data/appbonsai.db',
  },

  polling: {
    telemetryMs: 60 * 1000, // server collector: ESP32 reading interval (changeable in Settings)
    telemetryMinMs: 10 * 1000,
    telemetryMaxMs: 10 * 60 * 1000,
    weatherMs: 15 * 60 * 1000, // Open-Meteo estimates change slowly
    frontendMs: 5000, // browser → local server; cheap, so new readings show up within seconds
  },

  esp32: {
    telemetryPath: '/api/telemetry',
    fetchTimeoutMs: 4000,
    probeTimeoutMs: 3000, // availability check in "auto" mode
    testTimeoutMs: 4500, // Settings > Test Link
  },

  // Fallback day window when no location is known. With a location, the sun's position decides.
  daylight: { startHour: 6, endHour: 20 },

  // Guided sensor calibration (src/telemetry/calibration.ts, server/calibration.ts)
  calibration: {
    captureSamples: 10, // raw readings per reference capture
    captureIntervalMs: 3000, // → about 30 s per capture
    minSamples: 5,
    minSoilSpan: 300, // dry and wet references must be at least this far apart (ADC)
    minLightSpan: 200,
    maxStdev: 40, // a capture noisier than this is flagged as unstable
    maxRange: 150,
  },

  // Automatic watering detection (src/perception/wateringDetector.ts).
  // Detection heuristics for this FC-28 setup, not biology; tune against real waterings.
  watering: {
    minRisePct: 15, // accumulated soil rise above the recent baseline that suggests a watering
    riseWindowMs: 10 * 60 * 1000, // rise may build up over several readings within this window
    confirmReadings: 1, // following readings that must stay risen before the event is recorded
    confirmTolerancePct: 5, // a confirming reading may sit this far below the rise threshold (sensor noise)
    probeOutMaxPct: 3, // baseline at/below this looks like the probe was out of the soil (air reads ~0%)
    probeDropPct: 30, // a fall this large between two readings means the probe was pulled, not dried
    saturatedPct: 97, // baseline at/above this: the sensor can't show a rise (saturated)
    cooldownMs: 30 * 60 * 1000, // after a watering, further rises extend the same watering session
    calibrationSuppressMs: 15 * 60 * 1000, // detection paused this long after calibration changes / on request
    reactionMinutes: 20, // how long the tree keeps reacting to a watering
    manualMergeMinutes: 30, // a manual watering this close to a sensor-detected one is the same watering
  },

  history: {
    replayHours: 48, // fallback when no saved health memory exists: telemetry replayed on start
    maxGapMs: 15 * 60 * 1000, // short gap: readings this far apart still count as continuous observation
    episodeGapMs: 6 * 60 * 60 * 1000, // long gap: unobserved longer than this closes the open episode
  },

  // Gap policy (see src/health/HealthEngine.ts and server/episodes.ts):
  //   short gap  (≤ history.maxGapMs, or 2.5 polls)   continuous: timers keep running
  //   medium gap (≤ history.episodeGapMs)            unobserved: state held, durations paused, episode kept open
  //   long gap   (> history.episodeGapMs)            unknown: episode closed where it was last seen
  continuity: {
    uncertainPrimaryAfterMin: 30, // no trustworthy data this long → sensor_uncertain becomes the primary state
    uncertainExitAfterMin: 2, // trustworthy data this long → back to the biological state
  },

  dataQuality: {
    staleAfterPolls: 2.5, // a reading older than this many poll intervals is no longer trusted
    minStaleMs: 30 * 1000,
    adcMax: 4095, // ESP32 12-bit ADC
    adcRailMargin: 5, // raw within this of 0/4095 = probe pinned at a rail
    minHistoryMinutes: 30, // less recorded history than this = "still getting to know conditions" (medium confidence)
    stuckRawMinutes: 120, // raw ADC unchanged (± stuckRawTolerance) this long = stuck probe (real analog jitters)
    stuckRawTolerance: 2,
    pinnedSoilMinutes: 180, // converted soil exactly 0% or 100% this long = outside the calibrated range
    ldrRailMinutes: 60, // LDR raw at 0 in daylight, or at 4095 at any time, this long = suspicious
    // Physically implausible change between two consecutive readings (per minute)
    maxJumpPerMinute: { temperature: 8, humidity: 35 },
  },

  diagnostics: {
    liveReadingsKept: 60, // bottom live-sensor strip
  },

  engineVersion: 'living-2.0',
} as const;

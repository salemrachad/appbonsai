// App-wide and hardware/prototype settings in one place.
// Plant biology (what the ficus likes, how long stress must last) lives in src/species/, not here.

export const APP_CONFIG = {
  server: {
    port: 3001, // Appbonsai API + collector (on the Pi: http://<pi>:3001; npm run dev:local proxies /api here)
    dbPath: 'data/appbonsai.db', // production (the Pi): the authoritative history
    devDbPath: 'data/appbonsai-dev.db', // npm run dev:local: a separate, throwaway development history
  },

  polling: {
    telemetryMs: 60 * 1000, // server collector: ESP32 reading interval (changeable in Settings)
    telemetryMinMs: 10 * 1000,
    telemetryMaxMs: 10 * 60 * 1000,
    weatherMs: 15 * 60 * 1000, // Open-Meteo estimates change slowly
    frontendMs: 5000, // browser → local server, only when /api/stream isn't available
    streamCheckMs: 15 * 1000, // /api/stream: slow change check (status counters) + keep-alive ping
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

  // Attention (petting the on-screen tree): sessions, not movements. Never biology.
  attention: {
    sessionIdleMs: 3000, // the browser closes a petting session after this long without a stroke
    mergeMs: 2 * 60 * 1000, // a session starting this soon after the previous one extends it (one row)
    maxSessionMs: 30 * 60 * 1000, // longer reported sessions are clamped
    maxStrokesPerSession: 500,
    maxRowsPerHour: 30, // write cap: more new sessions than this in an hour are refused
    // Familiarity (how at ease the tree is with your hand): counts DAYS with petting, never strokes or
    // sessions, each day fading with this time constant. Expressive tuning, not biology.
    familiarityTauDays: 7,
    familiaritySaturation: 3, // weighted days for ~63% familiarity (2 weeks of daily visits ≈ 0.9)
    familiarityWindowDays: 30, // older days count for nothing: a month away is fully neutral again
  },

  // Habitat (visitors such as the squirrel): how welcoming the tree has been as a place to be, derived
  // from the stored episodes. Evidence class "art": it never reaches health, mood or energy.
  // Slow to trust, quick to leave: calm time raises it over days, stress empties it within hours.
  habitat: {
    windowDays: 14, // episodes replayed (older ones no longer matter much)
    riseHours: { comfortable: 36, thriving: 20 }, // observed calm hours, time constant toward 1
    fallHours: { mild: 12, moderate: 4, critical: 1 }, // time constant toward 0 while that stress is primary
    enter: 0.6, // Schmitt trigger: visitors start coming above this…
    exit: 0.4, // …and stop below this
    slotMinutes: 30, // the day is cut into slots; each may hold one visit
    visitChance: { min: 0.15, max: 0.45 }, // chance a daytime slot holds a visit, from just welcoming → fully
    visitMinutes: { min: 4, max: 12 },
    replayDays: 30, // episodes replayed for the drey and the diary (the habitat value forgets within days)
    // The drey: welcoming time builds it (~2 weeks to full), time not welcoming takes it apart (days)
    drey: { riseDays: 10, fallDays: 3, startedEnter: 0.25, startedExit: 0.15, builtEnter: 0.6, builtExit: 0.45 },
    // Answers to care: a calm, welcoming tree's squirrel comes to drink after a needed watering, or inspects
    // a pruning. At most one per care event; watering on wet soil gets no answer.
    careVisitMinutes: { drinking: 10, inspecting: 8, inspectingOffSeason: 3 },
    shakeOffAfterRainMs: 30 * 60 * 1000, // first visit within this long after rain stops: it shakes off
    // The squirrel as an individual (art). TRUST in the place grows with welcoming time and gives its
    // stages: traces (signs, no animal) → peeking (short peeks from the leaves, no play) → visiting →
    // settled (longer visits, ventures lower). When the place stops being welcoming trust breaks, and for a
    // while it rebuilds slower: it comes back warily.
    trust: {
      riseDays: 4, // welcoming time, time constant toward 1
      fallDays: 10, // not welcoming: fades slowly toward 0 (on top of the break)
      breakFactor: 0.25, // the latch flips off: trust is cut to this share
      waryDays: 14, // after a break, for this long…
      waryFactor: 1.6, // …trust rises this much slower
      tracesFrom: 0.35, // habitat value from which signs show while it is rising (not welcoming yet)
      tracesExit: 0.3,
      peekUntil: 0.3, // welcoming but trust below this: only peeks (hysteresis below)
      peekExit: 0.2, // falling back below this: peeking again
      settledFrom: 0.75,
      settledExit: 0.65,
      peekLength: 0.5, // visit length × while peeking
      settledLength: 1.4, // visit length × once settled
    },
    // Its habits, derived from its own past visits (habit-free replay, so nothing feeds back on itself):
    // a usual hour and a favourite spot. Boldness comes from trust and from play (petting during visits);
    // it only changes how it plays, never whether or when it comes (no reward loop).
    habits: {
      recencyDays: 7, // time constant of the recency weighting
      minVisits: 4, // fewer past visits: no habit yet
      nearHour: 1.4, // slot chance × within ±1 h of the usual hour…
      otherHours: 0.85, // …and × elsewhere
      favouriteBase: 0.4, // a visit starts on the favourite spot with chance base + trust × perTrust
      favouritePerTrust: 0.4,
      playSessions: 4, // play sessions (recency-weighted) for half the play part of boldness
    },
    // The dragonfly (behaviour/dragonfly.ts): the same mechanism, faster and looser, driven by the air.
    // About the insect, not the plant (so not in the species profile). Art; provisional.
    dragonfly: {
      tempMin: 20, // °C inside: warm enough to fly…
      tempMax: 34, // …not too hot
      lightFactor: 0.8, // daylight at least this × the useful light %
      radiationMin: 150, // W/m² in weather mode
      gustsMax: 35, // km/h outside: too windy above this
      riseMinutes: 45, // good air builds it…
      fallMinutes: 15, // …bad air drains it fast
      enter: 0.6,
      exit: 0.35,
      slotMinutes: 15,
      visitChance: { min: 0.35, max: 0.7 },
      visitMinutes: { min: 2, max: 6 },
      midday: { from: 11, to: 15, scale: 1.2, otherScale: 0.8 },
      perchedShare: 0.6, // share of visits spent perched on a leaf tip (the rest hovering)
      returnAfterDartMs: 4000, // after a stroke it darts off and lands back on the same tip (UI only)
      // Territory: no memory across days, but within a day it holds one tip as its own (stable per day)
      territory: { homeChance: 0.7 }, // share of the day's visits that start on the day's territory tip
      // Flying around during a visit (behaviour/dragonfly.ts dragonflyRoute): it sits a while, then flies
      // back to its home perch, makes a short hovering sortie and lands again, or moves to another tip
      // (the high crown tip, where the light is, a little more often). Shorter stays in warmer air.
      route: {
        perchSec: { min: 25, max: 70 }, // a stay on a tip
        hoverSec: { min: 6, max: 15 }, // a hover by a tip
        fidelity: 0.55, // after being elsewhere, the chance it flies back to its home perch
        sortieChance: 0.3, // from a perch: a short hover sortie, then it lands again
        landChance: 0.25, // on a hovering visit: the chance it lands for a short stay
        crownBias: 1.6, // weight of the crown tip against 1 for the other tips
        flightMs: 1400, // one flight between stops
      },
    },
    // The sloth (behaviour/sloth.ts): an air wanderer that loves warm, humid, still air (rain is fine,
    // wind and storms are not). Slow in everything: slow to come, slow to go, long visits, often.
    // Stays overnight curled up asleep. About the animal, not the plant. Art; provisional.
    sloth: {
      tempMin: 22, // °C inside
      tempMax: 35,
      humidityMin: 55, // % RH inside
      gustsMax: 30, // km/h outside: a swaying tree is no place for a sloth
      riseMinutes: 90, // slow to trust…
      fallMinutes: 60, // …and slow to leave
      enter: 0.6,
      exit: 0.35,
      slotMinutes: 60,
      visitChance: { min: 0.45, max: 0.8 },
      visitMinutes: { min: 20, max: 50 },
      hangingShare: 0.65, // share of daytime visits spent hanging (the rest slowly climbing)
      blinkCooldownMs: 6000, // a stroke gets a slow look and a slow blink, at most this often (UI only)
      // Loyalty (behaviour/sloth.ts slothMemory): days with long visits make the tree its tree. A loyal
      // sloth has a home branch, stays longer and is slow to give up when the air turns. No stages: it
      // doesn't scout, it just turns up. Derived from the stored readings of the last days (nothing stored).
      loyalty: {
        days: 14, // days of readings replayed
        fullDayMinutes: 180, // visit minutes in a day that count as a full day with it
        riseRate: 0.35, // a full day moves loyalty this share of the way to 1
        fallDays: 5, // days without it: time constant toward 0
        exitDrop: 0.15, // latch exit lowered by this × loyalty (slow to give up)
        visitLonger: 0.3, // visit length × (1 + this × loyalty)
        homeBase: 0.5, // a visit hangs on its home branch with chance base + loyalty × perLoyalty
        homePerLoyalty: 0.4,
        homeNightFrom: 0.3, // from this loyalty it sleeps the night on its home branch
      },
      // How it holds on, from its comfort (its value): the first stretch of a visit always all four; then
      // each stretch rolls a grip from the band its comfort is in. Asleep: all four, curled.
      grip: {
        segmentMinutes: 12, // it changes grip at most this often (slowly)
        relaxedFrom: 0.75, // below: four limbs or both arms
        loungingFrom: 0.9, // above: one arm or by the legs (in between: both arms or two legs + one arm)
      },
    },
    // Encounters: two visitors in the tree at the same time (behaviour/encounters.ts). Art only.
    encounters: {
      dragonflyOnSlothChance: 0.5, // share of perched dragonfly visits spent resting on a sloth that is there
    },
    // Petting while the squirrel visits: it plays around the tree (UI only, never stored). How playful comes
    // from the tree's state (ExpressionEngine visitorPlay); these are the tunings per kind.
    play: {
      returnMs: 10_000, // a squirrel that hid comes back out after this
      lingerMs: 4_000, // play ends this long after the last stroke (it stays where it ended up)
      playful: { hopEveryMs: 2_500, hideChance: 0.25 }, // thriving
      gentle: { hopEveryMs: 4_000, hideChance: 0.3 }, // comfortable
      shy: { hopEveryMs: 0, hideChance: 1 }, // hiding through a stress: only ducks and re-peeks
    },
  },

  // Soil dry-down estimate (perception/environment.ts): when a segment's slope is evidence enough
  dryDown: {
    maxHours: 8, // a segment looks back at most this far
    minHours: 3, // shorter segments give no estimate
    minSamples: 20,
    settleAfterWateringMs: 45 * 60 * 1000, // a new segment starts once the watered soil has drained
    highMinHours: 4, // high confidence needs this span…
    seHigh: 0.06, // …and a slope standard error at most this (%/h)
    seMedium: 0.15,
  },

  // Mood (behaviour/mood.ts): its own slow layer, anchored by health. Art, provisional.
  // Health sets the band it may move in; the inside environment, petting and care, the visitors and the
  // outside weather nudge it inside that band; it drifts with inertia (never jumps, never masks a stress).
  mood: {
    ceiling: { none: 1, mild: 0.3, moderate: 0.05, critical: -0.35 }, // highest valence per severity
    concernCeiling: 0.35, // a reading out of range (not a condition yet)
    calmFloor: -0.15, // a calm tree can't be made miserable by weather or the like
    sleepingArousalMax: 0.2,
    tauMin: { valenceDown: 10, valenceUp: 40, arousal: 20, event: 2 }, // drift time constants
    maxStepMin: 15, // longer gaps don't count as drifting time
    labelHysteresis: 0.06, // another label must be this much closer to take over
    // Nudges (valence, arousal); each group is capped
    environment: { cap: { v: 0.12, a: 0.15 }, swingTemp: 4, swingHum: 15, unsettled: [-0.06, 0.08], light: [0.04, 0.06], dim: [0, -0.05], warmth: [0.03, 0], sunrise: [0, 0.05], sunset: [0, -0.05], season: 0.3 },
    petting: { windowMin: 180, tauMin: 45, strokesFull: 10, v: 0.15, a: 0.03, moderateShare: 0.4 },
    care: { hours: 6, tauHours: 3, v: 0.05 },
    visitors: { cap: 0.1, squirrel: [0.06, 0.04], dragonfly: [0.04, 0.05], sloth: [0.05, -0.04] },
    weather: { rain: [0.03, -0.05], thunderstorm: [-0.05, 0.08], snow: [0.02, -0.04], clear: [0, 0.03], fog: [0, -0.03], windy: [0, 0.04] },
  },

  // The weekly hike (behaviour/hike.ts): the tree picks the week's best forecast day for its people's hike.
  // About the people, never the tree. Weeks run Monday to Sunday; the pick locks once its day arrives.
  hike: {
    forecastMs: 3 * 60 * 60 * 1000, // daily forecast refresh (it changes slowly)
    retryMs: 30 * 60 * 1000, // after a failed fetch
    weeksKept: 6, // picks remembered (moves, locks)
    // Day score, 100 = perfect: penalties per unit
    score: {
      comfortableMax: [16, 25], // °C, the day's high
      perDegreeCold: 2.5,
      perDegreeHot: 3,
      perRainChance: 0.5, // per % chance
      perRainMm: 5,
      rainMmCap: 30,
      gustsFrom: 35, // km/h
      perGust: 0.8,
      sky: { clear: 0, partly_cloudy: 0, overcast: 3, fog: 8, drizzle: 8, rain: 15, heavy_rain: 25, snow: 25, thunderstorm: 35 },
    },
    quality: { great: 80, good: 60, fair: 40 }, // score from; below: poor
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

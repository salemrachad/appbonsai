// App-wide and hardware/prototype settings in one place.
// Plant biology (what the ficus likes, how long stress must last) lives in src/species/, not here.

export const APP_CONFIG = {
  server: {
    port: 3001, // the laptop's Appbonsai API + collector (npm run dev proxies /api here)
    dbPath: 'data/appbonsai.db', // npm run server (self-hosted); the live tree's history is on Cloudflare
    devDbPath: 'data/appbonsai-dev.db', // npm run dev: a separate, throwaway development history
  },

  polling: {
    telemetryMs: 60 * 1000, // server collector: ESP32 reading interval (changeable in Settings)
    telemetryMinMs: 10 * 1000,
    telemetryMaxMs: 10 * 60 * 1000,
    weatherMs: 15 * 60 * 1000, // Open-Meteo estimates change slowly
    frontendMs: 5000, // browser → local server, only when /api/stream isn't available
    streamCheckMs: 15 * 1000, // /api/stream: slow change check (status counters) + keep-alive ping
  },

  // The ESP32 sends its readings (POST /api/ingest) instead of being read on the LAN (docs/HOSTING.md)
  push: {
    graceFactor: 1.5, // no push for 1.5 intervals = a failed poll (then one per interval, as in pull mode)
    maxReadings: 500, // per request: a device's outage buffer is sent in batches of at most this
    burstIntervalMs: 3000, // while a calibration captures, the device is asked to send this often
    burstMs: 2 * 60 * 1000,
    maxClockSkewMs: 5 * 60 * 1000, // a device timestamp further than this from the server's clock is not trusted
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
    // Lucy (behaviour/lucy.ts): the household's Coton de Tuléar, a permanent companion by the pot. Her day
    // follows the household clock (meals, walks), not the sun; the outside weather changes how she spends
    // each visit, never when she comes. Her job is peace: slow breathing when down or asleep. Art + context.
    lucy: {
      anchors: [7.25, 8.67, 10.08, 11.5, 12.92, 14.33, 15.75, 17.17, 18.58, 20], // local hours she comes by (85 min apart)
      jitterMin: 20, // ± around each anchor (stable per day); with ≤ 45-min visits they never overlap
      visitsPerDay: { min: 10, max: 10 }, // of the anchors, this many come true each day
      visitMinutes: { min: 15, max: 45 },
      bedtime: { hour: 22.75, jitterMin: 20 }, // she settles on her pillow for the night…
      wake: { hour: 6.25, jitterMin: 20 }, // …and walks off in the morning
      nightChance: 0.85, // "most nights"
      nightFloorChance: 0.35, // some nights she sleeps on the floor instead of her pillow (cold: pillow, heat: floor)
      // Asleep on the floor she wakes now and then and lies looking at you (stretches of this many minutes)
      floorWatch: { segmentMinutes: 8, share: 0.35 },
      // Her route through a visit: what she does next while she is up (shares), and for how long (seconds)
      route: {
        sniff: 0.3, // sniff along to a neighbouring spot, nose to the floor
        sit: 0.45, // sit somewhere (here, or after a walk) and look at you, the tree, or around
        lookUser: 0.5, // of the sitting and lying looks: at you, else mostly the tree
        lookTree: 0.38,
        seconds: { sniff: [20, 50], sit: [40, 120], stand: [15, 40], downLook: [45, 120] },
      },
      // How interested she is in a visitor in the tree (expression only): glance, watch, curious (walks under it
      // and sits looking up), excited (the same, wagging, a little bounce). Shares per visitor, by stable roll.
      interest: {
        squirrel: [0.2, 0.3, 0.3, 0.2],
        dragonfly: [0.35, 0.4, 0.2, 0.05],
        sloth: [0.5, 0.4, 0.1, 0],
      },
      walkInMin: 2, // arriving: walking in, sniffing around
      walkOutMin: 1.5, // leaving
      sitMinutes: { calm: 3, restless: 12 }, // sitting before she lies down, by her settle value
      downBeforeSleep: { calm: 8, restless: 25 }, // lying down before she falls asleep
      sleepFrom: 0.45, // settle value from which a visit can end in a nap
      // Staying close: a trusted moderate or worse stress makes her visits longer and adds check-ins
      stress: { longer: 1.5, checkSlotMinutes: 120, checkChance: 0.6, checkMinutes: { min: 20, max: 40 } },
      stormSlotMinutes: 60, // a storm brings her to the pot (one visit per slot while it lasts)
      hike: { marginMin: 30, napMinutes: 90 }, // away around the hike's best hours, then a long tired nap
      shakeOffAfterRainMin: 30, // a visit starting this soon after rain begins with a shake
      // Weather latches (outside; °C, km/h): enter/exit thresholds and minutes, like the health latches
      latch: {
        heat: { enter: 30, exit: 27, enterMin: 45, exitMin: 30 },
        cold: { enter: 8, exit: 11, enterMin: 60, exitMin: 30 },
        storm: { gusts: 50, enterMin: 0, exitMin: 45 },
        rain: { enterMin: 15, exitMin: 20 },
        fineDay: { tempMin: 15, tempMax: 26, enterMin: 60, exitMin: 30 },
      },
      // How ready to settle she is (0 restless … 1 sleepy): the time of day and the weather at her arrival
      settle: { base: 0.35, afterLunch: 0.3, evening: 0.3, morning: -0.1, rain: 0.25, cold: 0.25, heat: 0.2, storm: 0.1, fineDay: -0.25 },
      // Her breathing (ms per breath): ~6/min down or asleep is the calming pace; 5/min asleep at night
      breathMs: { sitting: 3200, walking: 2400, down: 10_000, sleeping: 10_000, night: 12_000, panting: 700 },
      petCooldownMs: 3500, // a stroke gets a tilt or a wag at most this often (UI only)
      // How she moves on screen (avatar/Lucy.tsx, UI only): a calm dog, not a busy one. Every easing is in time
      // (τ: the time to cover ~63 % of the way), so it looks the same at any frame rate.
      motion: {
        fps: 30,
        headTauMs: 450, // her head turning and pitching toward where she looks
        eyeTauMs: 250, // her pupils
        speed: { walk: 45, sniff: 25, shuffle: 18, excited: 90 }, // px per second
        accelTauMs: 500, // starting off and slowing to a stop (no instant start or stop)
        legPxPerCycle: 24, // one stride per this many px: the legs keep pace with the floor (no sliding)
        poseFadeMs: 450, // sitting, lying down, getting up: the old pose fades into the new one
        settlePx: 3, // lying down she sinks this far into place; getting up she rises
        turnMs: 420, // turning around (not a mirror flip)
        circleMs: 1700, // the turn around before she lies down
        aroundPeriodMs: 9000, // looking around the room: one slow sweep
        // Her small life between moves: mostly stillness
        life: {
          everyMs: [4000, 9000], // one small thing every so often
          glanceMs: [3000, 8000], // a look held this long
          blinkMs: [4000, 10_000],
          doubleBlink: 0.1,
          still: 4, // weight of "nothing" among the small things (gaze 3, back 1.5, ear 0.8, tilt 0.5, sniff 0.6, yawn 0.35, scratch 0.35, shuffle 0.3, sigh 0.6)
        },
        // How long each small movement lasts: the CSS animation and the moment it ends are the same number,
        // so nothing is cut off half-way (a part snapping back)
        durations: { tilt: 2400, ear: 900, yawn: 1800, sniffAir: 1600, sigh: 2800, dream: 1600, scratch: 1600, blink: 160 },
      },
    },
    // Encounters: two visitors in the tree at the same time (behaviour/encounters.ts). Art only.
    encounters: {
      dragonflyOnSlothChance: 0.5, // share of perched dragonfly visits spent resting on a sloth that is there
      // Familiarity (encounters.ts familiarity()): pairs that meet often get used to each other. Meetings are
      // past overlaps of their visits (≥ 1 min together), recency-weighted; familiarity = w / (w + k). Unknown
      // history (previews, a fresh tree) is 0.5: the encounters as they always were.
      familiarity: {
        recencyDays: 7, // a meeting's weight halves in about 5 days
        k: 2, // two recent meetings: halfway; meeting once a day makes old friends in about two weeks
        strangers: 0.3, // below: wary of each other (the squirrel only peeks at the sloth)
        friends: 0.75, // above: at ease (sharing a branch, no more staring, Lucy calmer)
        dragonflyOnSloth: { strangers: 0.25, friends: 0.8 }, // its resting chance from strangers to old friends (0.5 at 0.5)
      },
    },
    // The squirrel learns Lucy (habitat.ts squirrelLife): each visit of hers that found it out on a branch and
    // got her curious or excited is a lesson; wariness = recency-weighted lessons / (lessons + k). Wary, it comes
    // less in her hours (so its usual hour drifts away from them) and ducks into the leaves when she is below.
    lucyLessons: {
      recencyDays: 10,
      k: 4,
      maxAvoid: 0.7, // at full wariness, a slot during one of her visits keeps 30 % of its chance
      waryAt: 0.4, // from here it hides when she is awake below (else it watches her)
      waitedAfterMin: 20, // a visit starting this soon after she left: "waited until Lucy had gone"
      // They meet several times a day (she comes ten times): their familiarity grows on a slower scale, so the
      // wary weeks come first and peace (if ever) over months
      familiarityK: 40,
      familiarityRecencyDays: 30,
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
    visitors: { cap: 0.1, squirrel: [0.06, 0.04], dragonfly: [0.04, 0.05], sloth: [0.05, -0.04], lucy: [0.05, -0.06] }, // Lucy calms more than she cheers
    weather: { rain: [0.03, -0.05], thunderstorm: [-0.05, 0.08], snow: [0.02, -0.04], clear: [0, 0.03], fog: [0, -0.03], windy: [0, 0.04] },
  },

  // Outside air beyond the sky (telemetry/outsideWeather.ts): the barometer and air quality. CONTEXT only, never
  // health (the tree is in a greenhouse). From the conversation with Paul (2026-10): his weather guitar lets
  // pressure choose its mode and pollution its overdrive.
  outside: {
    pressure: {
      windowMs: 3 * 60 * 60 * 1000, // the tendency is the change over 3 h, as meteorology reads it (hPa per 3 h)
      minSpanMs: 2 * 60 * 60 * 1000, // fewer hours of observations: no tendency
      fallingFast: -3.5, // hPa per 3 h: weather on its way (science; the squirrel "feels" it: art)
      falling: -1.5,
      rising: 1.5,
    },
    // European AQI (Open-Meteo's CAMS model, so worldwide, no station needed): the upper bound of each band
    aqiBands: { good: 20, fair: 40, moderate: 60, poor: 80, very_poor: 100 },
    // What the art reads, with hysteresis (outsideWeather.ts outsideLatches), replayed over the last hours
    latches: {
      replayMs: 6 * 60 * 60 * 1000,
      weatherComing: { enterMin: 30, exitTrend: -2.0, exitMin: 45 }, // enter: falling fast (pressure.fallingFast) for 30 min
      hazy: { enterAqi: 60, enterMin: 30, exitAqi: 50, exitMin: 60 }, // poor air for 30 min; clean again for an hour
    },
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
    // The best hours of the picked day (hikeWindow): a stretch of daylight, each hour scored like the day
    window: {
      hours: 4, // how long a hike the window is for
      daylightFallback: [7, 18], // first/last hour when the forecast has no sunrise/sunset
      comfortable: [12, 24], // °C, the hour's temperature
      perDegree: 3,
      perRainChance: 0.6,
      perRainMm: 10,
      uvFrom: 7, // UV index
      perUv: 3,
      rainChanceFrom: 50, // %: "rain likely from …"
      rainMmFrom: 0.5,
      hotFrom: 28, // °C: "it gets hot after …"
      windyFrom: 40, // km/h gusts: "windy"
    },
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

  // Yoga days (behaviour/yoga.ts): the week's two gloomiest days, for the people and the tree. Art.
  yoga: {
    daysPerWeek: 2,
    perDegreeHot: 2, // per °C of forecast high above the ficus optimum (the greenhouse heats more)
    perDegreeCold: 2, // per °C of forecast low below its warning
    darkSky: { clear: 0, partly_cloudy: 0, overcast: 6, fog: 10, drizzle: 8, rain: 10, heavy_rain: 14, snow: 12, thunderstorm: 14 } as Record<string, number>, // little light for the leaves
    thirstyDay: 15, // the day its soil is forecast to reach thirsty if nobody waters
    matChance: 0.35, // a yoga-day visit: she lies down on the open mat
  },

  // Dreams (behaviour/dreams.ts): the day digested at night, from what the tree really lived. Art, provisional.
  dreams: {
    afterSunsetMin: 45, // the night (and its first sleep cycle) begins this long after sunset
    fallback: { sunsetHour: 19, sunriseHour: 6.5 }, // without a location (or near the poles)
    cycleMin: { min: 50, max: 70 }, // one sleep cycle (a stable roll per night and cycle)
    settleCycles: 1, // the first cycle is deep sleep only
    dreamShare: { first: 0.2, last: 0.45 }, // the dreaming end of a cycle grows toward dawn
    minPhaseMin: 5,
    maxMotifs: 3, // + one anticipation before dawn
    minSalience: 0.2, // below: not in tonight's dream
    toldMin: 0.35, // the morning line tells a dream only this vivid (and not a restless one)
    novelty: { nights: 14, step: 0.3, floor: 0.35 }, // pleasures habituate: each recent night with it weighs less
    recurrence: { tauDays: 7, min: 1, cap: 0.6 }, // worries come back until they fade (strength = Σ salience × decay)
    castBoost: 0.15, // the day of who sleeps beside the tree weighs more
    keepNights: 21, // past nights the collector keeps in its runtime
  },

  diagnostics: {
    liveReadingsKept: 60, // bottom live-sensor strip
  },

  engineVersion: 'living-2.0',
} as const;

import { ComfortRange, RelativeLightBand, SpeciesProfile } from './types';

// Ficus microcarpa / retusa (ginseng ficus): the single place for what this tree likes
// and for every tunable biological threshold.
//
// ⚠ PROTOTYPE / LOCAL CALIBRATION, not universal horticultural facts:
//   - SOIL is the % our FC-28 firmware mapping reports for THIS pot, not volumetric water content.
//   - LIGHT is the ESP32 photoresistor %, relative and uncalibrated. It is NOT lux.
//   Both need re-tuning against real dry/wet soil and real light on the balcony.
//   Temperature and humidity ranges are general indoor/outdoor ficus care guidance.

const TEMPERATURE: ComfortRange = { minCritical: 5, minWarning: 13, minOptimal: 18, maxOptimal: 28, maxWarning: 32, maxCritical: 38, unit: '°C' };
const HUMIDITY: ComfortRange = { minCritical: 25, minWarning: 40, minOptimal: 50, maxOptimal: 75, maxWarning: 85, maxCritical: 98, unit: '%' };
// PROTOTYPE: FC-28 % for this pot
const SOIL: ComfortRange = { minCritical: 20, minWarning: 35, minOptimal: 45, maxOptimal: 80, maxWarning: 90, maxCritical: 98, unit: '%' };

// PROTOTYPE: relative LDR % bands (NOT lux)
const RELATIVE_LIGHT: RelativeLightBand[] = [
  { id: 'very_dark', label: 'Very Dark', max: 10, score: 35 },
  { id: 'low', label: 'Low', max: 25, score: 65 },
  { id: 'good', label: 'Good', max: 60, score: 100 },
  { id: 'bright', label: 'Bright', max: 85, score: 100 },
  // Not treated as bad yet: real ficus light needs still have to be measured.
  { id: 'very_bright', label: 'Very Bright', max: 100, score: 95 },
];
const LOW_LIGHT_MAX = 25;
const VERY_BRIGHT_MIN = 85;

const MIN = 1;
const HOUR = 60;

export const FICUS: SpeciesProfile = {
  id: 'ficus',
  speciesName: 'Ficus microcarpa / retusa',
  commonName: 'Ginseng Ficus',

  temperature: TEMPERATURE,
  humidity: HUMIDITY,
  soilMoisture: SOIL,
  relativeLight: RELATIVE_LIGHT,
  radiation: { minCritical: 20, minWarning: 80, minOptimal: 200, maxOptimal: 550, maxWarning: 750, maxCritical: 1100, unit: 'W/m²' },
  vpd: { minCritical: 0.1, minWarning: 0.4, minOptimal: 0.75, maxOptimal: 1.3, maxWarning: 1.85, maxCritical: 2.6, unit: 'kPa' },

  // Hysteresis: enter at one value after a while, leave at a different value after a while.
  // A few minutes past a threshold never changes the tree's state on its own.
  latches: {
    thirsty: { direction: 'below', enter: SOIL.minWarning, exit: SOIL.minWarning + 5, enterAfterMin: 30 * MIN, exitAfterMin: 5 * MIN },
    very_dry: { direction: 'below', enter: SOIL.minCritical, exit: SOIL.minCritical + 5, enterAfterMin: 2 * HOUR, exitAfterMin: 5 * MIN },
    too_wet: { direction: 'above', enter: SOIL.maxWarning, exit: SOIL.maxWarning - 5, enterAfterMin: 12 * HOUR, exitAfterMin: 30 * MIN },
    hot: { direction: 'above', enter: TEMPERATURE.maxWarning, exit: TEMPERATURE.maxWarning - 2, enterAfterMin: 30 * MIN, exitAfterMin: 20 * MIN },
    cold: { direction: 'below', enter: TEMPERATURE.minWarning, exit: TEMPERATURE.minWarning + 2, enterAfterMin: 45 * MIN, exitAfterMin: 20 * MIN },
    freezing_risk: { direction: 'below', enter: TEMPERATURE.minCritical, exit: TEMPERATURE.minCritical + 2, enterAfterMin: 10 * MIN, exitAfterMin: 30 * MIN },
    dry_air: { direction: 'below', enter: HUMIDITY.minWarning, exit: HUMIDITY.minWarning + 5, enterAfterMin: 1 * HOUR, exitAfterMin: 30 * MIN },
    high_humidity: { direction: 'above', enter: HUMIDITY.maxWarning, exit: HUMIDITY.maxWarning - 5, enterAfterMin: 3 * HOUR, exitAfterMin: 30 * MIN },
    // On today's share of observed daylight in useful light (%), only while daylight is expected and
    // at least light.minObservedMinutes of daylight have been observed. PROTOTYPE.
    low_daily_light: { direction: 'below', enter: 20, exit: 30, enterAfterMin: 30 * MIN, exitAfterMin: 15 * MIN },
    very_bright: { direction: 'above', enter: VERY_BRIGHT_MIN, exit: VERY_BRIGHT_MIN - 5, enterAfterMin: 30 * MIN, exitAfterMin: 10 * MIN },
    // Night rest only runs after sunset: dark → asleep, a lamp → awake
    night_rest: { direction: 'below', enter: LOW_LIGHT_MAX + 0.5, exit: LOW_LIGHT_MAX + 5, enterAfterMin: 5 * MIN, exitAfterMin: 5 * MIN },
    // On vitality: no stress, no recovery and vitality ≥ 90 for 2h (after stress the tree is comfortable first)
    thriving: { direction: 'above', enter: 90, exit: 86, enterAfterMin: 2 * HOUR, exitAfterMin: 10 * MIN },
  },

  lightExpectedAboveSunDeg: 15,

  // PROTOTYPE: relative LDR %, to be tuned against this balcony (bright filtered light for several hours)
  light: {
    usefulMinPercent: LOW_LIGHT_MAX + 1, // "Good" band and brighter
    lowMaxPercent: LOW_LIGHT_MAX,
    usefulShareTarget: 0.5,
    lowCountsAs: 0.4,
    minObservedMinutes: 2 * HOUR,
  },

  // PROTOTYPE care windows (days). Context fades linearly over each window.
  care: {
    repotting: { contextDays: 14, settlingDays: 7 },
    pruning: { contextDays: 21, calmDays: 3 },
    moved_location: { contextDays: 7, lightRelearnHours: 24 },
    fertilizing: { contextDays: 14 },
    watering: { contextDays: 2 },
  },

  weights: { moisture: 0.4, temperature: 0.2, humidity: 0.1, light: 0.15, stability: 0.15 },
  vitalityBands: { thriving: 90, happy: 75, okay: 55, stressed: 35 },
  vitality: {
    declineHours: 2,
    riseHours: 4,
    stabilityWindowHours: 3,
    comfortableTempSwing: 6,
    comfortableHumiditySwing: 25,
  },

  // Prolonged stress hurts more than brief stress.
  stressPenalties: {
    thirsty: { perHour: 1.5, max: 12 },
    very_dry: { perHour: 4, max: 30 },
    too_wet: { perHour: 0.75, max: 15 },
    hot: { perHour: 2, max: 12 },
    cold: { perHour: 1.5, max: 12 },
    freezing_risk: { perHour: 6, max: 35 },
    too_dark: { perHour: 0.5, max: 8 },
    dry_air: { perHour: 0.5, max: 6 },
    high_humidity: { perHour: 0.25, max: 5 },
  },
  combinedStress: { perExtraStress: 0.25, maxMultiplier: 1.75, hotAndDryExtra: 5 },

  recovery: {
    hoursBySeverity: { mild: 1, moderate: 2, critical: 6 },
    vitalityPenaltyBySeverity: { mild: 2, moderate: 5, critical: 10 },
  },

  potMoistureModel: {
    baseWateringSaturation: 92,
    baselineDryingRatePerHour: 0.42,
    vpdMultiplier: 0.35,
    tempMultiplier: 0.025,
    solarMultiplier: 0.0008,
    drainageFactors: { fast: 1.35, standard: 1.0, slow: 0.72 },
  },
};

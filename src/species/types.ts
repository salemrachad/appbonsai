import type { OutsideSky } from '../telemetry/outsideWeather';
// A comfort range for one measurement. Values outside optimal score lower.
export interface ComfortRange {
  minCritical: number;
  minWarning: number;
  minOptimal: number;
  maxOptimal: number;
  maxWarning: number;
  maxCritical: number;
  unit: string;
}

export type RelativeLightId = 'very_dark' | 'low' | 'good' | 'bright' | 'very_bright';

// One band of the uncalibrated photoresistor percentage. NOT lux.
export interface RelativeLightBand {
  id: RelativeLightId;
  label: string;
  max: number; // inclusive upper bound in %
  score: number; // 0-100 light health while daylight is expected
}

// Entry/exit thresholds for one latched condition (see src/health/hysteresis.ts).
// The value must cross `enter` and stay there for `enterAfterMin` before the condition starts,
// then cross the (different) `exit` value for `exitAfterMin` before it ends.
export interface LatchRule {
  direction: 'below' | 'above'; // condition is "value below enter" or "value above enter"
  enter: number;
  exit: number;
  enterAfterMin: number;
  exitAfterMin: number;
}

export type LatchId =
  | 'thirsty'
  | 'very_dry'
  | 'too_wet'
  | 'hot'
  | 'cold'
  | 'freezing_risk'
  | 'dry_air'
  | 'high_humidity'
  | 'low_daily_light' // today's observed daylight has been mostly dim (see SpeciesProfile.light)
  | 'very_bright'
  | 'night_rest' // dark after sunset → sleeping
  | 'thriving'; // on vitality, not a sensor

export interface StressPenaltyRule {
  perHour: number; // vitality points lost per hour the condition has been active
  max: number; // never more than this
}

import type { Season } from '../perception/season';

// How the tree lives through one season. PROTOTYPE: general ficus care guidance, not measured here yet.
export interface SeasonRule {
  growth: 'flush' | 'active' | 'slowing' | 'resting'; // flush = new leaves; resting = little growth
  energy: number; // multiplies behaviour energy (movement, liveliness)
  waterNeed: number; // relative to summer = 1 (informational: thresholds are not seasonal yet)
  feeding: boolean; // whether fertilizing makes sense now
}

// A yearly curve: 0 far from the peak, 1 at the peak day (northern-calendar day of year), smooth in between.
export interface SeasonalCurve {
  peakDay: number;
  halfWidthDays: number; // 0 at peakDay ± halfWidthDays
}

export interface SpeciesProfile {
  id: string;
  speciesName: string;
  commonName: string;

  temperature: ComfortRange; // °C
  humidity: ComfortRange; // % RH
  soilMoisture: ComfortRange; // % from the probe (PROTOTYPE, locally calibrated)
  relativeLight: RelativeLightBand[]; // ESP32 LDR %, darkest → brightest (PROTOTYPE, relative)
  radiation: ComfortRange; // W/m², weather-estimate mode only
  vpd: ComfortRange; // kPa (shown in diagnostics; not part of vitality)

  seasons: Record<Season, SeasonRule>;
  // What the tree visibly does through the year (shown by the avatar; PROTOTYPE, general ficus behaviour)
  seasonalCycle: {
    newGrowth: SeasonalCurve; // flush of light-green new leaves
    yellowing: SeasonalCurve; // some old leaves yellow as days shorten
    leafDrop: SeasonalCurve; // a few of them let go
  };

  // The canopy over weeks (INFERENCE / PROTOTYPE): leaf loss after a long stress or a move, refilling at
  // the pace of the season. Drawn by the avatar only; never part of health. See behaviour/canopy.ts.
  canopy: {
    windowDays: number; // episodes replayed
    floor: number; // never thinner than this (the app can't know the real tree is bare)
    graceHours: { mild: number; moderate: number; critical: number }; // a stress this short costs no leaves
    thinPerHour: { mild: number; moderate: number; critical: number }; // fullness lost per observed hour past the grace
    regrowDays: number; // time constant back toward full, in the active growing season
    growthFactor: Record<SeasonRule['growth'], number>; // regrowth speed by growth phase
    moveDip: number; // fullness lost after a move…
    moveDipDays: number; // …spread over this many days
    trendDays: number; // trend compares with this many days ago
    refillLookbackDays: number; // fresh tips show the rise since the lowest point within this window
    refillVisibility: number; // rise × this = share of the gap shown as fresh tips
  };

  // Hysteresis: how conditions are entered and left.
  latches: Record<LatchId, LatchRule>;

  // Sun elevation above which low light counts against the tree (below it: dawn/dusk, light is neutral).
  lightExpectedAboveSunDeg: number;

  // Daily light exposure (relative LDR %, NOT lux). Judged on accumulated observed daylight, not one reading.
  light: {
    usefulMinPercent: number; // a daylight reading at/above this counts as "useful light"
    lowMaxPercent: number; // at/below this counts as "low light" (between the two: in-between)
    usefulShareTarget: number; // share of observed daylight in useful light that counts as a good light day
    lowCountsAs: number; // a low-light minute counts as this fraction of a useful one in the score
    minObservedMinutes: number; // observed daylight needed before the day's light is judged
    // How much light the outside sky lets through, as a factor on usefulMinPercent / lowMaxPercent for a
    // reading taken under that sky. A grey sky explains a dim reading; it never makes a bright one worse.
    skyFactor: Record<OutsideSky, number>;
  };

  // How long care events stay part of the tree's context, and how they colour behaviour.
  care: {
    repotting: { contextDays: number; settlingDays: number }; // settling: quieter, minor stress not dramatised
    pruning: { contextDays: number; calmDays: number }; // calm: gentler movement for a few days
    moved_location: { contextDays: number; lightRelearnHours: number }; // light not judged as too dark while re-learning
    fertilizing: { contextDays: number }; // remembered only: no health effect
    watering: { contextDays: number };
  };

  // Vitality: how much each health score matters. Missing scores are left out and the rest re-weighted.
  weights: { moisture: number; temperature: number; humidity: number; light: number; stability: number };
  vitalityBands: { thriving: number; happy: number; okay: number; stressed: number };
  vitality: {
    declineHours: number; // time constant when getting worse
    riseHours: number; // time constant when improving (slower: recovery takes time)
    stabilityWindowHours: number;
    comfortableTempSwing: number; // °C range within the stability window that costs nothing
    comfortableHumiditySwing: number; // % RH
  };
  stressPenalties: Partial<Record<string, StressPenaltyRule>>; // by HealthCondition
  combinedStress: { perExtraStress: number; maxMultiplier: number; hotAndDryExtra: number };

  recovery: {
    hoursBySeverity: { mild: number; moderate: number; critical: number }; // healthy this long → recovered
    vitalityPenaltyBySeverity: { mild: number; moderate: number; critical: number }; // fades over the window
  };

  // Weather-estimate mode only: how fast the pot is assumed to dry.
  potMoistureModel: {
    baseWateringSaturation: number;
    baselineDryingRatePerHour: number;
    vpdMultiplier: number;
    tempMultiplier: number;
    solarMultiplier: number;
    drainageFactors: { fast: number; standard: number; slow: number };
  };
}

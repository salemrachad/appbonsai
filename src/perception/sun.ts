import { APP_CONFIG } from '../config/appConfig';
import { hourOf, startOfDay } from '../lib/time';

const RAD = Math.PI / 180;

// Sun elevation above the horizon in degrees (low-precision solar position, good to ~0.5°).
export function solarElevation(when: number, latitude: number, longitude: number): number {
  const n = when / 86400000 + 2440587.5 - 2451545.0; // days since J2000
  const L = 280.46 + 0.9856474 * n;
  const g = (357.528 + 0.9856003 * n) * RAD;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const eps = (23.439 - 0.0000004 * n) * RAD;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmstHours = 18.697374558 + 24.06570982441908 * n;
  const hourAngle = (gmstHours * 15 + longitude) * RAD - ra;
  const lat = latitude * RAD;
  return Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(hourAngle)) / RAD;
}

export type DayPhase = 'night' | 'dawn' | 'low_sun' | 'day' | 'dusk';

// Sunrise and sunset of the local day containing `when`: the moments the sun's upper edge crosses the
// horizon (−0.833°: refraction + half the disk, the standard definition). Bisection on the elevation, so
// it matches published times to about a minute. null where the sun doesn't rise or set that day.
const HORIZON_DEG = -0.833;
export function sunTimes(when: number, latitude: number, longitude: number): { sunrise: number | null; sunset: number | null } {
  const start = startOfDay(when); // the tree's day
  // Local solar noon from the longitude, then search each half of the day
  let noon = start + 12 * 3600 * 1000;
  let best = -90;
  for (let t = start; t < start + 24 * 3600 * 1000; t += 10 * 60 * 1000) {
    const e = solarElevation(t, latitude, longitude);
    if (e > best) {
      best = e;
      noon = t;
    }
  }
  const cross = (a: number, b: number, rising: boolean): number | null => {
    const above = (t: number) => solarElevation(t, latitude, longitude) > HORIZON_DEG;
    if (above(a) === above(b)) return null;
    let lo = a;
    let hi = b;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (above(mid) === rising) hi = mid;
      else lo = mid;
    }
    return Math.round((lo + hi) / 2);
  };
  return { sunrise: cross(start, noon, true), sunset: cross(noon, start + 24 * 3600 * 1000, false) };
}

export interface SunState {
  method: 'solar' | 'clock';
  elevation: number | null; // degrees, null when going by the clock
  isDay: boolean; // sun above the horizon
  lightExpected: boolean; // sun high enough that low light means a dim spot, not dusk
  phase: DayPhase;
  // Today's sunrise and sunset (ms). From Open-Meteo when fresh (published times), else computed here.
  sunrise: number | null;
  sunset: number | null;
  timesFrom: 'open-meteo' | 'solar' | 'none';
}

// Where the sun is for the tree. Uses the tree's location when known, else the fixed clock window.
export function sunState(when: number, latitude: number | null, longitude: number | null, lightExpectedAboveDeg: number): SunState {
  if (latitude == null || longitude == null || !isFinite(latitude) || !isFinite(longitude)) {
    const h = hourOf(when);
    const { startHour, endHour } = APP_CONFIG.daylight;
    const isDay = h >= startHour && h < endHour;
    const lightExpected = h >= startHour + 2 && h < endHour - 2;
    return {
      method: 'clock',
      elevation: null,
      isDay,
      lightExpected,
      phase: !isDay ? 'night' : lightExpected ? 'day' : 'low_sun',
      sunrise: null,
      sunset: null,
      timesFrom: 'none',
    };
  }
  const elevation = solarElevation(when, latitude, longitude);
  const morning = solarElevation(when + 10 * 60 * 1000, latitude, longitude) > elevation;
  const phase: DayPhase =
    elevation < -6 ? 'night' : elevation < 0 ? (morning ? 'dawn' : 'dusk') : elevation < lightExpectedAboveDeg ? 'low_sun' : 'day';
  return {
    method: 'solar',
    elevation: Math.round(elevation * 10) / 10,
    isDay: elevation > 0,
    lightExpected: elevation >= lightExpectedAboveDeg,
    phase,
    sunrise: null, // filled by perception (exact times are needed only once per evaluation)
    sunset: null,
    timesFrom: 'none',
  };
}

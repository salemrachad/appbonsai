const RAD = Math.PI / 180;
const DAY = 86400000;

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];

export interface SeasonState {
  id: Season;
  key: string; // e.g. "2026-autumn" (a winter keeps the year it started in): once-per-season lines
  hemisphere: 'north' | 'south';
  method: 'location' | 'assumed_north'; // no latitude → northern hemisphere assumed, no day length
  progress: number; // 0-1 through the season
  stage: 'early' | 'mid' | 'late';
  daysIn: number;
  daysLeft: number;
  next: Season;
  previous: Season;
  // Near a boundary the neighbouring season is already (or still) felt: 0.5 at the boundary itself,
  // fading to 0 over BLEND_DAYS, so nothing jumps on the 1st of the month.
  blend: { with: Season; amount: number } | null;
  // Day of the year as the northern calendar would have it (shifted half a year in the south),
  // so species seasonal curves work in both hemispheres.
  seasonalDay: number;
  daylightHours: number | null; // sunrise → sunset at the tree's latitude
  daylightTrend: 'lengthening' | 'shortening';
  daylightChangeMinPerWeek: number | null; // how fast the days are changing
}

// Meteorological seasons (whole months): what a balcony actually lives through, rather than equinox dates.
// Northern: spring Mar–May, summer Jun–Aug, autumn Sep–Nov, winter Dec–Feb. Flipped south of the equator.
const NORTH_BY_MONTH: Season[] = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'];
const START_MONTH: Record<Season, number> = { spring: 2, summer: 5, autumn: 8, winter: 11 };
export const BLEND_DAYS = 14;
const FLIP: Record<Season, Season> = { spring: 'autumn', summer: 'winter', autumn: 'spring', winter: 'summer' };

const dayOfYear = (d: Date) => Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / DAY);

// Hours of daylight (sun's centre above the horizon) on that day at that latitude.
export function daylightHours(when: number, latitude: number): number {
  const n = dayOfYear(new Date(when));
  const decl = -23.44 * Math.cos(((2 * Math.PI) / 365) * (n + 10)) * RAD;
  const x = -Math.tan(latitude * RAD) * Math.tan(decl);
  if (x <= -1) return 24; // polar day
  if (x >= 1) return 0; // polar night
  return Math.round(((2 * Math.acos(x)) / RAD / 15) * 100) / 100;
}

// The middle of a season this year at that latitude (developer previews): everything as if it were that day.
const MID_MONTH: Record<Season, number> = { spring: 3, summer: 6, autumn: 9, winter: 0 };
export function midSeasonState(id: Season, latitude: number | null, year = new Date().getFullYear()): SeasonState {
  const south = latitude != null && latitude < 0;
  return seasonState(new Date(year, MID_MONTH[south ? FLIP[id] : id], 15, 12).getTime(), latitude);
}

export function seasonState(when: number, latitude: number | null): SeasonState {
  const known = latitude != null && isFinite(latitude);
  const south = known && latitude! < 0;
  const d = new Date(when);
  const northSeason = NORTH_BY_MONTH[d.getMonth()];
  const id = south ? FLIP[northSeason] : northSeason;

  // Bounds of the current (northern-calendar) three-month block
  const startMonth = START_MONTH[northSeason];
  const startYear = northSeason === 'winter' && d.getMonth() < 2 ? d.getFullYear() - 1 : d.getFullYear();
  const start = new Date(startYear, startMonth, 1).getTime();
  const end = new Date(startYear, startMonth + 3, 1).getTime();
  const progress = Math.min(1, Math.max(0, (when - start) / (end - start)));

  const hours = known ? daylightHours(when, latitude!) : null;
  const inWeek = known ? daylightHours(when + 7 * DAY, latitude!) : null;
  const change = hours !== null && inWeek !== null ? Math.round((inWeek - hours) * 60) : null;
  // Without a location, the northern calendar still tells the direction
  const lengthening = change !== null ? change >= 0 : d.getMonth() < 5 || (d.getMonth() === 11 && d.getDate() > 21);

  const order: Season[] = ['spring', 'summer', 'autumn', 'winter'];
  const next = order[(order.indexOf(id) + 1) % 4];
  const previous = order[(order.indexOf(id) + 3) % 4];
  const daysIn = (when - start) / DAY;
  const daysLeft = (end - when) / DAY;
  const blend =
    daysLeft < BLEND_DAYS
      ? { with: next, amount: Math.round(0.5 * (1 - daysLeft / BLEND_DAYS) * 100) / 100 }
      : daysIn < BLEND_DAYS
      ? { with: previous, amount: Math.round(0.5 * (1 - daysIn / BLEND_DAYS) * 100) / 100 }
      : null;
  const doy = dayOfYear(d);
  return {
    id,
    key: `${startYear}-${id}`,
    hemisphere: south ? 'south' : 'north',
    method: known ? 'location' : 'assumed_north',
    progress: Math.round(progress * 100) / 100,
    stage: progress < 1 / 3 ? 'early' : progress < 2 / 3 ? 'mid' : 'late',
    daysIn: Math.floor(daysIn),
    daysLeft: Math.max(0, Math.ceil(daysLeft)),
    next,
    previous,
    blend: blend && blend.amount > 0 ? blend : null,
    seasonalDay: south ? (doy + 182) % 365 : doy,
    daylightHours: hours,
    daylightTrend: lengthening ? 'lengthening' : 'shortening',
    daylightChangeMinPerWeek: change,
  };
}

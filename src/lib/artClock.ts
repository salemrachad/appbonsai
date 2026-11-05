import { APP_CONFIG } from '../config/appConfig';
import { addDays, DAY, HOUR, startOfDay } from './time';

// The art clock: the visitors' slow memories (habitat, trust, drey, habits, sloth loyalty, encounter
// familiarity, the squirrel's lessons about Lucy) are written in STORY days and read through here, so
// `APP_CONFIG.artTempo` story days pass in one real day. Art only: never biology.

export const artTempo = (): number => APP_CONFIG.artTempo;
// One story day in ms
export const ART_DAY = DAY / artTempo();
export const artDays = (n: number) => n * ART_DAY;
export const artHours = (n: number) => (n * HOUR) / artTempo();

// The start of the story day containing t: the tree's calendar day cut into `artTempo` equal periods (a
// period never crosses midnight; a 23- or 25-hour day is still cut evenly). At tempo 1, startOfDay.
export function artPeriodStart(t: number): number {
  const day = startOfDay(t);
  const n = artTempo();
  if (n === 1) return day;
  const len = (addDays(day, 1) - day) / n;
  return day + Math.min(n - 1, Math.floor((t - day) / len)) * len;
}
// The story day after the one starting at `start`
export function nextArtPeriod(start: number): number {
  const day = startOfDay(start);
  if (artTempo() === 1) return addDays(day, 1);
  return artPeriodStart(start + (addDays(day, 1) - day) / artTempo() * 1.5);
}

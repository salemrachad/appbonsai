// Time units in milliseconds, and the clock as the tree's screens and lines show it. One place, so a change
// to how times read happens once. Formatting follows the device's locale (toLocaleTimeString), as before.
// (species/ficus.ts keeps its own MIN/HOUR: its latch durations are in minutes.)
export const MIN = 60 * 1000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

// 14:05 (or 2:05 PM, by locale)
export const hhmm = (t: number | Date) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
// 14:05:09
export const hhmmss = (t: number | Date) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

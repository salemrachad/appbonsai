import { APP_CONFIG } from '../config/appConfig';
import { DAY, MIN } from '../lib/time';
import { stableVariant } from './speech';

// Familiarity (evidence class "art"): two visitors that have met often get used to each other. A meeting is
// an overlap of their visit windows of at least a minute; recent meetings weigh more. Derived from the
// visits' own history every time, never stored, never read by health, energy or episodes.
// Without a history to read (previews, a fresh tree), a pair is UNKNOWN_FAMILIARITY: the encounters exactly
// as they were before visitors remembered each other.

export type Window = { from: number; to: number };
export const UNKNOWN_FAMILIARITY = 0.5;

const round2 = (n: number) => Math.round(n * 100) / 100;

// The meetings of two visitors before `at`: when each one began (oldest first)
export function meetings(a: Window[], b: Window[], at: number): number[] {
  const out: number[] = [];
  for (const x of a)
    for (const y of b) {
      const from = Math.max(x.from, y.from);
      if (from >= at) continue;
      if (Math.min(x.to, y.to, at) - from >= MIN) out.push(from);
    }
  return out.sort((p, q) => p - q);
}

// 0 (strangers) … 1 (old friends), as of `at`, from the times they met (only those before `at` count)
// scale: how many recent meetings make halfway, and how fast they fade (Lucy's pair has its own, slower)
export type FamiliarityScale = { k: number; recencyDays: number };
export function familiarityFrom(met: number[], at: number, scale: FamiliarityScale = APP_CONFIG.habitat.encounters.familiarity): number {
  let w = 0;
  for (const t of met) if (t < at) w += Math.exp(-(at - t) / (scale.recencyDays * DAY));
  return round2(w / (w + scale.k));
}
export const LUCY_SCALE: FamiliarityScale = { k: APP_CONFIG.habitat.lucyLessons.familiarityK, recencyDays: APP_CONFIG.habitat.lucyLessons.familiarityRecencyDays };

// The same from two visitors' windows. null windows: no history to read → unknown
export function familiarity(a: Window[] | null | undefined, b: Window[] | null | undefined, at: number): number {
  if (!a || !b) return UNKNOWN_FAMILIARITY;
  return familiarityFrom(meetings(a, b, at), at);
}

// The moments a pair became old friends: a meeting that took them past the friends threshold. With a
// Schmitt trigger, so hovering around it is said once: only drifting back to strangers lets it happen again
export function becameFriends(met: number[], scale?: FamiliarityScale): number[] {
  const F = APP_CONFIG.habitat.encounters.familiarity;
  const out: number[] = [];
  let friends = false;
  for (const t of met) {
    if (familiarityFrom(met, t, scale) < F.strangers) friends = false;
    if (!friends && familiarityFrom(met, t + 1, scale) > F.friends) {
      friends = true;
      out.push(t);
    }
  }
  return out;
}

export type FamiliarityStage = 'strangers' | 'acquainted' | 'friends';
export function familiarityStage(f: number): FamiliarityStage {
  const F = APP_CONFIG.habitat.encounters.familiarity;
  return f < F.strangers ? 'strangers' : f > F.friends ? 'friends' : 'acquainted';
}

// How much a visit of the squirrel, dragonfly or sloth interests Lucy: stable per pair of visits (the
// expression shows it; the squirrel learns from it). Familiar (familiarity 0-1, 0.5 unknown), she cools: one
// level less above 0.6, two above the friends threshold.
export const LUCY_INTEREST = ['glance', 'watch', 'curious', 'excited'] as const;
export type LucyInterestLevel = (typeof LUCY_INTEREST)[number];
export function lucyInterest(lucyVisitId: string, visitorId: string, who: 'squirrel' | 'dragonfly' | 'sloth', familiarity = UNKNOWN_FAMILIARITY): LucyInterestLevel {
  const shares = APP_CONFIG.habitat.lucy.interest[who];
  const x = stableVariant(`${lucyVisitId}:${visitorId}:interest`, 997) / 997;
  let i = 0;
  for (let acc = shares[0]; i < shares.length - 1 && x >= acc; acc += shares[++i]);
  const cool = familiarity > APP_CONFIG.habitat.encounters.familiarity.friends ? 2 : familiarity > 0.6 ? 1 : 0;
  return LUCY_INTEREST[Math.max(0, i - cool)];
}

// The dragonfly's chance to rest on a sloth that is there: 0.5 at unknown, more as they know each other
export function dragonflyOnSlothChance(f: number): number {
  const c = APP_CONFIG.habitat.encounters;
  const { strangers, friends } = c.familiarity.dragonflyOnSloth;
  const mid = c.dragonflyOnSlothChance;
  return f <= UNKNOWN_FAMILIARITY ? strangers + ((mid - strangers) * f) / UNKNOWN_FAMILIARITY : mid + ((friends - mid) * (f - UNKNOWN_FAMILIARITY)) / (1 - UNKNOWN_FAMILIARITY);
}

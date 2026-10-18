import { APP_CONFIG } from '../config/appConfig';
import type { DragonflyPerch, HabitatEncounter, HabitatState, SlothBranch, VisitSpot } from './behaviourTypes';
import { dragonflyRoute, livelinessOf } from './dragonfly';
import { stableVariant } from './speech';
import { dayKey, hhmm } from '../lib/time';

// Encounters: two visitors in the tree at the same time (evidence class "art"). Nothing new is decided
// about WHETHER anyone visits: each visitor's own engine did that. This only arranges who sits where when
// they coincide, and names the encounter for the expression and the voice:
// - the squirrel peeks at the sloth: never on the sloth's branch (it takes another spot), they look at
//   each other;
// - the squirrel watches the dragonfly: the dragonfly never rests on the leaves right by the squirrel;
// - the dragonfly rests on the sloth (about half of its perched visits while a sloth is there).
// Deterministic (stable rolls on the visit ids), derived, nothing stored. Never read by health, mood or
// energy. The same function arranges the browser previews, so a preview of two visitors meets too.

export const ENCOUNTER_PAIRS: HabitatEncounter[] = ['squirrel_sloth', 'squirrel_dragonfly', 'dragonfly_sloth'];

// The leaves each perch is by (the squirrel's spot it would sit next to)
const PERCH_BY: Record<Exclude<DragonflyPerch, 'on_sloth'>, VisitSpot> = { left_tip: 'left_branch', left_top: 'left_branch', right_tip: 'right_branch', crown_tip: 'crown' };
export const spotByPerch = (p: DragonflyPerch): VisitSpot | null => (p === 'on_sloth' ? null : PERCH_BY[p]);
const PERCHES = Object.keys(PERCH_BY) as Exclude<DragonflyPerch, 'on_sloth'>[];
const OTHER_BRANCH: Record<SlothBranch, SlothBranch> = { left_branch: 'right_branch', right_branch: 'left_branch' };

export interface Cast {
  squirrel: { id: string; spot: VisitSpot; mode: 'visiting' | 'hiding' | 'sleeping'; fixed: boolean } | null; // fixed: a care answer (it came for that spot)
  dragonfly: { id: string; perch: DragonflyPerch; perched: boolean } | null;
  sloth: { id: string; branch: SlothBranch; asleep: boolean } | null;
}
export interface Meeting {
  squirrelSpot: VisitSpot | null;
  dragonflyPerch: DragonflyPerch | null;
  slothBranch: SlothBranch | null;
  dragonflyAvoid: DragonflyPerch[]; // tips its route never goes to (by the squirrel)
  encounters: HabitatEncounter[];
}

export function meet({ squirrel: sq, dragonfly: df, sloth: sl }: Cast): Meeting {
  const out: Meeting = { squirrelSpot: sq?.spot ?? null, dragonflyPerch: df?.perch ?? null, slothBranch: sl?.branch ?? null, dragonflyAvoid: [], encounters: [] };
  const awakeSquirrel = sq && sq.mode !== 'sleeping' ? sq : null; // asleep in its drey: nobody to meet

  // The squirrel and the sloth never share a branch: the squirrel moves on (or, when it came for that
  // spot, the sloth hangs on the other branch)
  if (awakeSquirrel && sl) {
    if (out.squirrelSpot === out.slothBranch) {
      if (awakeSquirrel.fixed) out.slothBranch = OTHER_BRANCH[sl.branch];
      else {
        const choices: VisitSpot[] = [OTHER_BRANCH[sl.branch], 'crown'];
        out.squirrelSpot = choices[Math.floor((stableVariant(`${awakeSquirrel.id}:meet:${sl.id}`, 997) / 997) * choices.length)]; // a prime: the hash's low bits alone repeat
      }
    }
    out.encounters.push('squirrel_sloth');
  }

  // The dragonfly rests on the sloth now and then
  if (df && sl && df.perched && stableVariant(`${df.id}:on_sloth`, 997) < APP_CONFIG.habitat.encounters.dragonflyOnSlothChance * 997) {
    out.dragonflyPerch = 'on_sloth';
    out.encounters.push('dragonfly_sloth');
  }

  // The squirrel watches the dragonfly, which never rests right by it
  if (awakeSquirrel && df) {
    const p = out.dragonflyPerch;
    if (p && p !== 'on_sloth' && PERCH_BY[p] === out.squirrelSpot) {
      const start = Math.floor((stableVariant(`${df.id}:meet`, 997) / 997) * PERCHES.length);
      for (let i = 0; i < PERCHES.length; i++) {
        const c = PERCHES[(start + i) % PERCHES.length];
        if (PERCH_BY[c] !== out.squirrelSpot) {
          out.dragonflyPerch = c;
          break;
        }
      }
    }
    out.dragonflyAvoid = PERCHES.filter((p) => PERCH_BY[p] === out.squirrelSpot); // and its flights never take it there
    out.encounters.push('squirrel_dragonfly');
  }
  return out;
}

// Applies the meeting to the habitat (behaviour engine, after all three visitors were evaluated)
export function applyEncounters(h: HabitatState): HabitatEncounter[] {
  const sq = h.visit && h.presence !== 'none' ? h.visit : null;
  const df = h.dragonfly?.visit ?? null;
  const sl = h.sloth?.visit ?? null;
  const m = meet({
    // A peek from the leaves meets like hiding
    squirrel: sq ? { id: sq.id, spot: sq.spot, mode: h.presence === 'peeking' ? 'hiding' : (h.presence as 'visiting' | 'hiding' | 'sleeping'), fixed: sq.cause === 'care' } : null,
    dragonfly: df ? { id: df.id, perch: df.perch, perched: df.style === 'perched' } : null,
    sloth: sl ? { id: sl.id, branch: sl.branch, asleep: sl.pose === 'sleeping' } : null,
  });
  if (sq && m.squirrelSpot) h.visit = { ...sq, spot: m.squirrelSpot };
  // The dragonfly's route is planned again around its (new) home and away from the squirrel
  if (df && h.dragonfly && m.dragonflyPerch && (m.dragonflyPerch !== df.perch || m.dragonflyAvoid.length))
    h.dragonfly.visit = { ...df, perch: m.dragonflyPerch, route: dragonflyRoute(df, { home: m.dragonflyPerch, avoid: m.dragonflyAvoid, liveliness: livelinessOf(h.dragonfly.insideTemp) }) };
  if (sl && h.sloth && m.slothBranch) h.sloth.visit = { ...sl, branch: m.slothBranch };
  h.encounters = m.encounters;
  return m.encounters;
}

// ---- Diary: who shared the tree, from the visit windows each visitor's diary already derives ----

export type Window = { from: number; to: number };
const NAMES: Record<HabitatEncounter, string> = {
  squirrel_sloth: 'The squirrel and the sloth shared the tree',
  squirrel_dragonfly: 'The squirrel watched a dragonfly',
  dragonfly_sloth: 'A dragonfly and the sloth shared the tree',
};

export function encounterDiary(windows: { squirrel: Window[]; dragonfly: Window[]; sloth: Window[] }, since: number, now: number) {
  const items: { at: number; kind: 'habitat'; habitat: 'encounter'; title: string; detail: string }[] = [];
  const pairs: [HabitatEncounter, Window[], Window[]][] = [
    ['squirrel_sloth', windows.squirrel, windows.sloth],
    ['squirrel_dragonfly', windows.squirrel, windows.dragonfly],
    ['dragonfly_sloth', windows.dragonfly, windows.sloth],
  ];
  for (const [id, a, b] of pairs) {
    const byDay = new Map<string, { first: number; count: number }>();
    for (const x of a)
      for (const y of b) {
        const from = Math.max(x.from, y.from);
        if (Math.min(x.to, y.to, now) - from < 60 * 1000 || from < since) continue; // at least a minute together
        const key = dayKey(from);
        const e = byDay.get(key);
        if (e) {
          e.count++;
          e.first = Math.min(e.first, from);
        } else byDay.set(key, { first: from, count: 1 });
      }
    for (const { first, count } of byDay.values()) items.push({ at: first, kind: 'habitat', habitat: 'encounter', title: NAMES[id], detail: `${count > 1 ? `${count} times` : 'once'} · first at ${hhmm(first)}` });
  }
  return items;
}

import { APP_CONFIG } from '../config/appConfig';
import type { DragonflyPerch, FamiliarityPair, HabitatEncounter, HabitatState, SlothBranch, VisitSpot } from './behaviourTypes';
import { dragonflyRoute, livelinessOf } from './dragonfly';
import { dragonflyOnSlothChance, familiarityStage, UNKNOWN_FAMILIARITY } from './familiarity';
import { stableVariant } from './speech';
import { dayKey, hhmm } from '../lib/time';

// Encounters: two visitors in the tree at the same time (evidence class "art"). Nothing new is decided
// about WHETHER anyone visits: each visitor's own engine did that. This only arranges who sits where when
// they coincide, and names the encounter for the expression and the voice:
// - the squirrel peeks at the sloth: never on the sloth's branch (it takes another spot), they look at
//   each other;
// - the squirrel watches the dragonfly: the dragonfly never rests on the leaves right by the squirrel;
// - the dragonfly rests on the sloth (about half of its perched visits while a sloth is there);
// - Lucy and the squirrel: awake below the tree, she is watched, or (once it has learned to be wary of her)
//   it ducks into the leaves.
// From choreography to relationships: how they meet depends on how used to each other they are
// (familiarity, from their past visits: behaviour/familiarity.ts). Strangers keep their distance (the squirrel
// only peeks at a sloth it doesn't know), old friends are at ease (sharing a branch, no more staring, a
// dragonfly that rides the sloth more often). Unknown familiarity (previews, a fresh tree) meets as before.
// Deterministic (stable rolls on the visit ids), derived, nothing stored. Never read by health, mood or
// energy. The same function arranges the browser previews, so a preview of two visitors meets too.

// The visitors in the tree (the "visitors_met" thought names these; Lucy is the household, not a visitor)
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
  lucy?: { id: string; awake: boolean } | null; // the household dog, awake or asleep by the pot
  familiarity?: Partial<Record<FamiliarityPair, number>>; // how used to each other they are (absent: unknown)
  wariness?: number; // what the squirrel learned of Lucy (0-1)
}
export interface Meeting {
  squirrelSpot: VisitSpot | null;
  // How the squirrel shows itself after meeting: 'peek' (only from the leaves, at a sloth it doesn't know),
  // 'hiding' (ducked into the leaves: Lucy below), null = as it came
  squirrelShows: 'peek' | 'hiding' | null;
  dragonflyPerch: DragonflyPerch | null;
  slothBranch: SlothBranch | null;
  dragonflyAvoid: DragonflyPerch[]; // tips its route never goes to (by the squirrel)
  encounters: HabitatEncounter[];
}

export function meet({ squirrel: sq, dragonfly: df, sloth: sl, lucy = null, familiarity = {}, wariness = 0 }: Cast): Meeting {
  const out: Meeting = { squirrelSpot: sq?.spot ?? null, squirrelShows: null, dragonflyPerch: df?.perch ?? null, slothBranch: sl?.branch ?? null, dragonflyAvoid: [], encounters: [] };
  const awakeSquirrel = sq && sq.mode !== 'sleeping' ? sq : null; // asleep in its drey: nobody to meet
  const stage = (p: FamiliarityPair) => familiarityStage(familiarity[p] ?? UNKNOWN_FAMILIARITY);

  // The squirrel and the sloth: strangers, it only peeks at it from the leaves. They never sit on the same
  // branch (the squirrel moves on, or the sloth hangs on the other branch when the squirrel came for that
  // spot); old friends stop staring and its play may hop onto the sloth's branch (the expression's cues)
  if (awakeSquirrel && sl) {
    if (stage('squirrel_sloth') === 'strangers' && awakeSquirrel.mode === 'visiting' && !awakeSquirrel.fixed) out.squirrelShows = 'peek';
    if (out.squirrelSpot === out.slothBranch) {
      if (awakeSquirrel.fixed) out.slothBranch = OTHER_BRANCH[sl.branch];
      else {
        const choices: VisitSpot[] = [OTHER_BRANCH[sl.branch], 'crown'];
        out.squirrelSpot = choices[Math.floor((stableVariant(`${awakeSquirrel.id}:meet:${sl.id}`, 997) / 997) * choices.length)]; // a prime: the hash's low bits alone repeat
      }
    }
    out.encounters.push('squirrel_sloth');
  }

  // The dragonfly rests on the sloth now and then: more often the better they know each other
  if (df && sl && df.perched && stableVariant(`${df.id}:on_sloth`, 997) < dragonflyOnSlothChance(familiarity.dragonfly_sloth ?? UNKNOWN_FAMILIARITY) * 997) {
    out.dragonflyPerch = 'on_sloth';
    out.encounters.push('dragonfly_sloth');
  }

  // The squirrel watches the dragonfly, which never rests right by it (a dragonfly it knows well isn't
  // worth watching any more: it may rest by it)
  if (awakeSquirrel && df && stage('squirrel_dragonfly') !== 'friends') {
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
  } else if (awakeSquirrel && df) out.encounters.push('squirrel_dragonfly');

  // Lucy awake below and the squirrel out: it watches her, or, wary of her (and not yet used to her), it
  // ducks into the leaves until she has gone
  if (awakeSquirrel && lucy?.awake && awakeSquirrel.mode === 'visiting') {
    if (wariness >= APP_CONFIG.habitat.lucyLessons.waryAt && stage('lucy_squirrel') !== 'friends' && !awakeSquirrel.fixed) out.squirrelShows = 'hiding';
    out.encounters.push('lucy_squirrel');
  }
  return out;
}

// Applies the meeting to the habitat (behaviour engine, after all three visitors were evaluated)
export function applyEncounters(h: HabitatState): HabitatEncounter[] {
  const sq = h.visit && h.presence !== 'none' ? h.visit : null;
  const df = h.dragonfly?.visit ?? null;
  const sl = h.sloth?.visit ?? null;
  const lu = h.lucy?.visit ?? null;
  const m = meet({
    // A peek from the leaves meets like hiding
    squirrel: sq ? { id: sq.id, spot: sq.spot, mode: h.presence === 'peeking' ? 'hiding' : (h.presence as 'visiting' | 'hiding' | 'sleeping'), fixed: sq.cause === 'care' } : null,
    dragonfly: df ? { id: df.id, perch: df.perch, perched: df.style === 'perched' } : null,
    sloth: sl ? { id: sl.id, branch: sl.branch, asleep: sl.pose === 'sleeping' } : null,
    lucy: lu ? { id: lu.id, awake: lu.pose !== 'sleeping' } : null,
    familiarity: h.familiarity,
    wariness: h.memory?.wariness,
  });
  if (sq && m.squirrelSpot) h.visit = { ...sq, spot: m.squirrelSpot };
  if (sq && m.squirrelShows === 'hiding') {
    h.presence = 'hiding';
    h.visit = { ...h.visit!, action: null };
    h.why = 'ducked into the leaves: Lucy is right below (it has learned to be wary of her)';
  } else if (sq && m.squirrelShows === 'peek' && h.presence === 'visiting') {
    h.presence = 'peeking';
    h.why = "only peeking from the leaves: a sloth it doesn't know is in the tree";
  }
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
  lucy_squirrel: 'Lucy spotted the squirrel',
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

import type { AvatarPresentation, EyeStyle, Foliage, Gaze } from '../../src/expression/expressionTypes';
import { leavesFor, PADS, paletteFor, type LeafSpec } from '../../src/components/avatar/Foliage';
import { mul, rotate, scale, translate, type Mat } from './rig';

// The website's look rules the display runs itself, in TypeScript: the same rules as the firmware's C
// (appbonsai_display.ino: droopOf, leafLook, pupilOffset; keep the three in step). The export checks these
// against the markup React emits for a sweep of states, so a change on the website that the display doesn't
// follow fails the export instead of drawing something else.
//  - droopTransforms (BonsaiAvatar.tsx): the three pads at a droop, shrunk or not
//  - PadLeaves (Foliage.tsx): each leaf's tilt, curl, colour, freshness, and whether it shows
//  - Eyes (AvatarFace.tsx): where the pupils go for a gaze, per eye style

export const TONES: Foliage[] = ['lush', 'vivid', 'tender', 'deep', 'thirsty', 'parched', 'scorched', 'soaked', 'frosted', 'frozen', 'curled', 'dewy', 'dim', 'washed'];
export const EYES: EyeStyle[] = ['happy', 'joy', 'closed', 'drowsy', 'heavy', 'alert', 'sad', 'worried', 'pleading', 'wide', 'swirl', 'squint_hard', 'squint_soft', 'unsure'];
export const MOUTHS: AvatarPresentation['mouth'][] = ['smile', 'grin', 'frown', 'pant', 'chatter', 'sleep', 'flat', 'wobble', 'parched', 'pucker', 'queasy', 'gasp', 'yawn'];
export const BLUSHES: AvatarPresentation['blush'][] = ['normal', 'happy', 'hot', 'cold', 'pale', 'none'];
export const GAZES: Gaze[] = ['around', 'center', 'down', 'up', 'toward_light', 'away', 'search', 'east', 'west'];
export const SOILS: AvatarPresentation['soil'][] = ['moist', 'wet', 'dry', 'frozen'];

// What the rules read from the ExpressionState
export interface Look {
  foliage: Foliage;
  blend: AvatarPresentation['foliageBlend'];
  droop: number;
  shrink: boolean;
  effects: string[];
  seasonal: AvatarPresentation['seasonalLeaves'];
  canopy: { fullness: number; refilling: number; yellow?: number };
}

export function lookOf(e: { avatar: AvatarPresentation; leafDroop: number }): Look {
  const a = e.avatar;
  return {
    foliage: a.foliage,
    blend: a.foliageBlend,
    droop: e.leafDroop,
    shrink: a.posture === 'shrink',
    effects: a.effects,
    seasonal: a.seasonalLeaves,
    canopy: { fullness: a.canopy?.fullness ?? 1, refilling: a.canopy?.refilling ?? 0, yellow: a.canopy?.yellow },
  };
}

// droopTransforms: translate · rotate · scale about each pad's origin
export const DROOP_ORIGINS: [number, number][] = [
  [170, 225],
  [275, 215],
  [220, 140],
];
export function droopOf(pad: number, d: number, shrink: boolean): Mat {
  const s = shrink ? 0.93 : 1;
  const [ox, oy] = DROOP_ORIGINS[pad];
  const local =
    pad === 0
      ? mul(translate(shrink ? 8 : 0, d * 20), mul(rotate(d * 11), scale(s)))
      : pad === 1
      ? mul(translate(shrink ? -8 : 0, d * 20), mul(rotate(-d * 11), scale(s)))
      : mul(translate(0, d * 15), scale(s * (1 - d * 0.07), s * (1 - d * 0.11)));
  return mul(translate(ox, oy), mul(local, translate(-ox, -oy)));
}

export const SPECS: (LeafSpec & { pad: number })[] = PADS.flatMap((p, pad) => leavesFor(p).map((l) => ({ ...l, pad })));

export interface LeafNow {
  pad: number;
  local: Mat; // leaf space → the pad's space (before its droop); the droop and sway come on top
  fill: string;
  edge: string | null;
  edgeWidth: number;
  rib: string | null;
  gloss: boolean;
  fresh: boolean;
}

const norm = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

// Per tone: how flat the leaves roll, and whether some turn dry brown (the header carries both)
export const curlOf = (tone: Foliage) => (tone === 'curled' ? 0.45 : tone === 'parched' || tone === 'scorched' ? 0.7 : 1);
export const brownsOf = (tone: Foliage) => tone === 'parched' || tone === 'scorched';

// PadLeaves for one leaf: null when the canopy is missing it
export function leafLook(l: (typeof SPECS)[number], look: Look): LeafNow | null {
  const p = paletteFor(look.foliage, look.blend);
  const { fullness, refilling } = look.canopy;
  const curl = curlOf(look.foliage);
  const yellowShare = Math.max(look.effects.includes('yellow_leaves') ? 0.11 : 0.13 * look.seasonal.yellowing, look.canopy.yellow ?? 0);
  const freshShare = look.effects.includes('new_leaves') ? 0.28 : 0.32 * look.seasonal.newGrowth;
  const missing = l.gap > fullness;
  const tip = missing && fullness < 1 && (l.gap - fullness) / (1 - fullness) < refilling * 0.6;
  if (missing && !tip) return null;
  const tilt = norm(90 - l.angle) * Math.max(-0.25, look.droop) * 0.38;
  const place = mul(translate(l.x, l.y), mul(rotate(l.angle), rotate(tilt)));
  if (tip) return { pad: l.pad, local: mul(place, scale(l.size * 0.62)), fill: '#CDEB9A', edge: null, edgeWidth: 0, rib: null, gloss: false, fresh: true };
  let fill = p.leaf[l.shade];
  let s = l.size;
  let fresh = false;
  if (l.r < yellowShare) fill = l.r < yellowShare / 2 ? '#D9A93F' : '#E2C35A';
  if (brownsOf(look.foliage) && l.r > 0.82) fill = '#93643A';
  if (l.rim && l.r > 1 - freshShare) {
    fill = '#CDEB9A';
    s *= 1.12;
    fresh = true;
  }
  return {
    pad: l.pad,
    local: mul(place, scale(s, s * curl)),
    fill,
    edge: p.edge ?? null,
    edgeWidth: p.edge ? 0.9 : 0,
    rib: p.shadow,
    gloss: !!p.gloss && l.r > 0.6,
    fresh,
  };
}

// Eyes: the pupils' translate for a gaze (x, y in px), per eye style; null for eyes without pupils
export function pupilOffset(style: EyeStyle, g: { x: number; y: number }): [number, number] | null {
  switch (style) {
    case 'happy':
    case 'alert':
    case 'worried':
    case 'unsure':
      return [g.x, g.y];
    case 'drowsy':
      return [g.x * 0.6, 1 + g.y * 0.3];
    case 'heavy':
      return [g.x * 0.7, Math.max(0, g.y) * 0.6 + 1.5];
    case 'wide':
      return [g.x * 0.8, g.y * 0.8];
    case 'pleading':
      return [g.x * 0.5, Math.min(g.y, -1)];
    case 'sad':
      return [g.x, g.y + 1];
    default:
      return null;
  }
}

// The parts of BonsaiAvatar's rendered markup the display moves itself: the three pads (their droop, which
// sway they run and its pivot), the 124 leaves (exactly as React emitted them: position, angle, tilt, scale,
// colour, edge, gloss, quiver delay) and the pivots of the body and the trunk. Read from the markup, so the
// display draws what the website draws; if the markup's shape changes, this fails loudly instead of guessing.

export type Mat = [number, number, number, number, number, number]; // SVG matrix(a b c d e f)

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export function mul(p: Mat, q: Mat): Mat {
  return [
    p[0] * q[0] + p[2] * q[1],
    p[1] * q[0] + p[3] * q[1],
    p[0] * q[2] + p[2] * q[3],
    p[1] * q[2] + p[3] * q[3],
    p[0] * q[4] + p[2] * q[5] + p[4],
    p[1] * q[4] + p[3] * q[5] + p[5],
  ];
}

export function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2];
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

export const translate = (x: number, y: number): Mat => [1, 0, 0, 1, x, y];
export const scale = (x: number, y = x): Mat => [x, 0, 0, y, 0, 0];
export function rotate(deg: number): Mat {
  const r = (deg * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
}
export const apply = (m: Mat, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

// A CSS transform list (translate(…px, …px) rotate(…deg) scale(…)) about an origin
function cssTransform(list: string, ox: number, oy: number): Mat {
  let m: Mat = translate(ox, oy);
  for (const f of list.matchAll(/(\w+)\(([^)]*)\)/g)) {
    const v = f[2].split(',').map((s) => parseFloat(s));
    if (f[1] === 'translate') m = mul(m, translate(v[0], v[1] ?? 0));
    else if (f[1] === 'rotate') m = mul(m, rotate(v[0]));
    else if (f[1] === 'scale') m = mul(m, scale(v[0], v[1] ?? v[0]));
    else throw new Error(`Unexpected transform ${f[0]} in the avatar's markup`);
  }
  return mul(m, translate(-ox, -oy));
}

export interface Pad {
  droop: Mat; // the pad's droop (its CSS transform about its origin), already in the exported pad image
  sway: 'left' | 'right'; // which branch-sway animation it runs
  pivot: [number, number] | null; // its own transform-origin, else the animation class's
}

export interface Leaf {
  pad: number;
  m: Mat; // leaf space (the lens 0..12 along x) → SVG user space, droop included; the quiver comes on top
  fill: string;
  edge: string | null;
  edgeWidth: number;
  rib: string | null; // the midrib's stroke (palette shadow at 0.35)
  gloss: boolean;
  fresh: boolean; // a fresh tip or new leaf: quivers on the 3 s cycle
  delay: number; // seconds (CSS animation-delay, negative)
}

export interface Rig {
  pads: Pad[];
  leaves: Leaf[];
  bodyOrigin: [number, number];
  trunkOrigin: [number, number];
}

const NUM = '(-?[\\d.]+)';

export function readRig(markup: string): Rig {
  const body = new RegExp(`<svg[^>]*style="transform-origin:${NUM}px ${NUM}px`).exec(markup);
  const trunk = new RegExp(`class="trunk-breathe" style="transform-origin:${NUM}px ${NUM}px`).exec(markup);
  if (!body || !trunk) throw new Error("The avatar's markup has changed: no body or trunk transform-origin");

  const parts = markup.split('<g class="canopy-droop" ').slice(1);
  if (parts.length !== 3) throw new Error(`Expected 3 canopy pads in the markup, found ${parts.length}`);
  const pads: Pad[] = [];
  const leaves: Leaf[] = [];
  parts.forEach((part, i) => {
    const droop = new RegExp(`^style="transform:([^;]*);transform-origin:${NUM}px ${NUM}px"`).exec(part);
    const sway = new RegExp(`<g class="animate-branch-(left|right)"(?: style="transform-origin:${NUM}px ${NUM}px)?`).exec(part);
    if (!droop || !sway) throw new Error(`Pad ${i}: no droop or sway in the markup`);
    pads.push({
      droop: cssTransform(droop[1], Number(droop[2]), Number(droop[3])),
      sway: sway[1] as Pad['sway'],
      pivot: sway[2] ? [Number(sway[2]), Number(sway[3])] : null,
    });
    for (const chunk of part.split('<g transform="translate(').slice(1)) {
      const place = new RegExp(`^${NUM} ${NUM}\\) rotate\\(${NUM}\\)"><g style="transform:rotate\\(${NUM}deg\\) scale\\(${NUM}(?:, ${NUM})?\\)`).exec(chunk);
      const quiver = new RegExp(`<g class="([^"]*)" style="animation-delay:${NUM}s"><path d="M 0,0 Q 5,-4.6 12,0 Q 5,4.6 0,0 Z" fill="(#[0-9A-Fa-f]{6})"(?: stroke="([^"]+)" stroke-width="${NUM}")?`).exec(chunk);
      if (!place || !quiver) throw new Error(`Pad ${i}: a leaf's markup has changed: ${chunk.slice(0, 160)}`);
      const [tx, ty, angle, tilt, sx] = place.slice(1, 6).map(Number);
      const sy = place[6] !== undefined ? Number(place[6]) : sx;
      const rib = /<path d="M 1\.5,0 L 10,0" stroke="(#[0-9A-Fa-f]{6})"/.exec(chunk);
      const edge = quiver[4] && quiver[4] !== 'none' && Number(quiver[5]) > 0 ? quiver[4] : null;
      leaves.push({
        pad: i,
        m: mul(pads[i].droop, mul(translate(tx, ty), mul(rotate(angle), mul(rotate(tilt), scale(sx, sy))))),
        fill: quiver[3],
        edge,
        edgeWidth: edge ? Number(quiver[5]) : 0,
        rib: rib ? rib[1] : null,
        gloss: chunk.includes('d="M 3,-1.6 Q 6,-3 9,-1.4"'),
        fresh: quiver[1].includes('leaf-fresh'),
        delay: Number(quiver[2]),
      });
    }
  });
  const expected = (markup.match(/class="leaf-quiver/g) ?? []).length;
  if (leaves.length !== expected) throw new Error(`Read ${leaves.length} leaves, the markup has ${expected}`);
  return { pads, leaves, bodyOrigin: [Number(body[1]), Number(body[2])], trunkOrigin: [Number(trunk[1]), Number(trunk[2])] };
}

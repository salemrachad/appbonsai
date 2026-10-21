import React, { useMemo } from 'react';
import type { AvatarEffect, AvatarPresentation, Foliage } from './avatarStates';

// Leaf colours per foliage tone: pad gradient, highlight, individual leaves (light → dark), pad shadow.
export interface Palette {
  pad: [string, string, string];
  hi: [string, string];
  leaf: [string, string, string];
  shadow: string;
  moss: [string, string];
  edge?: string; // leaf outline (frost, scorch)
  gloss?: boolean; // wet shine
}

export const PALETTES: Record<Foliage, Palette> = {
  lush: { pad: ['#5A7A50', '#4A6741', '#334D2E'], hi: ['#7E9F74', '#4A6741'], leaf: ['#8DBA7A', '#5E8A4F', '#3F6435'], shadow: '#23462F', moss: ['#5E8348', '#3C5C2A'] },
  vivid: { pad: ['#5E9A4A', '#3F7A35', '#2A5A26'], hi: ['#9BD27E', '#4F8A3F'], leaf: ['#A6DB82', '#5FA048', '#357A2E'], shadow: '#1E4A27', moss: ['#66A34A', '#3C6E2A'], gloss: true },
  tender: { pad: ['#7FA65A', '#5F8A45', '#456A33'], hi: ['#B7DB8A', '#6E9B50'], leaf: ['#C4E58F', '#8CC063', '#5F9145'], shadow: '#2E5232', moss: ['#7DAA55', '#4C7535'] },
  deep: { pad: ['#4A6346', '#3A5238', '#283C29'], hi: ['#617D5B', '#3E573B'], leaf: ['#6E8C66', '#4C6A47', '#33492F'], shadow: '#1A2F20', moss: ['#4F6B45', '#30472B'] },
  thirsty: { pad: ['#969F86', '#768466', '#525E45'], hi: ['#A9B194', '#7A8768'], leaf: ['#B3B88F', '#8E9A72', '#68734F'], shadow: '#3E4A34', moss: ['#858F6F', '#5D664D'] },
  parched: { pad: ['#A89A6A', '#8A7D50', '#635A38'], hi: ['#C2B27E', '#8E8052'], leaf: ['#D2BC78', '#A99257', '#7A6A3D'], shadow: '#4A4128', moss: ['#9A8D62', '#6B6040'], edge: '#7A5A2C' },
  scorched: { pad: ['#9C8E5C', '#7E7244', '#5A5030'], hi: ['#BFA86E', '#857544'], leaf: ['#CFAE62', '#A5813F', '#7A5A2C'], shadow: '#46391F', moss: ['#8F8050', '#625634'], edge: '#7A4A22' },
  soaked: { pad: ['#3F5E44', '#2F4C36', '#1F3626'], hi: ['#5C8063', '#34523B'], leaf: ['#6E9A74', '#467550', '#2C5236'], shadow: '#142A1C', moss: ['#3E6440', '#24402A'], gloss: true },
  frosted: { pad: ['#7C9C93', '#5F807A', '#465F5C'], hi: ['#B5D2D0', '#6F8F8B'], leaf: ['#BFD9D6', '#86A8A3', '#5E7F7B'], shadow: '#2E4544', moss: ['#7F9E96', '#55716C'], edge: '#F4FBFF' },
  frozen: { pad: ['#9DB4BF', '#7D97A5', '#5D7785'], hi: ['#D6E7EF', '#8FA8B5'], leaf: ['#E1EEF4', '#AFC6D2', '#7F98A6'], shadow: '#3E5260', moss: ['#A9BFC9', '#78909C'], edge: '#FFFFFF' },
  curled: { pad: ['#8A9C70', '#6E8257', '#4F603D'], hi: ['#A9B98B', '#71845A'], leaf: ['#B5C391', '#8B9D6A', '#647549'], shadow: '#36452B', moss: ['#8A9A6A', '#5E6E45'] },
  dewy: { pad: ['#5F7F5E', '#4B6A4C', '#344E37'], hi: ['#86A585', '#4F6E50'], leaf: ['#93B591', '#668B66', '#466646'], shadow: '#24402B', moss: ['#5E8A5A', '#3A5E3A'], gloss: true },
  dim: { pad: ['#6E8460', '#566C4B', '#3F5237'], hi: ['#8EA27E', '#5B704F'], leaf: ['#9DB088', '#73875F', '#536544'], shadow: '#2C3C27', moss: ['#6E8458', '#4A5C3A'] },
  washed: { pad: ['#8A928A', '#737B73', '#5A615A'], hi: ['#A5ACA5', '#777E77'], leaf: ['#B0B6B0', '#8B928B', '#666C66'], shadow: '#3F443F', moss: ['#8A928A', '#5F665F'] },
};

// Mix two #rrggbb colours (t = share of b)
function mix(a: string, b: string, t: number): string {
  const n = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2].map((i) => Math.round(n(a, i) + (n(b, i) - n(a, i)) * t).toString(16).padStart(2, '0')).join('')}`;
}
const mixAll = <T extends string[]>(a: T, b: T, t: number) => a.map((c, i) => mix(c, b[i], t)) as T;

// The palette to draw: the foliage tone, with the neighbouring season's tone mixed in near a boundary.
export function paletteFor(foliage: Foliage, blend: AvatarPresentation['foliageBlend']): Palette {
  const p = PALETTES[foliage];
  if (!blend || blend.amount <= 0) return p;
  const q = PALETTES[blend.tone];
  const t = blend.amount;
  return {
    ...p,
    pad: mixAll(p.pad, q.pad, t),
    hi: mixAll(p.hi, q.hi, t),
    leaf: mixAll(p.leaf, q.leaf, t),
    shadow: mix(p.shadow, q.shadow, t),
    moss: mixAll(p.moss, q.moss, t),
  };
}

// Gradients for the pads. Stop colours transition, so a change of state recolours the tree slowly.
export const FoliageDefs: React.FC<{ palette: Palette }> = ({ palette: p }) => {
  const t = { transition: 'stop-color 2s ease' };
  return (
    <>
      <linearGradient id="canopyFill" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style={{ ...t, stopColor: p.pad[0] }} />
        <stop offset="60%" style={{ ...t, stopColor: p.pad[1] }} />
        <stop offset="100%" style={{ ...t, stopColor: p.pad[2] }} />
      </linearGradient>
      <linearGradient id="canopyHi" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" style={{ ...t, stopColor: p.hi[0] }} />
        <stop offset="100%" style={{ ...t, stopColor: p.hi[1] }} />
      </linearGradient>
      <linearGradient id="mossGradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style={{ ...t, stopColor: p.moss[0] }} />
        <stop offset="100%" style={{ ...t, stopColor: p.moss[1] }} />
      </linearGradient>
    </>
  );
};

// Small deterministic random, so the leaves sit in the same place on every render
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PadShape {
  id: 'left' | 'right' | 'top';
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  count: number;
  seed: number;
}

export const PADS: PadShape[] = [
  { id: 'left', cx: 110, cy: 190, rx: 50, ry: 33, count: 34, seed: 11 },
  { id: 'right', cx: 340, cy: 172, rx: 55, ry: 39, count: 38, seed: 23 },
  { id: 'top', cx: 220, cy: 80, rx: 80, ry: 51, count: 52, seed: 37 },
];

interface LeafSpec {
  x: number;
  y: number;
  angle: number; // leaf points along this direction (deg, SVG: 90 = down)
  size: number;
  shade: number; // 0-2 → palette leaf colour
  r: number; // 0-1 per-leaf random for variations
  rim: boolean;
  delay: number;
  gap: number; // 0-1: above the canopy's fullness this leaf is missing (rim leaves go first)
}

function leavesFor(pad: PadShape): LeafSpec[] {
  const rand = rng(pad.seed);
  // A separate stream for the gaps, so the leaves themselves never move
  const gapRand = rng(pad.seed * 7919 + 13);
  const out: LeafSpec[] = [];
  for (let i = 0; i < pad.count; i++) {
    const rim = i < pad.count * 0.68;
    // Rim leaves cover the upper arc and sides; the rest are scattered over the pad
    const a = rim ? (-195 + rand() * 210) * (Math.PI / 180) : rand() * Math.PI * 2;
    const k = rim ? 0.86 + rand() * 0.2 : 0.25 + rand() * 0.5;
    const x = pad.cx + Math.cos(a) * pad.rx * k;
    const y = pad.cy + Math.sin(a) * pad.ry * k;
    const outward = (Math.atan2((y - pad.cy) * (pad.rx / pad.ry), x - pad.cx) * 180) / Math.PI;
    out.push({
      x,
      y,
      angle: outward + (rand() - 0.5) * 50,
      size: 1.05 + rand() * 0.55,
      shade: rim ? (rand() < 0.55 ? 0 : 1) : rand() < 0.5 ? 1 : 2,
      r: rand(),
      rim,
      delay: -rand() * 6,
      // Loss shows at the rim first: rim leaves lean high, inner ones low (≈ 1 - fullness of all go)
      gap: rim ? Math.pow(gapRand(), 0.75) : Math.pow(gapRand(), 1.4),
    });
  }
  return out;
}

const norm = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

// Individual ficus leaves on a pad: each one droops, curls, frosts or yellows on its own.
export const PadLeaves: React.FC<{
  pad: PadShape;
  foliage: Foliage;
  palette: Palette;
  droop: number;
  effects: AvatarEffect[];
  seasonal: AvatarPresentation['seasonalLeaves'];
  canopy?: AvatarPresentation['canopy'];
}> = ({ pad, foliage, palette: p, droop, effects, seasonal, canopy = { fullness: 1, refilling: 0 } }) => {
  const leaves = useMemo(() => leavesFor(pad), [pad]);
  const curl = foliage === 'curled' ? 0.45 : foliage === 'parched' || foliage === 'scorched' ? 0.7 : 1;
  // How many leaves show the season: a share of the pad, growing and fading with the yearly cycle
  // (or, with a daily photo, the share of yellow leaves it showed, if more)
  const yellowShare = Math.max(effects.includes('yellow_leaves') ? 0.11 : 0.13 * seasonal.yellowing, canopy.yellow ?? 0);
  const freshShare = effects.includes('new_leaves') ? 0.28 : 0.32 * seasonal.newGrowth;
  const beads = effects.includes('condensation') || foliage === 'dewy';
  // A humid night: larger dew beads on more leaves, each glinting at its own pace
  const dew = effects.includes('dew');
  return (
    <g>
      {leaves.map((l, i) => {
        // The last weeks: leaves above the canopy's fullness are missing; a share of the gap is coming back
        // as small fresh tips while it refills
        const missing = l.gap > canopy.fullness;
        const tip = missing && canopy.fullness < 1 && (l.gap - canopy.fullness) / (1 - canopy.fullness) < canopy.refilling * 0.6;
        if (missing && !tip) return null;
        // Wilting turns each leaf toward the ground; perky (negative droop) lifts it
        const tilt = norm(90 - l.angle) * Math.max(-0.25, droop) * 0.38;
        let fill = p.leaf[l.shade];
        let scale = l.size;
        let cls = 'leaf-quiver';
        if (tip) {
          return (
            <g key={i} transform={`translate(${l.x.toFixed(1)} ${l.y.toFixed(1)}) rotate(${l.angle.toFixed(1)})`}>
              <g style={{ transform: `rotate(${tilt.toFixed(1)}deg) scale(${(l.size * 0.62).toFixed(2)})`, transition: 'transform 2.5s ease-in-out' }}>
                <g className="leaf-quiver leaf-fresh" style={{ animationDelay: `${l.delay.toFixed(2)}s` }}>
                  <path d="M 0,0 Q 5,-4.6 12,0 Q 5,4.6 0,0 Z" fill="#CDEB9A" />
                </g>
              </g>
            </g>
          );
        }
        if (l.r < yellowShare) fill = l.r < yellowShare / 2 ? '#D9A93F' : '#E2C35A';
        if ((foliage === 'parched' || foliage === 'scorched') && l.r > 0.82) fill = '#93643A';
        if (l.rim && l.r > 1 - freshShare) {
          fill = '#CDEB9A';
          scale *= 1.12;
          cls = 'leaf-quiver leaf-fresh';
        }
        return (
          <g key={i} transform={`translate(${l.x.toFixed(1)} ${l.y.toFixed(1)}) rotate(${l.angle.toFixed(1)})`}>
            <g style={{ transform: `rotate(${tilt.toFixed(1)}deg) scale(${scale.toFixed(2)}, ${(scale * curl).toFixed(2)})`, transition: 'transform 2.5s ease-in-out' }}>
              <g className={cls} style={{ animationDelay: `${l.delay.toFixed(2)}s` }}>
                <path d="M 0,0 Q 5,-4.6 12,0 Q 5,4.6 0,0 Z" fill={fill} stroke={p.edge ?? 'none'} strokeWidth={p.edge ? 0.9 : 0} style={{ transition: 'fill 2s ease' }} />
                <path d="M 1.5,0 L 10,0" stroke={p.shadow} strokeWidth="0.6" opacity="0.35" />
                {p.gloss && l.r > 0.6 && <path d="M 3,-1.6 Q 6,-3 9,-1.4" stroke="#FFFFFF" strokeWidth="0.8" opacity="0.45" fill="none" strokeLinecap="round" />}
                {dew && l.r < 0.55 ? (
                  // A dew bead catching the light, glinting at its own pace
                  <g className="dew-glint" style={{ animationDelay: `${((l.r * 37) % 8).toFixed(2)}s`, transformBox: 'fill-box', transformOrigin: 'center' }}>
                    <circle cx="8" cy="1.5" r="1.8" fill="#EAF6FF" opacity="0.95" />
                    <circle cx="7.4" cy="0.9" r="0.6" fill="#FFFFFF" />
                  </g>
                ) : (
                  beads && l.r < 0.3 && <circle cx="7" cy="1" r="1.1" fill="#EAF6FF" opacity="0.9" />
                )}
              </g>
            </g>
          </g>
        );
      })}
    </g>
  );
};

// A thinner canopy (the last weeks): with fewer leaves, more of the pad's branchlets show between them.
// Thin bark-coloured twigs fan up from where the branch enters the pad, with small forks. Stable shapes;
// how many show follows the fullness. No shading: just the branches you'd see through a sparser tree.
const MAX_BRANCHLETS: Record<PadShape['id'], number> = { left: 5, right: 6, top: 8 };
const BRANCH_ENTRIES: Record<PadShape['id'], { x: number; y: number }[]> = {
  left: [{ x: 145, y: 212 }],
  right: [{ x: 302, y: 204 }],
  top: [{ x: 188, y: 116 }, { x: 222, y: 122 }, { x: 252, y: 114 }],
};
export const PadBranchlets: React.FC<{ pad: PadShape; fullness: number; palette: Palette }> = ({ pad, fullness }) => {
  const twigs = useMemo(() => {
    const rand = rng(pad.seed * 104729 + 7);
    // Where the tree's branches enter the pad (the crown has three, each side pad one)
    const entries = BRANCH_ENTRIES[pad.id];
    return Array.from({ length: MAX_BRANCHLETS[pad.id] }, (_, i) => {

      // Spread evenly over the upper arc, with a little jitter
      const n = MAX_BRANCHLETS[pad.id];
      const a = ((-165 + (150 * (i + 0.5)) / n + (rand() - 0.5) * 16) * Math.PI) / 180;
      const k = 0.5 + rand() * 0.32;
      const ex = pad.cx + Math.cos(a) * pad.rx * k;
      const ey = pad.cy + Math.sin(a) * pad.ry * k;
      // Each twig grows from the branch entry nearest its tip, so they fan out without crossing
      const { x: bx, y: by } = entries.reduce((best, e) => (Math.abs(e.x - ex) < Math.abs(best.x - ex) ? e : best), entries[0]);
      const mx = (bx + ex) / 2 + (rand() - 0.5) * pad.rx * 0.18;
      const my = (by + ey) / 2 + (rand() - 0.5) * pad.ry * 0.12;
      // One or two small forks off the outer half
      const forks = Array.from({ length: 1 + Math.round(rand()) }, () => {
        const t = 0.55 + rand() * 0.3;
        const fx = (1 - t) * (1 - t) * bx + 2 * (1 - t) * t * mx + t * t * ex;
        const fy = (1 - t) * (1 - t) * by + 2 * (1 - t) * t * my + t * t * ey;
        const fa = a + (rand() < 0.5 ? -1 : 1) * (0.45 + rand() * 0.35);
        const len = pad.rx * (0.12 + rand() * 0.1);
        return { x1: fx, y1: fy, x2: fx + Math.cos(fa) * len, y2: fy + Math.sin(fa) * len };
      });
      // The order they show in as the canopy thins (stable)
      return { bx, by, mx, my, ex, ey, forks, order: rand() };
    }).sort((x, y) => x.order - y.order);
  }, [pad]);
  const n = Math.round(Math.max(0, Math.min(1, (1 - fullness) / 0.4)) * twigs.length);
  if (n === 0) return null;
  const f = (v: number) => v.toFixed(1);
  return (
    <g pointerEvents="none" fill="none" strokeLinecap="round">
      {twigs.slice(0, n).map((t, i) => (
        <g key={i}>
          <path d={`M ${f(t.bx)},${f(t.by)} Q ${f(t.mx)},${f(t.my)} ${f(t.ex)},${f(t.ey)}`} stroke="#5E5243" strokeWidth="2.2" />
          <path d={`M ${f(t.bx)},${f(t.by)} Q ${f(t.mx)},${f(t.my)} ${f(t.ex)},${f(t.ey)}`} stroke="#8C7D6D" strokeWidth="0.7" opacity="0.6" />
          {t.forks.map((k, j) => (
            <path key={j} d={`M ${f(k.x1)},${f(k.y1)} L ${f(k.x2)},${f(k.y2)}`} stroke="#5E5243" strokeWidth="1.3" />
          ))}
        </g>
      ))}
    </g>
  );
};

// Bottom edge points of each pad, where drips and icicles hang
export const PAD_UNDERSIDES: { x: number; y: number }[] = [
  { x: 85, y: 220 }, { x: 108, y: 225 }, { x: 132, y: 222 },
  { x: 305, y: 205 }, { x: 335, y: 212 }, { x: 365, y: 208 },
  { x: 175, y: 128 }, { x: 205, y: 133 }, { x: 250, y: 132 }, { x: 278, y: 124 },
];

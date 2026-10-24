import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AvatarFace } from '../../src/components/avatar/AvatarFace';
import { BonsaiAvatar } from '../../src/components/avatar/BonsaiAvatar';
import type { ExpressionState } from '../../src/expression/expressionTypes';
import { droopOf, EYES, leafLook, lookOf, pupilOffset, SPECS, TONES, type Look } from './look';
import { mul, readRig, type Mat } from './rig';

// The display's look rules (look.ts, and the firmware's C) against what React draws, for a sweep of states.
// Markup only (no Chrome): every leaf's matrix, colour, edge, midrib, gloss and freshness, which leaves show,
// the pads' droop, and the pupils' place for a gaze. Throws on the first difference.

export function svgOf(state: ExpressionState): string {
  const svg = /<svg[\s\S]*<\/svg>/.exec(renderToStaticMarkup(createElement(BonsaiAvatar, { expression: state })))?.[0];
  if (!svg) throw new Error('BonsaiAvatar rendered no <svg>');
  return svg;
}

const close = (a: Mat, b: Mat, tol: number) => a.every((v, i) => Math.abs(v - b[i]) <= tol * (i >= 4 ? 10 : 1));

function variant(base: ExpressionState, change: (s: ExpressionState) => void): ExpressionState {
  const s = structuredClone(base);
  change(s);
  return s;
}

// The states the sweep draws: every tone at a few droops, shrunk, with seasons, yellowing, new leaves, a thin
// and a refilling canopy, a blend between tones
export function sweep(base: ExpressionState): ExpressionState[] {
  const out: ExpressionState[] = [];
  TONES.forEach((tone, i) =>
    [-0.2, 0, 0.31, 1].forEach((d, j) =>
      out.push(
        variant(base, (s) => {
          s.avatar.foliage = tone;
          s.leafDroop = d;
          s.avatar.posture = (i + j) % 3 === 0 ? 'shrink' : 'normal';
          s.avatar.foliageBlend = j === 2 ? { tone: TONES[(i + 3) % TONES.length], amount: 0.35 } : null;
          s.avatar.effects = j === 1 ? ['yellow_leaves'] : j === 3 && i % 2 ? ['new_leaves'] : [];
          s.avatar.seasonalLeaves = { newGrowth: (i % 4) / 4, yellowing: (i % 3) / 3, leafDrop: 0 };
          s.avatar.canopy = i % 5 === 0 ? { fullness: 0.72, refilling: j / 3, yellow: j === 0 ? 0.2 : undefined } : { fullness: 1, refilling: 0 };
        })
      )
    )
  );
  return out;
}

export function checkRules(states: ExpressionState[]): { states: number; leaves: number } {
  let leaves = 0;
  for (const s of states) {
    const look: Look = lookOf(s);
    const rig = readRig(svgOf(s));
    rig.pads.forEach((p, i) => {
      if (!close(p.droop, droopOf(i, look.droop, look.shrink), 1e-4)) throw new Error(`Pad ${i}'s droop differs from the website at ${JSON.stringify(look)}`);
    });
    const mine = SPECS.map((l) => leafLook(l, look)).filter((l) => l !== null);
    if (mine.length !== rig.leaves.length) throw new Error(`${mine.length} leaves show by the rules, the website shows ${rig.leaves.length} (${s.avatar.foliage}, canopy ${JSON.stringify(s.avatar.canopy)})`);
    mine.forEach((l, i) => {
      const w = rig.leaves[i];
      const m = mul(droopOf(l.pad, look.droop, look.shrink), l.local);
      const same =
        w.pad === l.pad && close(w.m, m, 0.01) && w.fill.toLowerCase() === l.fill.toLowerCase() && (w.edge ?? null) === l.edge && Math.abs(w.edgeWidth - l.edgeWidth) < 1e-6 &&
        (w.rib ?? null)?.toLowerCase() === l.rib?.toLowerCase() && w.gloss === l.gloss && w.fresh === l.fresh;
      if (!same) throw new Error(`Leaf ${i} (${s.avatar.foliage}, droop ${look.droop}): the website ${JSON.stringify(w)}, the rules ${JSON.stringify({ ...l, m })}`);
    });
    leaves += mine.length;
  }
  return { states: states.length, leaves };
}

// The pupils' translate in AvatarFace's markup for a gaze, against pupilOffset
export function checkPupils(base: ExpressionState): number {
  let n = 0;
  for (const eyes of EYES)
    for (const g of [{ x: 0, y: 0 }, { x: 3.2, y: -0.8 }, { x: -2.6, y: 1.8 }, { x: 1.1, y: 2.6 }, { x: -3.4, y: -2.6 }]) {
      const html = renderToStaticMarkup(createElement(AvatarFace, { look: { ...base.avatar, eyes }, blinking: false, gaze: g }));
      const m = /transform:translate\((-?[\d.]+)px, ?(-?[\d.]+)px\)/.exec(html);
      const want = pupilOffset(eyes, g);
      if (!m !== !want) throw new Error(`Eyes ${eyes}: the website ${m ? 'has' : 'has no'} pupils, the rules ${want ? 'have' : 'have none'}`);
      if (m && want && (Math.abs(Number(m[1]) - want[0]) > 1e-6 || Math.abs(Number(m[2]) - want[1]) > 1e-6))
        throw new Error(`Eyes ${eyes} at gaze ${JSON.stringify(g)}: the website moves the pupils to ${m[1]}, ${m[2]}, the rules to ${want}`);
      n++;
    }
  return n;
}

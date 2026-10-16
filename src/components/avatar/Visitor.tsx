import React, { useEffect, useRef, useState } from 'react';
import type { TouchResponse, VisitorPresentation } from '../../expression/expressionTypes';
import { habituate } from '../../expression/touch';

// A visitor in the tree (the squirrel). Draws what the Expression Engine decided (`expression.visitor`):
// out on a branch, or tucked behind a pad, peeking. Evidence class "art"; it decides nothing.
//
// Petting the leaves while it visits is play (attention, never stored): it hops around the tree, sometimes
// dives behind a pad and comes back out after `play.returnMs`. HOW it plays comes from upstream
// (`visitor.play`, from the tree's state): a thriving tree's squirrel is playful, a comfortable one's gentle,
// and one hiding through a stress only ducks and peeks again. Its tail wags in the tree's own rhythm
// (`play.wag`, the tree's sway). Continuous stroking settles the play (the touch habituation); a rest
// recovers it. More petting never brings more visits.
//
// Two layers so it can hide: <Visitor layer="behind"> is drawn before the foliage (a pad covers its body),
// <Visitor layer="front"> after it. Both draw the pose from one useVisitorPlay() in the avatar.

type Spot = VisitorPresentation['spot'];
type Pad = 'left_branch' | 'right_branch' | 'crown';

// Where it sits (feet), which way it faces (1 = right, -1 = left), and a tilt (climbing the trunk)
const PERCH: Record<Spot, { x: number; y: number; dir: 1 | -1; rot?: number }> = {
  left_branch: { x: 150, y: 232, dir: -1 }, // on the left branch, near the trunk, looking out
  right_branch: { x: 292, y: 222, dir: 1 },
  crown: { x: 246, y: 34, dir: 1 }, // on top of the crown
  trunk: { x: 276, y: 334, dir: -1, rot: -12 }, // clinging to the right edge of the trunk, belly to the bark, clear of the face
  pot_rim: { x: 306, y: 373, dir: -1 }, // sitting on the pot rim, looking at the tree
};
const PERCHES = Object.keys(PERCH) as Spot[];
// Where it hides: behind the top edge of a pad, so only the head and ears show when it peeks
const HIDE: Record<Pad, { x: number; y: number; dir: 1 | -1 }> = {
  left_branch: { x: 118, y: 164, dir: 1 },
  right_branch: { x: 346, y: 141, dir: -1 },
  crown: { x: 194, y: 44, dir: 1 },
};
// The pad nearest each perch
const HIDE_FOR: Record<Spot, Pad> = { left_branch: 'left_branch', right_branch: 'right_branch', crown: 'crown', trunk: 'right_branch', pot_rim: 'left_branch' };

// An older server sends visitors without `play`: answer gently, in a neutral rhythm
const FALLBACK_PLAY: VisitorPresentation['play'] = { kind: 'gentle', hopEveryMs: 4000, hideChance: 0.3, returnMs: 10_000, lingerMs: 4000, wag: { tempo: 0.8, amount: 0.7 } };
const playOf = (v: VisitorPresentation) => v.play ?? FALLBACK_PLAY;

const DIVE_MS = 600;
const PEEK_OUT_MS = 1400;

export type VisitorPose =
  | { at: 'perch'; spot: Spot; hop: number } // hop: counts moves (0 = just arrived), replays the hop arc
  | { at: 'hide'; pad: Pad; phase: 'dive' | 'hidden' | 'peek_out' | 'peek' }; // peek = the shy loop

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const basePose = (v: VisitorPresentation): VisitorPose =>
  v.mode === 'hiding' ? { at: 'hide', pad: HIDE_FOR[v.spot], phase: 'peek' } : { at: 'perch', spot: v.spot, hop: 0 };

// The play: one per avatar, driven by petting strokes. Never stored, never sent.
export function useVisitorPlay(visitor: VisitorPresentation | null, strokeAt: number | null, habituation: TouchResponse['habituation'] | null): VisitorPose | null {
  const [pose, setPoseState] = useState<VisitorPose | null>(visitor ? basePose(visitor) : null);
  const poseRef = useRef(pose);
  const setPose = (p: VisitorPose | null) => {
    poseRef.current = p;
    setPoseState(p);
  };
  const v = useRef(visitor);
  v.current = visitor;
  const hab = useRef(habituation);
  hab.current = habituation;
  const play = useRef({ lastStroke: 0, level: 1, lastTick: 0, timer: null as ReturnType<typeof setTimeout> | null, timers: [] as ReturnType<typeof setTimeout>[] });
  const seenStroke = useRef(strokeAt);

  const clearAll = () => {
    const p = play.current;
    if (p.timer) clearTimeout(p.timer);
    p.timer = null;
    p.timers.forEach(clearTimeout);
    p.timers = [];
  };
  const later = (ms: number, fn: () => void) => play.current.timers.push(setTimeout(fn, ms));

  // A new visit, or the tree's state flips it between visiting and hiding: start from its base pose
  useEffect(() => {
    clearAll();
    setPose(visitor ? basePose(visitor) : null);
    return clearAll;
  }, [visitor?.id, visitor?.mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hide behind a pad; after returnMs peek, then (when playing) hop back out at another spot
  const dive = (pad: Pad, comeBackTo: Spot | null) => {
    setPose({ at: 'hide', pad, phase: 'dive' });
    later(DIVE_MS, () => setPose({ at: 'hide', pad, phase: 'hidden' }));
    later(v.current ? playOf(v.current).returnMs : 10_000, () => {
      setPose({ at: 'hide', pad, phase: comeBackTo ? 'peek_out' : 'peek' });
      if (comeBackTo) later(PEEK_OUT_MS, () => setPose({ at: 'perch', spot: comeBackTo, hop: Date.now() }));
    });
  };

  const tick = () => {
    const p = play.current;
    p.timer = null;
    const vis = v.current;
    const cur = poseRef.current;
    const now = Date.now();
    if (!vis || !cur) return;
    // Continuous stroking settles the play toward the touch floor; a rest recovers it
    if (hab.current && p.lastTick) p.level = habituate(p.level, hab.current, now - p.lastTick, now - p.lastStroke < 1500);
    p.lastTick = now;
    if (cur.at !== 'perch') return; // hiding: the return timer brings it back
    const pl = playOf(vis);
    if (now - p.lastStroke > pl.lingerMs) return; // play is over: it stays where it ended up
    const others = PERCHES.filter((s) => s !== cur.spot);
    const next = others[Math.floor(Math.random() * others.length)];
    if (Math.random() < pl.hideChance) dive(HIDE_FOR[cur.spot], next);
    else setPose({ at: 'perch', spot: next, hop: cur.hop + 1 });
    const floor = hab.current?.floor ?? 0.4;
    p.timer = setTimeout(tick, (pl.hopEveryMs / Math.max(floor, p.level)) * (0.75 + Math.random() * 0.5));
  };

  useEffect(() => {
    if (strokeAt === null || strokeAt === seenStroke.current) return;
    seenStroke.current = strokeAt;
    const vis = v.current;
    const cur = poseRef.current;
    if (!vis || !cur || reducedMotion()) return;
    const p = play.current;
    if (p.lastStroke && strokeAt - p.lastStroke > 60_000) p.level = 1; // a long rest: fresh again
    p.lastStroke = strokeAt;
    if (playOf(vis).kind === 'shy') {
      // A stressed tree doesn't play: the squirrel ducks, and peeks again after a while
      if (cur.at === 'hide' && cur.phase === 'peek') dive(cur.pad, null);
      return;
    }
    if (!p.timer && cur.at === 'perch') p.timer = setTimeout(tick, 300);
  }, [strokeAt]); // eslint-disable-line react-hooks/exhaustive-deps

  return visitor ? pose : null;
}

// Facing right, feet at (0,0), about 36 units tall.
const Squirrel: React.FC<{ carrying: boolean }> = ({ carrying }) => (
  <g>
    {/* Bushy tail: wags from its base */}
    <g className="visitor-tail" style={{ transformBox: 'fill-box', transformOrigin: '85% 95%' }}>
      <path d="M -3,-4 C -17,-3 -23,-17 -17,-28 C -13,-36 -2,-37 -1,-29 C 0,-23 -9,-21 -9,-14 C -9,-9 -6,-7 -3,-6 Z" fill="#A85A2A" />
      <path d="M -15,-27 C -12,-33 -5,-34 -4,-29 C -6,-31 -11,-31 -15,-27 Z" fill="#D08A4E" opacity="0.8" />
      <path d="M -17,-14 C -18,-20 -16,-24 -14,-26" stroke="#C47A40" strokeWidth="1.2" fill="none" strokeLinecap="round" opacity="0.7" />
    </g>
    {/* Body, belly, haunch */}
    <ellipse cx="2" cy="-9" rx="7" ry="9" fill="#9C5228" />
    <ellipse cx="-1.5" cy="-4.5" rx="5" ry="4.5" fill="#8A4622" />
    <ellipse cx="5" cy="-9" rx="3.4" ry="6" fill="#F1DDBA" />
    {/* Head: bobs while it nibbles */}
    <g className="visitor-head" style={{ transformBox: 'fill-box', transformOrigin: '30% 90%' }}>
      <path d="M 3,-24 L 2.2,-31 L 4.2,-29.5 L 6.6,-25 Z" fill="#9C5228" />
      <path d="M 2.2,-31 L 1.4,-33.5 L 3.4,-30.6 Z" fill="#7A3E1C" />
      <circle cx="6" cy="-20" r="5.6" fill="#A85A2A" />
      <ellipse cx="10.6" cy="-18.8" rx="3.2" ry="2.6" fill="#B8693A" />
      <ellipse cx="8.8" cy="-17" rx="2.6" ry="1.6" fill="#F1DDBA" />
      <circle cx="13.4" cy="-19.4" r="1" fill="#2B1A10" />
      <g className="visitor-eye">
        <circle cx="7.9" cy="-21.2" r="1.25" fill="#1E140C" />
        <circle cx="8.3" cy="-21.6" r="0.4" fill="#FFFFFF" />
      </g>
    </g>
    {/* Front paws, holding a nut in autumn */}
    {carrying && (
      <g>
        <ellipse cx="11" cy="-12.5" rx="2.5" ry="2.9" fill="#7B4A22" />
        <path d="M 8.6,-14.4 Q 11,-16.6 13.4,-14.4 Q 11,-15.3 8.6,-14.4 Z" fill="#5A3416" />
      </g>
    )}
    <ellipse cx="8.5" cy="-11.6" rx="1.8" ry="1.2" fill="#8A4622" />
    <ellipse cx="10" cy="-11" rx="1.6" ry="1.1" fill="#8A4622" />
    {/* Feet */}
    <ellipse cx="0" cy="-0.6" rx="5.5" ry="1.6" fill="#7A3E1C" />
  </g>
);

interface VisitorProps {
  visitor: VisitorPresentation | null;
  pose: VisitorPose | null;
  layer: 'behind' | 'front';
}

export const Visitor: React.FC<VisitorProps> = ({ visitor, pose, layer }) => {
  if (!visitor || !pose) return null;
  if (layer !== (pose.at === 'hide' ? 'behind' : 'front')) return null;
  // The tail wags in the tree's rhythm (tempo and amplitude from the tree's sway, decided upstream)
  const { wag: w } = playOf(visitor);
  const wag = { '--wag-tempo': w.tempo, '--wag-amp': w.amount } as React.CSSProperties;
  const carrying = visitor.carrying === 'nut';

  if (pose.at === 'hide') {
    const at = HIDE[pose.pad];
    const cls = { dive: 'visitor-dive', hidden: 'visitor-ducked', peek_out: 'visitor-peek-once', peek: 'visitor-peek' }[pose.phase];
    return (
      <g transform={`translate(${at.x} ${at.y}) scale(${at.dir} 1)`} pointerEvents="none" aria-hidden style={wag}>
        <g key={`${visitor.id}:${pose.pad}:${pose.phase}`} className={`${cls} visitor-wag`}>
          <Squirrel carrying={carrying} />
        </g>
      </g>
    );
  }

  const at = PERCH[pose.spot];
  // The position glides between spots (CSS transition); the inner group replays the hop arc or the arrival
  return (
    <g pointerEvents="none" aria-hidden className="visitor-move" style={{ ...wag, transform: `translate(${at.x}px, ${at.y}px)` }}>
      <g transform={`rotate(${at.rot ?? 0}) scale(${at.dir} 1)`}>
        <g key={`${visitor.id}:${pose.hop}`} className={pose.hop === 0 ? 'visitor-arrive' : 'visitor-hop'}>
          <g className="visitor-idle visitor-wag">
            <Squirrel carrying={carrying} />
          </g>
        </g>
      </g>
    </g>
  );
};

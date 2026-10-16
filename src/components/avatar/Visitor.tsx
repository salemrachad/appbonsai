import React, { useEffect, useRef, useState } from 'react';
import type { TouchResponse, VisitorPresentation } from '../../expression/expressionTypes';
import { habituate } from '../../expression/touch';

// A visitor in the tree (the squirrel). Draws what the Expression Engine decided (`expression.visitor`):
// out on a branch, or tucked behind a pad, peeking. Evidence class "art"; it decides nothing.
//
// Petting the leaves while it visits is play (attention, never stored): it hops around the tree, sometimes
// dives behind a pad and comes back out after `play.returnMs`. HOW it plays comes from upstream
// (`visitor.play`, from the tree's state and its own boldness): a thriving tree's squirrel is playful, a
// comfortable one's gentle, and one hiding through a stress, or a new (or wary) one that only peeks
// (`mode: 'peek'`), only ducks and peeks again. Before its first visits there are only its traces. Its tail wags in the tree's own rhythm
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
  | { at: 'hide'; pad: Pad; phase: 'dive' | 'hidden' | 'peek_out' | 'peek' } // peek = the shy loop
  | { at: 'drey'; twitch: number }; // asleep in the drey (drawn by <Drey>); twitch replays a tail twitch

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const basePose = (v: VisitorPresentation): VisitorPose =>
  v.mode === 'sleeping'
    ? { at: 'drey', twitch: 0 }
    : v.mode === 'hiding' || v.mode === 'peek'
    ? { at: 'hide', pad: HIDE_FOR[v.spot], phase: 'peek' }
    : { at: 'perch', spot: v.spot, hop: 0 };

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
  }, [visitor?.id, visitor?.mode, visitor?.spot]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // Never onto the sloth's branch or by the leaves the dragonfly rests on (encounters)
    const free = PERCHES.filter((s) => s !== cur.spot && !(vis.avoid ?? []).includes(s));
    const others = free.length ? free : PERCHES.filter((s) => s !== cur.spot);
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
    if (cur.at === 'drey') {
      // Asleep: a stroke only makes the tail twitch; it never wakes up to play
      setPose({ at: 'drey', twitch: strokeAt });
      return;
    }
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
const Squirrel: React.FC<{ carrying: boolean; watch?: number }> = ({ carrying, watch = 0 }) => (
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
    {/* Head: bobs while it nibbles; tilts toward whoever it watches (encounters) */}
    <g className="visitor-watch" style={{ transform: `rotate(${watch}deg)`, transformBox: 'fill-box', transformOrigin: '30% 90%' } as React.CSSProperties}>
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
  watchAt?: { x: number; y: number } | null; // encounters: the visitor it watches (avatar coordinates)
}

// Where the squirrel is right now (avatar coordinates), for the others to look at
export function visitorAt(pose: VisitorPose | null): { x: number; y: number } | null {
  if (!pose || pose.at === 'drey') return null;
  if (pose.at === 'hide') return { x: HIDE[pose.pad].x, y: HIDE[pose.pad].y - 20 };
  return { x: PERCH[pose.spot].x, y: PERCH[pose.spot].y - 20 };
}

// Facing and head tilt toward a target: it turns to face it, and its head tilts up or down (25 deg at most)
function watching(at: { x: number; y: number; dir: 1 | -1 }, target: { x: number; y: number } | null | undefined) {
  if (!target) return { dir: at.dir, tilt: 0 };
  const dx = target.x - at.x;
  const dir: 1 | -1 = Math.abs(dx) < 8 ? at.dir : dx > 0 ? 1 : -1;
  const dy = target.y - (at.y - 20);
  const tilt = Math.max(-25, Math.min(25, (Math.atan2(dy, Math.max(20, Math.abs(dx))) * 180) / Math.PI));
  return { dir, tilt: Math.round(tilt) };
}

export const Visitor: React.FC<VisitorProps> = ({ visitor, pose, layer, watchAt = null }) => {
  if (!visitor || !pose || pose.at === 'drey') return null;
  if (layer !== (pose.at === 'hide' ? 'behind' : 'front')) return null;
  // The tail wags in the tree's rhythm (tempo and amplitude from the tree's sway, decided upstream)
  const { wag: w } = playOf(visitor);
  const wag = { '--wag-tempo': w.tempo, '--wag-amp': w.amount } as React.CSSProperties;
  const carrying = visitor.carrying === 'nut';

  if (pose.at === 'hide') {
    const at = HIDE[pose.pad];
    const cls = { dive: 'visitor-dive', hidden: 'visitor-ducked', peek_out: 'visitor-peek-once', peek: 'visitor-peek' }[pose.phase];
    const look = watching(at, visitor.lookAt ? watchAt : null);
    return (
      <g transform={`translate(${at.x} ${at.y}) scale(${look.dir} 1)`} pointerEvents="none" aria-hidden style={wag}>
        <g key={`${visitor.id}:${pose.pad}:${pose.phase}`} className={`${cls} visitor-wag`}>
          <Squirrel carrying={carrying} watch={look.tilt} />
        </g>
      </g>
    );
  }

  const at = PERCH[pose.spot];
  // Watching another visitor: it faces it, the head tilts toward it (not while drinking or inspecting)
  const action0 = pose.hop === 0 && pose.spot === visitor.spot ? visitor.action ?? null : null;
  const look = watching(at, visitor.lookAt && (!action0 || action0 === 'shake_off') ? watchAt : null);
  // What it came for, shown where it arrived (once it plays and hops on, it's just a squirrel again)
  const action = pose.hop === 0 && pose.spot === visitor.spot ? visitor.action ?? null : null;
  const actionClass = action === 'drinking' ? 'visitor-drinking' : action === 'inspecting' ? 'visitor-inspecting' : action === 'shake_off' ? 'visitor-shaking' : 'visitor-idle';
  // Drinking leans forward over the wet soil; inspecting leans toward the cut
  const tilt = action === 'drinking' ? 'rotate(24)' : action === 'inspecting' ? 'rotate(10)' : undefined;
  // The position glides between spots (CSS transition); the inner group replays the hop arc or the arrival
  return (
    <g pointerEvents="none" aria-hidden className="visitor-move" style={{ ...wag, transform: `translate(${at.x}px, ${at.y}px)` }}>
      <g transform={`rotate(${at.rot ?? 0}) scale(${look.dir} 1)`}>
        <g key={`${visitor.id}:${pose.hop}`} className={pose.hop === 0 ? 'visitor-arrive' : 'visitor-hop'}>
          <g className={`${actionClass} visitor-wag`}>
            <g transform={tilt}>
              <Squirrel carrying={carrying && !action} watch={look.tilt} />
            </g>
            {action === 'drinking' && (
              // Little ripples where it laps at the wet soil
              <g fill="none" stroke="#9CC3E0" strokeWidth="0.9">
                <ellipse cx="17" cy="-1" rx="3" ry="1" className="visitor-ripple" />
                <ellipse cx="17" cy="-1" rx="3" ry="1" className="visitor-ripple" style={{ animationDelay: '0.9s' }} />
              </g>
            )}
            {action === 'shake_off' && (
              // Drops flicked off the fur
              <g fill="#8FC1E6">
                {[
                  [-14, -26, -1],
                  [14, -24, 1],
                  [-10, -10, -1],
                  [12, -8, 1],
                  [0, -34, 0],
                ].map(([x, y, d], i) => (
                  <circle key={i} cx={x} cy={y} r="1.3" className="visitor-flick" style={{ '--flick-x': d, animationDelay: `${0.15 + i * 0.07}s` } as React.CSSProperties} />
                ))}
              </g>
            )}
          </g>
        </g>
      </g>
    </g>
  );
};

// Signs of a squirrel that isn't here yet (its first days): a leaf at the tip of the left branch with a
// bite out of it and a few crumbs below, or a bushy tail tip showing over the back of the pot now and then
// (drawn before the pot, so the pot hides the rest). Static under reduced motion.
export const SquirrelTraces: React.FC<{ traces: 'nibbled_leaf' | 'tail_at_pot' | null; layer: 'behind_pot' | 'front' }> = ({ traces, layer }) => {
  if (traces === 'tail_at_pot' && layer === 'behind_pot')
    return (
      <g pointerEvents="none" aria-hidden transform="translate(318 380)">
        <g className="traces-tail" style={{ transformBox: 'fill-box', transformOrigin: '50% 100%' }}>
          <path d="M -3,6 C -9,-2 -10,-14 -4,-22 C 0,-27 7,-25 6,-18 C 5,-13 0,-11 1,-4 C 2,1 2,4 2,6 Z" fill="#A85A2A" />
          <path d="M -3,-20 C 0,-25 5,-24 5,-19 C 3,-21 0,-21 -3,-20 Z" fill="#D08A4E" opacity="0.8" />
        </g>
      </g>
    );
  if (traces === 'nibbled_leaf' && layer === 'front')
    return (
      <g pointerEvents="none" aria-hidden transform="translate(104 214)">
        {/* The leaf hangs from the branch tip; a round bite is missing from its edge */}
        <path d="M 0,0 C -6,4 -8,12 -4,19 C -1,23 4,22 6,17 C 3,16 2,12 4,10 C 6,8 6,4 4,2 C 3,1 1,0 0,0 Z" fill="#6E9A4C" />
        <path d="M 0,1 C -1,7 -2,13 -2,19" stroke="#4E7434" strokeWidth="0.7" fill="none" />
        {/* Crumbs on the moss below */}
        <g fill="#8E7454">
          <circle cx="22" cy="158" r="1" />
          <circle cx="28" cy="160" r="0.8" />
          <circle cx="33" cy="157" r="0.9" />
        </g>
      </g>
    );
  return null;
};

// The drey: a nest of twigs and leaves tucked into the right side of the crown. Weeks of a welcoming tree
// made visible (stage from upstream). Drawn inside the crown pad so it sways with it. When the squirrel
// sleeps there, only its tail drapes over the edge, breathing slowly; a stroke makes it twitch.
const DREY = { x: 276, y: 104 };
export const Drey: React.FC<{ stage: 'none' | 'started' | 'built'; visitor: VisitorPresentation | null; pose: VisitorPose | null; leaf: string }> = ({ stage, visitor, pose, leaf }) => {
  if (stage === 'none') return null;
  const { x, y } = DREY;
  const twig = { stroke: '#6B4A2E', strokeWidth: 1.6, strokeLinecap: 'round' as const, fill: 'none' };
  const grow = `translate(${x} ${y}) scale(1.25) translate(${-x} ${-y})`;
  if (stage === 'started') {
    // A few twigs wedged into the fork, a leaf caught in them: the beginnings of a nest
    const t = { ...twig, stroke: '#8E6842', strokeWidth: 2.4 };
    return (
      <g pointerEvents="none" aria-hidden transform={grow}>
        <ellipse cx={x} cy={y + 3} rx="13" ry="4" fill="#5C3F24" opacity="0.35" />
        <path d={`M ${x - 14},${y + 4} L ${x + 10},${y - 3}`} {...t} />
        <path d={`M ${x - 10},${y - 2} L ${x + 13},${y + 5}`} {...t} stroke="#7A5634" />
        <path d={`M ${x - 6},${y + 7} L ${x + 9},${y + 1}`} {...t} strokeWidth={1.8} />
        <path d={`M ${x - 3},${y - 5} L ${x + 4},${y + 8}`} {...t} strokeWidth={1.6} stroke="#A07A50" />
        <ellipse cx={x + 6} cy={y - 4} rx="4.2" ry="2" fill={leaf} transform={`rotate(-25 ${x + 6} ${y - 4})`} />
      </g>
    );
  }
  const asleep = !!visitor && visitor.mode === 'sleeping' && pose?.at === 'drey';
  const w = visitor ? visitor.play?.wag : null;
  return (
    <g pointerEvents="none" aria-hidden transform={grow}>
      {/* The ball of twigs and leaves */}
      <ellipse cx={x} cy={y} rx="18" ry="12.5" fill="#7A5634" />
      <ellipse cx={x + 2} cy={y + 3} rx="15" ry="8" fill="#664628" />
      <path d={`M ${x - 17},${y - 2} Q ${x},${y - 14} ${x + 17},${y - 3}`} {...twig} stroke="#8C6640" />
      <path d={`M ${x - 15},${y + 5} Q ${x - 2},${y - 6} ${x + 16},${y + 4}`} {...twig} stroke="#5C3F24" />
      <path d={`M ${x - 12},${y - 8} L ${x + 9},${y + 9}`} {...twig} stroke="#8C6640" strokeWidth={1.2} />
      <path d={`M ${x + 11},${y - 9} L ${x - 6},${y + 10}`} {...twig} stroke="#5C3F24" strokeWidth={1.2} />
      <path d={`M ${x + 15},${y - 6} L ${x + 22},${y - 11}`} {...twig} strokeWidth={1.1} />
      {/* The entrance */}
      <ellipse cx={x - 6} cy={y + 1} rx="5.5" ry="4.2" fill="#2E1E12" />
      {/* Leaves woven in, in the tree's own colour */}
      <ellipse cx={x + 6} cy={y - 9} rx="5" ry="2.4" fill={leaf} transform={`rotate(-20 ${x + 6} ${y - 9})`} />
      <ellipse cx={x + 13} cy={y + 1} rx="4.4" ry="2.1" fill={leaf} transform={`rotate(35 ${x + 13} ${y + 1})`} />
      <ellipse cx={x - 12} cy={y - 7} rx="4.2" ry="2" fill={leaf} transform={`rotate(25 ${x - 12} ${y - 7})`} />
      {asleep && (
        // Asleep inside: the bushy tail drapes out of the entrance
        <g style={{ '--wag-tempo': w?.tempo ?? 0.4, '--wag-amp': w?.amount ?? 0.2 } as React.CSSProperties}>
          <g key={pose?.at === 'drey' ? pose.twitch : 0} className={pose?.at === 'drey' && pose.twitch ? 'drey-tail drey-twitch' : 'drey-tail'} style={{ transformBox: 'fill-box', transformOrigin: '20% 5%' }}>
            <path
              d={`M ${x - 9},${y + 3} C ${x - 14},${y + 10} ${x - 18},${y + 20} ${x - 13},${y + 27} C ${x - 9},${y + 32} ${x - 2},${y + 28} ${x - 5},${y + 22} C ${x - 7},${y + 17} ${x - 3},${y + 10} ${x - 3},${y + 4} Z`}
              fill="#A85A2A"
            />
            <path d={`M ${x - 12},${y + 25} C ${x - 10},${y + 29} ${x - 5},${y + 28} ${x - 6},${y + 24}`} fill="#D08A4E" opacity="0.8" />
          </g>
          {/* Sleeping: a little "z" now and then */}
          <text x={x - 16} y={y - 8} fontSize="7" fill="#8A6B4A" className="drey-zzz" fontFamily="serif">z</text>
        </g>
      )}
    </g>
  );
};

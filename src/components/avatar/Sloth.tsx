import React, { useEffect, useRef, useState } from 'react';
import { APP_CONFIG } from '../../config/appConfig';
import type { SlothPresentation } from '../../expression/expressionTypes';

// The sloth (expression.sloth). Draws what upstream decided: hanging under a branch in one of its grips,
// inching along it, or asleep curled up. Everything it does is slow, at the tempo the Expression Engine
// set. Evidence class "art". Local behaviour: a stroke on the leaves gets a slow look and a slow blink (at
// most every few seconds). It never flees and never plays. Encounters (decided upstream): it turns its
// head toward the squirrel and keeps it there; a dragonfly resting on it (drawn here, as its rider, so it
// sways with it) makes it blink slowly. Reduced motion: still, no look.

// Where it grips each branch (SVG coordinates of the avatar), and the branch's slope
const GRIP: Record<SlothPresentation['branch'], { x: number; y: number; slope: number }> = {
  left_branch: { x: 150, y: 235, slope: 0.5 }, // the left branch runs down toward the trunk
  right_branch: { x: 296, y: 221, slope: -0.55 },
};

export const SLOTH_SIZE = 1.35; // drawn at this scale so it reads next to the squirrel
export const slothAt = (branch: SlothPresentation['branch']) => GRIP[branch];

const FUR = '#8D7B66';
const LIMB = '#7A6956';
const LIMB_FAR = '#6B5B49';
const CLAW = '#4A3B2C';

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

type Pt = [number, number];

// A limb from the body to the branch (or hanging free), and the long claws hooked over the branch
const Limb: React.FC<{ from: Pt; to: Pt; bend?: number; far?: boolean; leg?: boolean; claws?: boolean }> = ({ from, to, bend = 0, far, leg, claws = true }) => {
  const mx = (from[0] + to[0]) / 2 + bend;
  const my = (from[1] + to[1]) / 2;
  const [x, y] = to;
  return (
    <g>
      <path d={`M ${from[0]},${from[1]} Q ${mx},${my} ${x},${y}`} stroke={far ? LIMB_FAR : LIMB} strokeWidth={leg ? 3.8 : 4.2} fill="none" strokeLinecap="round" />
      {claws && <path d={`M ${x - 2},${y} Q ${x - 0.5},${y - 3.6} ${x + 2},${y - 1.8} M ${x},${y + 0.4} Q ${x + 1.5},${y - 3.2} ${x + 3.6},${y - 1.2}`} stroke={CLAW} strokeWidth="0.9" fill="none" strokeLinecap="round" />}
    </g>
  );
};

const Body: React.FC<{ cx: number; cy: number; rx: number; ry: number; rot?: number }> = ({ cx, cy, rx, ry, rot = 0 }) => (
  <g transform={`rotate(${rot} ${cx} ${cy})`}>
    <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={FUR} />
    <path
      d={`M ${cx - rx * 0.8},${cy - ry * 0.4} l -2,3 M ${cx - rx * 0.72},${cy + ry * 0.15} l -2.5,2.5 M ${cx + rx * 0.8},${cy - ry * 0.33} l 2,3 M ${cx + rx * 0.72},${cy + ry * 0.2} l 2.5,2.5 M ${cx - 3},${cy + ry * 0.8} l -1,3 M ${cx + 4},${cy + ry * 0.8} l 1,3`}
      stroke="#6F604F"
      strokeWidth="1"
      strokeLinecap="round"
    />
  </g>
);

// The head, centred at (0,0): the pale face mask, dark eye stripes, eyes, nose and the gentle smile.
// Open eyes sit ON the stripes with a pale rim and a highlight, so they read as open.
const Head: React.FC<{ x: number; y: number; rot?: number; asleep: boolean; looking: boolean; turn: number; slowBlink: boolean }> = ({ x, y, rot = 0, asleep, looking, turn, slowBlink }) => {
  const px = Math.sign(turn) * 0.45; // the pupils lead the turn
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`}>
      <g className="sloth-turn" style={{ transform: `rotate(${turn}deg)` }}>
        <g className={looking ? 'sloth-look' : ''} style={{ transformBox: 'fill-box', transformOrigin: '50% 80%' }}>
          <circle cx="0" cy="0" r="8.5" fill={FUR} />
          <ellipse cx="0" cy="1" rx="7" ry="5.8" fill="#E8DCC4" />
          <path d="M -6.4,-1.4 Q -4,1.6 -1.6,-0.2" stroke={CLAW} strokeWidth="2.4" fill="none" strokeLinecap="round" />
          <path d="M 6.4,-1.4 Q 4,1.6 1.6,-0.2" stroke={CLAW} strokeWidth="2.4" fill="none" strokeLinecap="round" />
          {asleep ? (
            <g stroke="#F3EBD9" strokeWidth="0.75" fill="none" strokeLinecap="round">
              <path d="M -4.8,0 Q -3.6,1 -2.4,0" />
              <path d="M 2.4,0 Q 3.6,1 4.8,0" />
            </g>
          ) : (
            <g className={looking ? 'sloth-blink' : slowBlink ? 'sloth-slowblink' : ''} style={{ transformBox: 'fill-box', transformOrigin: '50% 50%' }}>
              {[-3.6, 3.6].map((ex) => (
                <g key={ex}>
                  <circle cx={ex} cy="0" r="1.8" fill="#F3EBD9" />
                  <circle cx={ex + px} cy="0.1" r="1.15" fill="#1E1610" />
                  <circle cx={ex + px + 0.4} cy="-0.4" r="0.4" fill="#FFFFFF" />
                </g>
              ))}
            </g>
          )}
          <ellipse cx="0" cy="2.4" rx="1.4" ry="0.9" fill="#3A2C20" />
          <path d="M -2.2,4.2 Q 0,5.6 2.2,4.2" stroke="#3A2C20" strokeWidth="0.7" fill="none" strokeLinecap="round" />
        </g>
      </g>
    </g>
  );
};

// Where a resting dragonfly sits on it in each grip (local units, for the left branch; mirrored on the right
// branch where it sits on a flank, so its tail always points away from the tree), and which way it faces
const RIDER: Record<SlothPresentation['grip'] | 'asleep', { x: number; y: number; dir: 1 | -1 }> = {
  arms: { x: -11, y: 27, dir: 1 }, // on its outer flank, tail outward (clear of the tree's face)
  four: { x: -15, y: 11.6, dir: -1 }, // on its head
  two_legs_one_arm: { x: 3, y: 7.4, dir: -1 }, // on its back
  legs: { x: -10, y: 22, dir: 1 }, // on its hip
  one_arm: { x: -8, y: 30, dir: 1 }, // on its flank
  asleep: { x: 1, y: 7.5, dir: -1 }, // on its back
};

// Where a dragonfly rests on this sloth (local units), mirrored onto the outer flank on the right branch
function riderOf(sloth: SlothPresentation) {
  const asleep = sloth.pose === 'sleeping';
  const grip: SlothPresentation['grip'] = sloth.pose === 'hanging' ? sloth.grip ?? 'arms' : 'four';
  const r0 = RIDER[asleep ? 'asleep' : grip];
  const flank = !asleep && (grip === 'arms' || grip === 'legs' || grip === 'one_arm');
  return flank && sloth.branch === 'right_branch' ? { x: -r0.x, y: r0.y, dir: -r0.dir as 1 | -1 } : r0;
}
// The same spot in avatar coordinates (where a dragonfly flies to before it lands on the sloth)
export function slothRiderAt(sloth: SlothPresentation) {
  const g = GRIP[sloth.branch];
  const r = riderOf(sloth);
  return { x: g.x + r.x * SLOTH_SIZE, y: g.y + r.y * SLOTH_SIZE, dir: r.dir };
}

const RIDER_SCALE = 0.6; // a resting dragonfly drawn smaller than on a leaf, so it sits ON the sloth

interface Pose {
  asleep: boolean;
  looking: boolean;
  turn: number; // head turn (deg)
  slowBlink: boolean;
  s: number; // branch slope: a grip at x is at y = s·x
}

// Each grip from the same parts, around the grip point (0,0)
function Grip({ grip, p }: { grip: SlothPresentation['grip']; p: Pose }) {
  const b = (x: number): Pt => [x, p.s * x + 0.8]; // a point on the branch
  const head = (x: number, y: number, rot = 0) => <Head x={x} y={y} rot={rot} asleep={p.asleep} looking={p.looking} turn={p.turn} slowBlink={p.slowBlink} />;
  switch (grip) {
    case 'arms':
      // Both arms up to the branch, legs dangling, head between the arms
      return (
        <g>
          <Limb from={[-10, 15]} to={b(-6)} bend={-3} />
          <Limb from={[10, 15]} to={b(6)} bend={3} />
          <Body cx={0} cy={30} rx={12.5} ry={15} />
          <Limb from={[-7, 42]} to={[-4, 50]} bend={-2} leg claws={false} />
          <Limb from={[7, 42]} to={[4, 50]} bend={2} leg claws={false} />
          {head(0, 14)}
        </g>
      );
    case 'one_arm':
      // One arm holds; the body hangs and swings below it, the free arm hangs along its side
      return (
        <g>
          <Limb from={[-6, 15]} to={b(0)} bend={-2} />
          <Body cx={3} cy={31} rx={12.5} ry={15} />
          <Limb from={[12, 19]} to={[15.5, 34]} bend={2.5} claws={false} />
          <Limb from={[-3, 43]} to={[-1, 51]} bend={-2} leg claws={false} />
          <Limb from={[9, 43]} to={[7, 51]} bend={2} leg claws={false} />
          {head(2, 15, -6)}
        </g>
      );
    case 'legs':
      // Upside down by its legs, head below, arms hanging loose past it
      return (
        <g>
          <Limb from={[-6, 15]} to={b(-5)} bend={-2} leg />
          <Limb from={[6, 15]} to={b(5)} bend={2} leg />
          <Body cx={0} cy={28} rx={12} ry={15} />
          <Limb from={[-9, 37]} to={[-12, 54]} bend={-2} claws={false} />
          <Limb from={[9, 37]} to={[12, 54]} bend={2} claws={false} />
          {head(0, 45, 180)}
        </g>
      );
    case 'two_legs_one_arm':
      // Slung under the branch by both legs and one arm, the other arm hanging, the head turned out
      return (
        <g>
          <Limb from={[-7, 10]} to={b(-10)} bend={-1} far />
          <Limb from={[11, 12]} to={b(15)} bend={2} far leg />
          <Body cx={0} cy={17} rx={16} ry={10} rot={-4} />
          <Limb from={[7, 10]} to={b(9)} bend={1} leg />
          <Limb from={[-4, 21]} to={[-5, 37]} bend={-2.5} claws={false} />
          {head(-15, 21, -12)}
        </g>
      );
    case 'four':
    default:
      // All four limbs up to the branch, back down, slung beneath it; asleep: curled, head tucked in
      return (
        <g>
          <Limb from={[-7, 10]} to={b(-9)} bend={-1} far />
          <Limb from={[11, 12]} to={b(15)} bend={2} far leg />
          <Body cx={0} cy={17} rx={p.asleep ? 14 : 16} ry={p.asleep ? 11 : 10} />
          <Limb from={[-11, 12]} to={b(-15)} bend={-2} />
          <Limb from={[7, 10]} to={b(9)} bend={1} leg />
          {p.asleep ? head(-9, 20, -14) : head(-15, 20)}
        </g>
      );
  }
}

export const Sloth: React.FC<{ sloth: SlothPresentation | null; strokeAt: number | null; lookToward?: number | null; children?: React.ReactNode }> = ({ sloth, strokeAt, lookToward = null, children }) => {
  const [look, setLook] = useState(0);
  const seen = useRef(strokeAt);
  useEffect(() => {
    if (strokeAt === null || strokeAt === seen.current) return;
    seen.current = strokeAt;
    if (!sloth || sloth.pose === 'sleeping' || reducedMotion()) return;
    if (Date.now() - look < APP_CONFIG.habitat.sloth.blinkCooldownMs) return; // one slow look at a time
    setLook(Date.now());
  }, [strokeAt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!look) return;
    const t = setTimeout(() => setLook(0), 2800);
    return () => clearTimeout(t);
  }, [look]);

  if (!sloth) return null;
  const g = GRIP[sloth.branch];
  const asleep = sloth.pose === 'sleeping';
  // Climbing uses all four limbs; asleep it's always curled in all four
  const grip: SlothPresentation['grip'] = sloth.pose === 'hanging' ? sloth.grip ?? 'arms' : 'four';
  const motion = asleep ? 'sloth-sleep' : sloth.pose === 'climbing' ? 'sloth-climb' : `sloth-hang${grip === 'one_arm' ? ' sloth-one-arm' : ''}`;
  // Encounter: the head turns slowly toward the squirrel (upside down, the turn reads the other way)
  const side = sloth.lookAt === 'squirrel' && lookToward !== null && !reducedMotion() ? Math.sign(lookToward - g.x) || 1 : 0;
  const turn = side * 16 * (grip === 'legs' ? -1 : 1);
  const rider = riderOf(sloth);
  return (
    <g
      transform={`translate(${g.x} ${g.y}) scale(${SLOTH_SIZE})`}
      pointerEvents="none"
      aria-hidden
      style={{ '--sloth-tempo': sloth.tempo, '--sloth-dx': '16px', '--sloth-dy': `${16 * g.slope}px` } as React.CSSProperties}
    >
      <g key={sloth.id} className={motion} style={{ transformOrigin: '0px 0px' }}>
        <g key={grip} className="sloth-regrip">
          <Grip grip={grip} p={{ asleep, looking: !!look, turn, slowBlink: !!sloth.rider, s: g.slope }} />
          {/* A dragonfly resting on it (drawn by the avatar, positioned here so it sways along) */}
          {children && <g transform={`translate(${rider.x} ${rider.y}) scale(${(rider.dir * RIDER_SCALE) / SLOTH_SIZE} ${RIDER_SCALE / SLOTH_SIZE})`}>{children}</g>}
        </g>
        {asleep && (
          <text x="10" y="6" fontSize="7" fill="#8A6B4A" className="drey-zzz" fontFamily="serif">
            z
          </text>
        )}
      </g>
    </g>
  );
};

import React, { useEffect, useRef, useState } from 'react';
import { APP_CONFIG } from '../../config/appConfig';
import type { LucyPresentation } from '../../expression/expressionTypes';

// Lucy (expression.lucy): the household's Coton de Tuléar on the floor around the pot. Plays the route
// upstream planned, on the clock: she walks in, sniffs along the floor, sits in different places, settles
// down, dozes, and walks out. A visitor in the tree gets a glance, her watching it, or (curious, excited) she
// walks under it and sits looking up. Evidence class "art". Her look follows the hand-inked card style: white
// shaggy fur outlined in a soft navy ink, blue-grey shading instead of grey, big dark eyes with catch-lights
// and a large glossy nose.
//
// Local behaviour (UI only, never stored, never brings more visits):
// - she walks between her stops at a dog's pace (sniffing: nose down, eyes on the floor, in little bursts),
//   facing where she goes; in from the left when a visit begins, out again as it ends; she turns around once
//   before she lies down;
// - her head TURNS toward what she looks at (her face toward you, or in three-quarter view toward the tree, a
//   visitor, the floor, across the room), easing from one to the next;
// - her LIFE between the big moves (useLucyLife): glances that drift from what her route has her watching to
//   anything else, blinks, ear flicks, head tilts, sniffing the air, a yawn, a scratch behind the ear with a
//   hind leg, a sigh lying down; asleep, dream twitches; a tail that never quite stops; weight shifts;
// - she breathes at `breath` (about six breaths a minute when down or asleep: a pace to breathe along with);
// - a stroke or a tap: a head tilt (sitting, standing), a tail thump and a look up (down), only an ear twitch
//   asleep: she is never woken.
// Reduced motion: no walking, breathing, glances or reactions; she is just there, looking where her route says.

const FUR = '#FDFBF7';
const SHADE = '#C9D5EC'; // the blue-grey shading of the card style
const DEEP = '#A7B6D6';
const INK = '#4A5470'; // soft navy ink, never black
const DARK = '#191A20'; // eyes and nose

// Where she is drawn for each spot (avatar coordinates of the ground under her), and how large
export const SPOT: Record<LucyPresentation['spot'], { x: number; y: number }> = {
  pillow: { x: 46, y: 446 }, // on her cushion, left of the stand
  floor_left: { x: 84, y: 456 }, // the cool floor beside her pillow
  by_pot: { x: 140, y: 457 }, // by the stand's left leg, close to the tree
  pot_front: { x: 206, y: 458 }, // in front of the pot
  pot_right: { x: 274, y: 458 },
  floor_right: { x: 362, y: 457 }, // right of the stand (where the boots stand on hike day)
};
const FLOOR_Y = 457;
const TREE = { x: 220, y: 150 }; // the crown she looks up at
const SPEED = { walk: 70, sniff: 40, shuffle: 30, excited: 120 }; // px per second (sniffing moves in bursts; a shuffle is a few slow steps)
const SIZE = 1.1;
const LEAVE_MS = 6000; // she sets off this long before the visit ends
const CIRCLE_MS = 1800; // turning around once before she lies down
const OFFSTAGE_X = -70; // she comes in from (and leaves to) the left

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

// A scalloped tuft outline around an ellipse: the shaggy edge, irregular but stable (seeded)
function fluffPath(cx: number, cy: number, rx: number, ry: number, n: number, amp: number, seed: number): string {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + seed * 0.37;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  let d = `M ${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % n];
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    const k = 1 + amp * (0.7 + 0.6 * Math.abs(Math.sin(seed * 12.9898 + i * 78.233))); // each tuft its own size
    d += ` Q ${(cx + (mx - cx) * k).toFixed(2)},${(cy + (my - cy) * k).toFixed(2)} ${x1.toFixed(2)},${y1.toFixed(2)}`;
  }
  return `${d} Z`;
}

// One fluffy mass: an inked blue-grey outer shape, and the white fur lit from the top left inside it
const Fluff: React.FC<{ cx: number; cy: number; rx: number; ry: number; n?: number; amp?: number; seed?: number; rot?: number; shade?: string; ink?: boolean }> = ({ cx, cy, rx, ry, n = 11, amp = 0.22, seed = 1, rot = 0, shade = SHADE, ink = true }) => (
  <g transform={rot ? `rotate(${rot} ${cx} ${cy})` : undefined}>
    <path d={fluffPath(cx, cy, rx, ry, n, amp, seed)} fill={shade} stroke={ink ? INK : 'none'} strokeWidth="0.85" strokeLinejoin="round" />
    <path d={fluffPath(cx - rx * 0.07, cy - ry * 0.12, rx * 0.84, ry * 0.78, n, amp * 0.8, seed + 3)} fill={FUR} />
  </g>
);

// A few loose ink hairs (the card's scratchy strokes)
const Hairs: React.FC<{ d: string }> = ({ d }) => <path d={d} stroke={INK} strokeWidth="0.6" fill="none" strokeLinecap="round" opacity="0.7" />;

interface Face {
  turn: number; // -1 … 1: 0 = her face toward you; + = three-quarter toward the way she faces, - = away
  look: { x: number; y: number }; // pupils' offset
  closed: 'no' | 'sleep' | 'blink' | 'bliss'; // eyes: open, asleep, a blink, blissful (a scratch, a yawn)
  drowsy: boolean; // lying awake at night looking at you: heavy lids, slow blinks
  tongue: boolean;
  yawn: boolean;
  earsDown: boolean; // a storm: ears pressed back and low
  earFlick: boolean;
  sniffAir: boolean; // the nose working
}

// The head, centred at (0,0): the shaggy dome with its mop of top tufts, the long hanging ears, the big eyes,
// the big glossy nose and the small mouth. Turned, the features slide toward the side she looks to, the far
// eye narrows and the far ear slips behind the dome (a three-quarter view from the same parts).
const Head: React.FC<{ f: Face }> = ({ f }) => {
  const t = clamp(f.turn, -1, 1);
  const a = Math.abs(t);
  const sx = t * 4.6; // how far the face slides
  const farSide = t >= 0 ? 1 : -1;
  const ear = (side: 1 | -1) => {
    const far = a > 0.25 && side === farSide;
    return (
      <g key={side} className={f.earFlick && side === -farSide ? 'lucy-ear-twitch' : undefined} style={{ transformBox: 'fill-box', transformOrigin: '50% 10%' }}>
        <Fluff cx={side * 12.4 + t * (far ? -3.5 : 2.2)} cy={f.earsDown ? 5.5 : 3.6} rx={5.4} ry={f.earsDown ? 10 : 12.2} n={12} amp={0.34} seed={side === 1 ? 7 : 9} rot={side * (f.earsDown ? -20 : -6) - t * 6} shade={DEEP} />
        <Hairs d={`M ${side * 10.5 + t * 2},12.5 q ${side * 0.6},2.2 ${side * -0.4},3.6 M ${side * 13.6 + t * 2},12 q ${side * 1},1.8 ${side * 0.6},3.4`} />
      </g>
    );
  };
  const eyes = [-5.2, 5.2].map((ex) => {
    const far = Math.sign(ex) === farSide && a > 0.05;
    const k = far ? 1 - 0.38 * a : 1 + 0.05 * a; // the far eye narrows
    return { x: ex * (far ? 1 - 0.3 * a : 1) + sx, k };
  });
  const lx = f.look.x * 0.5;
  const ly = f.look.y * 0.5;
  return (
    <g>
      {a > 0.25 && ear(farSide as 1 | -1)}
      {/* The dome and its mop of tufts */}
      <Fluff cx={0} cy={0} rx={14} ry={12.8} n={15} amp={0.2} seed={2} />
      <Fluff cx={0.5 + t * 1.2} cy={-10.5} rx={9.5} ry={4.6} n={11} amp={0.42} seed={5} />
      <path d="M -5,-14 Q -7,-17.5 -9.4,-18.4 M -1,-14.6 Q -0.6,-18.4 1.4,-20 M 3.4,-14 Q 6,-16.8 8.6,-17 M 6.4,-12.4 Q 9.6,-13.6 11.4,-12.6" stroke={INK} strokeWidth="0.7" fill="none" strokeLinecap="round" transform={`translate(${t * 1.2} 0)`} />
      <Hairs d="M -10,-6 q -2,-1 -3.5,0.5 M 10,-6 q 2,-1 3.5,0.5 M -3,-7.5 q 0.5,-1.6 2,-2.4" />
      {/* Muzzle: a softer white mass, shaded under the chin; it leads the turn */}
      <ellipse cx={t * 5} cy="9.6" rx="7" ry="2.2" fill={SHADE} opacity="0.75" />
      <Fluff cx={t * 5.4} cy={5.6} rx={7.6 - a * 0.8} ry={5.6} n={10} amp={0.16} seed={4} ink={false} />
      {/* Eyes: big and dark with catch-lights, small inked brows; closed: soft arcs (asleep, a blink, bliss) */}
      {f.closed !== 'no' ? (
        <g stroke={INK} strokeWidth="0.95" fill="none" strokeLinecap="round">
          {eyes.map((e, i) =>
            f.closed === 'bliss' ? (
              <path key={i} d={`M ${e.x - 2.2 * e.k},0.4 Q ${e.x},-1.6 ${e.x + 2.2 * e.k},0.4`} />
            ) : (
              <path key={i} d={`M ${e.x - 2.2 * e.k},-0.4 Q ${e.x},1.5 ${e.x + 2.2 * e.k},-0.4`} />
            )
          )}
        </g>
      ) : (
        <g>
          {eyes.map((e, i) => (
            <g key={i}>
              <path d={`M ${e.x - 2.4 * e.k},-4.6 Q ${e.x},-6 ${e.x + 2.2 * e.k},-4.9`} stroke={INK} strokeWidth="0.7" fill="none" strokeLinecap="round" />
              <ellipse cx={e.x + lx * e.k} cy={-0.4 + ly} rx={2.45 * e.k} ry="2.75" fill={DARK} />
              <circle cx={e.x + lx * e.k + 0.75 * e.k} cy={-1.45 + ly} r="0.85" fill="#FFFFFF" />
              <circle cx={e.x + lx * e.k - 0.7 * e.k} cy={0.75 + ly} r="0.32" fill="#FFFFFF" opacity="0.8" />
              {f.drowsy && (
                <g className="lucy-slowblink" style={{ transformBox: 'fill-box', transformOrigin: '50% 0%' }}>
                  <path d={`M ${e.x - 2.9 * e.k},-3.6 L ${e.x + 2.9 * e.k},-3.6 L ${e.x + 2.9 * e.k},-0.9 Q ${e.x},0.2 ${e.x - 2.9 * e.k},-0.9 Z`} fill={FUR} />
                  <path d={`M ${e.x - 2.9 * e.k},-0.9 Q ${e.x},0.2 ${e.x + 2.9 * e.k},-0.9`} stroke={INK} strokeWidth="0.7" fill="none" strokeLinecap="round" />
                </g>
              )}
            </g>
          ))}
        </g>
      )}
      {/* The nose: big, glossy; it leads the turn, and works when she sniffs the air */}
      <g transform={`translate(${t * 7.4} 0)`}>
        <g className={f.sniffAir ? 'lucy-nose' : undefined} style={{ transformBox: 'fill-box', transformOrigin: '50% 50%' }}>
          <path d="M -3.8,3.4 Q 0,1.6 3.8,3.4 Q 3.9,6.4 0,7.2 Q -3.9,6.4 -3.8,3.4 Z" fill={DARK} />
          <ellipse cx="-1.2" cy="3.4" rx="1.3" ry="0.55" fill="#FFFFFF" opacity="0.75" />
        </g>
        {/* Mouth (a yawn, and the tongue when she pants) */}
        {f.yawn ? (
          <path d="M -2.6,8 Q 0,14.5 2.6,8 Q 0,9.2 -2.6,8 Z" fill="#B65F6A" stroke={INK} strokeWidth="0.7" />
        ) : (
          <path d="M 0,7.2 L 0,8.4 M -2.8,8.2 Q -1.4,9.6 0,8.4 Q 1.4,9.6 2.8,8.2" stroke={INK} strokeWidth="0.75" fill="none" strokeLinecap="round" />
        )}
        {f.tongue && !f.yawn && <path d="M -1.6,8.9 Q -1.8,12.6 0,12.8 Q 1.8,12.6 1.6,8.9 Z" fill="#E98B8F" stroke={INK} strokeWidth="0.6" className="lucy-pant" style={{ transformBox: 'fill-box', transformOrigin: '50% 0%' }} />}
      </g>
      {a > 0.25 ? ear((-farSide) as 1 | -1) : [ear(-1), ear(1)]}
    </g>
  );
};

// A leg: a shaggy column with a paw at the ground
const Leg: React.FC<{ x: number; top: number; far?: boolean; className?: string }> = ({ x, top, far, className }) => (
  <g className={className} style={{ transformBox: 'fill-box', transformOrigin: '50% 0%' }}>
    <Fluff cx={x} cy={top / 2} rx={4.6} ry={-top / 2 + 0.6} n={9} amp={0.3} seed={x} shade={far ? DEEP : SHADE} />
    <Fluff cx={x + 1.2} cy={-1.8} rx={4.6} ry={2.3} n={8} amp={0.16} seed={x + 2} shade={far ? DEEP : SHADE} />
    <Hairs d={`M ${x + 0.2},-0.6 v -1.6 M ${x + 2.4},-0.6 v -1.6`} />
  </g>
);

// A front leg lying forward, the paw at its end with a few toe lines
const Paw: React.FC<{ x: number; far?: boolean; className?: string }> = ({ x, far, className }) => (
  <g className={className} style={{ transformBox: 'fill-box', transformOrigin: '0% 50%' }}>
    <Fluff cx={x - 3} cy={-3.6} rx={7.5} ry={3.6} n={9} amp={0.3} seed={x} shade={far ? DEEP : SHADE} />
    <Fluff cx={x + 4.5} cy={-2.4} rx={4} ry={2.6} n={7} amp={0.14} seed={x + 1} shade={far ? DEEP : SHADE} />
    <Hairs d={`M ${x + 6.6},-3.4 l 1,1.4 M ${x + 7.2},-1.6 l 1,0.6`} />
  </g>
);

// The tail: a plume, wagging, or swaying lazily (it never quite stops while she is awake)
const Tail: React.FC<{ x: number; y: number; rot: number; wag: boolean; idle: boolean }> = ({ x, y, rot, wag, idle }) => (
  <g className={wag ? 'lucy-wag' : idle ? 'lucy-tail-idle' : undefined} style={{ transformBox: 'fill-box', transformOrigin: '80% 80%' }}>
    <Fluff cx={x} cy={y} rx={8} ry={5.6} n={9} amp={0.32} seed={11} rot={rot} />
  </g>
);

interface Pose {
  face: Face;
  pitch: number; // head pitch (deg): - chin up, + down
  tilt: boolean; // a head tilt (the card's signature pose)
  wag: boolean;
  tailIdle: boolean;
  breathMs: number;
  breathe: boolean;
  bounce: boolean; // excited by a visitor: a little bounce
  scratch: boolean; // a hind leg scratching behind the ear
  sigh: boolean;
  dream: boolean; // asleep: paws twitching
  shift: boolean; // standing: weight shifting from foot to foot
}

const bodyClass = (p: Pose, breath: string) => [p.breathe ? breath : '', p.bounce ? 'lucy-bounce' : '', p.sigh ? 'lucy-sigh' : '', p.shift ? 'lucy-shift' : ''].filter(Boolean).join(' ') || undefined;

// The head on its neck: pitch eases (CSS transition), a tilt plays on top
const HeadOn: React.FC<{ x: number; y: number; p: Pose; extraRot?: number; className?: string }> = ({ x, y, p, extraRot = 0, className }) => (
  <g transform={`translate(${x} ${y})`}>
    <g className="lucy-neck" style={{ transformBox: 'fill-box', transformOrigin: '50% 90%', transform: `rotate(${p.pitch + extraRot}deg)` }}>
      <g className={className ?? (p.tilt ? 'lucy-tilt' : undefined)} style={{ transformBox: 'fill-box', transformOrigin: '50% 90%' }}>
        <Head f={p.face} />
      </g>
    </g>
  </g>
);

function Sitting({ p }: { p: Pose }) {
  return (
    <g>
      <Tail x={-16} y={-24} rot={-35} wag={p.wag} idle={p.tailIdle} />
      <g className={bodyClass(p, 'lucy-breathe')} style={{ animationDuration: p.bounce || p.sigh ? undefined : `${p.breathMs}ms`, transformBox: 'fill-box', transformOrigin: '50% 100%' }}>
        <Fluff cx={-8} cy={-11} rx={13} ry={11} n={12} seed={3} />
        {!p.scratch && <Fluff cx={-1} cy={-2.2} rx={6.5} ry={2.6} n={7} amp={0.14} seed={5} />}
        <Fluff cx={3} cy={-22} rx={11} ry={15} n={13} seed={6} />
        <Hairs d="M -14,-6 q -2,1 -3,3 M 8,-28 q 2,1 3,3 M -2,-14 q 1,2 0,4" />
      </g>
      <Leg x={11.5} top={-17} far />
      <Leg x={5.5} top={-17} />
      {/* Scratching: the hind leg up behind the ear, going fast, her head leaning into it, eyes closed */}
      {p.scratch && (
        <g transform="translate(-7 -13) rotate(166)">
          <g className="lucy-scratch" style={{ transformBox: 'fill-box', transformOrigin: '50% 0%' }}>
            <Fluff cx={0} cy={11} rx={4.4} ry={11} n={9} amp={0.3} seed={41} />
            <Fluff cx={0.6} cy={21} rx={4.2} ry={2.4} n={7} amp={0.14} seed={42} />
          </g>
        </g>
      )}
      <HeadOn x={6} y={-40} p={p} extraRot={p.scratch ? -14 : 0} />
    </g>
  );
}

function Down({ p, chinOnPaws }: { p: Pose; chinOnPaws: boolean }) {
  return (
    <g>
      <Tail x={-30} y={-9} rot={-15} wag={p.wag} idle={p.tailIdle} />
      <g className={bodyClass(p, 'lucy-breathe-down')} style={{ animationDuration: p.bounce || p.sigh ? undefined : `${p.breathMs}ms`, transformBox: 'fill-box', transformOrigin: '50% 100%' }}>
        <Fluff cx={-19} cy={-10.5} rx={11} ry={9.5} n={11} seed={13} />
        <Fluff cx={-5} cy={-10} rx={22} ry={10} n={15} seed={14} />
        <Hairs d="M -18,-2 q -2,1 -3,2.5 M 2,-19 q 2,0 3,2 M -10,-17 q 1,-2 3,-2" />
      </g>
      <Paw x={14} far />
      <Paw x={19} />
      {chinOnPaws ? <HeadOn x={22} y={-15} p={{ ...p, pitch: Math.min(p.pitch, 0) }} extraRot={6} /> : <HeadOn x={15} y={-24} p={p} />}
    </g>
  );
}

function Sleeping({ p }: { p: Pose }) {
  return (
    <g>
      <g className={bodyClass(p, 'lucy-breathe-down')} style={{ animationDuration: p.sigh ? undefined : `${p.breathMs}ms`, transformBox: 'fill-box', transformOrigin: '50% 100%' }}>
        <Fluff cx={-12} cy={-13} rx={12} ry={10} n={11} seed={21} />
        <Fluff cx={0} cy={-10.5} rx={23} ry={10.5} n={16} seed={22} />
        <Hairs d="M -20,-6 q -2,1 -2.5,3 M -4,-20 q 2,-1 4,0 M 10,-18 q 2,0 3,2" />
      </g>
      {/* Dreaming: a front paw twitches */}
      <g className={p.dream ? 'lucy-dream' : undefined} style={{ transformBox: 'fill-box', transformOrigin: '0% 50%' }}>
        <Fluff cx={19} cy={-3} rx={5} ry={2.4} n={7} amp={0.16} seed={24} />
      </g>
      <g transform="translate(15 -11) rotate(-10) scale(0.95)">
        <Head f={p.face} />
      </g>
      {/* The tail wrapped round to her nose */}
      <Fluff cx={3} cy={-4.5} rx={12} ry={4.4} n={12} amp={0.5} seed={23} rot={-6} />
      <Hairs d="M -6,-2.2 q -2,0.6 -3,2 M 12,-3 q 2,0.4 3,1.8" />
      <text x="22" y="-30" fontSize="8" fill={INK} className="drey-zzz" fontFamily="serif">
        z
      </text>
    </g>
  );
}

function Walking({ p, moving, sniff }: { p: Pose; moving: boolean; sniff: boolean }) {
  const leg = (a: boolean) => (moving ? (a ? 'lucy-leg-a' : 'lucy-leg-b') : undefined);
  return (
    <g>
      <Tail x={-19} y={-31} rot={-50} wag={p.wag || moving} idle={p.tailIdle} />
      <Leg x={-12} top={-16} far className={leg(false)} />
      <Leg x={13} top={-16} far className={leg(true)} />
      <g className={bodyClass(p, 'lucy-breathe')} style={{ animationDuration: p.bounce ? undefined : `${p.breathMs}ms`, transformBox: 'fill-box', transformOrigin: '50% 100%' }}>
        <Fluff cx={0} cy={-21} rx={19} ry={10} n={15} seed={31} />
        <Hairs d="M -12,-13 q -1,2 -1,4 M 6,-13 q 1,2 0,4 M -4,-30 q 2,-1 4,0" />
      </g>
      <Leg x={-7} top={-16} className={leg(true)} />
      <Leg x={17} top={-16} className={leg(false)} />
      {/* Sniffing: the head low, nose to the floor ahead, bobbing; else up, looking */}
      {sniff ? <HeadOn x={25} y={-16} p={{ ...p, pitch: 26 }} className="lucy-sniff" /> : <HeadOn x={21} y={-33} p={p} />}
    </g>
  );
}

// Her pillow: always there, a dusty-rose cushion with a cream band (the card's striped towel), even when she
// is out. Drawn behind the stand.
export const LucyPillow: React.FC = () => (
  <g id="lucy-pillow" pointerEvents="none" aria-hidden>
    <ellipse cx="46" cy="455" rx="40" ry="4" fill="#000" opacity="0.1" />
    <path d="M 8,451 Q 6,441 16,440 L 76,440 Q 86,441 84,451 Q 82,455 76,455 L 16,455 Q 10,455 8,451 Z" fill="#C9756D" stroke={INK} strokeWidth="0.9" />
    <path d="M 12,444 Q 46,439 80,444 L 81,447.5 Q 46,442.5 11,447.5 Z" fill="#F4E8DC" opacity="0.95" />
    <path d="M 14,441.5 Q 46,437.5 78,441.5" stroke="#E7A49A" strokeWidth="1.4" fill="none" strokeLinecap="round" opacity="0.8" />
    <path d="M 8,451 l -3,1.6 M 84,451 l 3,1.6 M 9,442.5 l -3,-1.4 M 83,442.5 l 3,-1.4" stroke={INK} strokeWidth="0.8" strokeLinecap="round" />
  </g>
);

type Point = { x: number; y: number };
export type LucyTargets = Partial<Record<'squirrel' | 'dragonfly' | 'sloth', Point | null>>;
type Stop = LucyPresentation['route'][number];
type Gaze = 'user' | 'tree' | 'around' | 'visitor' | 'floor' | 'away';

// The stop her route has her at now
function stopAt(lucy: LucyPresentation, now: number): Stop {
  const act = lucy.pose === 'sleeping' ? 'sleep' : lucy.pose === 'down' ? 'down' : lucy.pose === 'sitting' ? 'sit' : 'stand';
  let cur: Stop = lucy.route[0] ?? { at: lucy.startedAt, spot: lucy.spot, act, look: 'user' };
  for (const x of lucy.route) if (x.at <= now) cur = x;
  return cur;
}

// Her body on the floor, moved on the clock toward where she should be: her route's spot, under a visitor
// that makes her curious, or off to the left at the end. Speed by what she does (sniffing: slow bursts, a
// pause to smell, on again). She turns around once before lying down.
function useLucyMotion(lucy: LucyPresentation | null, targets: LucyTargets, shuffle: { at: number; dx: number } | null) {
  const [, tick] = useState(0);
  const st = useRef<{ id: string; x: number; y: number; facing: 1 | -1; t: number; act: Stop['act'] | null; circleAt: number } | null>(null);
  const id = lucy?.id ?? null;
  useEffect(() => {
    if (!id || reducedMotion()) return;
    const t = setInterval(() => tick((n) => n + 1), 100);
    return () => clearInterval(t);
  }, [id]);
  if (!lucy) {
    st.current = null;
    return null;
  }
  const now = Date.now();
  const still = reducedMotion();
  const stop = stopAt(lucy, now);
  const awake = stop.act !== 'sleep';
  const it = lucy.interest ?? null;
  const target = it ? targets[it.who] ?? null : null;
  const leaving = now >= lucy.endsAt - LEAVE_MS;
  const follow = !!(it && target && awake && !leaving && (it.level === 'curious' || it.level === 'excited'));
  // A shuffle (her small life): a few steps aside within the same stop, then she settles again
  const nudge = shuffle && shuffle.at === stop.at && stop.spot !== 'pillow' ? shuffle.dx : 0;
  const goal: Point = leaving ? { x: OFFSTAGE_X, y: FLOOR_Y } : follow ? { x: clamp(target!.x, 30, 400), y: FLOOR_Y } : { x: SPOT[stop.spot].x + nudge, y: SPOT[stop.spot].y };
  if (st.current?.id !== lucy.id) {
    // She walks in from the left if the page sees her arrive; otherwise she is already where she should be
    const entering = !still && now < lucy.startedAt + 90_000;
    st.current = { id: lucy.id, x: entering ? OFFSTAGE_X : goal.x, y: entering ? FLOOR_Y : goal.y, facing: 1, t: now, act: entering ? null : stop.act, circleAt: 0 };
  }
  const s = st.current;
  const dt = Math.min(0.5, Math.max(0, (now - s.t) / 1000));
  s.t = now;
  const dx = goal.x - s.x;
  const moving = !still && Math.abs(dx) > 0.5;
  if (still) {
    s.x = goal.x;
    s.y = goal.y;
  } else if (moving) {
    // Sniffing goes in bursts: a few steps, a pause with the nose down, on again
    const burst = Math.floor(now / 650) % 3 !== 2;
    const speed = follow && it!.level === 'excited' ? SPEED.excited : stop.act === 'sniff' && !follow ? (burst ? SPEED.sniff : 0) : Math.abs(dx) < 30 && !follow && !leaving ? SPEED.shuffle : SPEED.walk;
    s.x += Math.sign(dx) * Math.min(Math.abs(dx), speed * dt);
    s.facing = dx > 0 ? 1 : -1;
  }
  // On the floor while walking; up onto the cushion once there
  const yGoal = moving ? FLOOR_Y : goal.y;
  s.y += Math.sign(yGoal - s.y) * Math.min(Math.abs(yGoal - s.y), still ? 99 : 30 * dt);
  // Lying down: a turn around first, as dogs do
  if (!moving && !still && s.act !== stop.act) {
    if ((stop.act === 'down' || stop.act === 'sleep') && s.act !== 'down' && s.act !== 'sleep' && s.act !== null) s.circleAt = now;
    s.act = stop.act;
  }
  if (moving && s.act === null) s.act = stop.act;
  const circling = !moving && now - s.circleAt < CIRCLE_MS;
  // A glance now and then; watching, curious and excited: her eyes stay on it
  const onVisitor = !!(it && target && awake && (it.level !== 'glance' || now % 14_000 < 3_500));
  let facing = s.facing;
  if (circling) facing = (Math.floor((now - s.circleAt) / (CIRCLE_MS / 3)) % 2 ? -s.facing : s.facing) as 1 | -1;
  else if (!moving) {
    // Facing what she watches: a visitor she follows or watches, else the tree
    const toward = onVisitor ? target!.x : TREE.x;
    if (Math.abs(toward - s.x) > 4) s.facing = toward > s.x ? 1 : -1;
    facing = s.facing;
  }
  return { x: s.x, y: s.y, facing, moving, circling, stop, follow, onVisitor, target, gone: leaving && Math.abs(s.x - OFFSTAGE_X) < 1 };
}

interface Life {
  gaze: Gaze | null; // a glance away from what her route has her watching (null: back to it)
  blink: boolean;
  ear: boolean;
  tilt: boolean;
  sniffAir: boolean;
  yawn: boolean;
  scratch: boolean;
  sigh: boolean;
  dream: boolean;
  shuffle: { at: number; dx: number } | null; // a few steps aside, for the stop that began at `at`
}
const QUIET: Life = { gaze: null, blink: false, ear: false, tilt: false, sniffAir: false, yawn: false, scratch: false, sigh: false, dream: false, shuffle: null };
type LifeMode = 'sitting' | 'standing' | 'down' | 'asleep' | 'moving';

// Her small life between the big moves (UI only, random, never stored): one little thing every second or
// two. Glances drift from what she watches to the tree, a visitor, you, the floor, across the room; blinks;
// ear flicks; head tilts; sniffing the air; a yawn; now and then a scratch; a sigh lying down. Asleep: dream
// twitches, an ear, a sigh.
function useLucyLife(id: string | null, mode: LifeMode, hasVisitor: boolean, stopAt: number): Life {
  const ctx = useRef({ mode, hasVisitor, stopAt });
  ctx.current = { mode, hasVisitor, stopAt };
  const [life, setLife] = useState<Life>(QUIET);
  useEffect(() => {
    setLife(QUIET);
    if (!id || reducedMotion()) return;
    let alive = true;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (ms: number, f: () => void) => timers.push(setTimeout(() => alive && f(), ms));
    const pulse = (key: Exclude<keyof Life, 'gaze' | 'shuffle'>, ms: number) => {
      setLife((l) => ({ ...l, [key]: true }));
      later(ms, () => setLife((l) => ({ ...l, [key]: false })));
    };
    const pick = <T,>(opts: [T, number][]): T => {
      let r = Math.random() * opts.reduce((a, [, w]) => a + w, 0);
      for (const [v, w] of opts) if ((r -= w) < 0) return v;
      return opts[0][0];
    };
    // Blinks: every few seconds, sometimes twice
    const blink = () => {
      if (ctx.current.mode !== 'asleep') {
        pulse('blink', 150);
        if (Math.random() < 0.2) later(330, () => pulse('blink', 140));
      }
      later(2400 + Math.random() * 4200, blink);
    };
    later(900 + Math.random() * 1500, blink);
    // One small thing at a time
    const next = () => {
      const c = ctx.current;
      if (c.mode === 'asleep') {
        const what = pick<'ear' | 'dream' | 'sigh' | 'none'>([['ear', 1], ['dream', 1.3], ['sigh', 1], ['none', 1.5]]);
        if (what === 'ear') pulse('ear', 800);
        else if (what === 'dream') pulse('dream', 1600);
        else if (what === 'sigh') pulse('sigh', 2600);
        later(3500 + Math.random() * 6000, next);
        return;
      }
      if (c.mode === 'moving') {
        later(1200, next);
        return;
      }
      const what = pick<keyof Life | 'back'>([
        ['gaze', 6],
        ['back', 2.5],
        ['ear', 1.3],
        ['tilt', 0.9],
        ['sniffAir', c.mode === 'down' ? 0.4 : 1.1],
        ['yawn', 0.6],
        ['scratch', c.mode === 'sitting' ? 1.2 : 0],
        ['shuffle', c.mode === 'sitting' || c.mode === 'standing' ? 0.9 : 0],
        ['sigh', c.mode === 'down' ? 0.9 : 0],
      ]);
      let wait = 900 + Math.random() * 2200;
      if (what === 'gaze') {
        const g = pick<Gaze>([['tree', 2.2], ['user', 1.6], ['around', 1.4], ['floor', c.mode === 'down' ? 1.4 : 0.9], ['away', 1.1], ['visitor', c.hasVisitor ? 3 : 0]]);
        setLife((l) => ({ ...l, gaze: g }));
        wait += g === 'around' ? 2500 : 1200; // a look lasts a moment
      } else if (what === 'back') setLife((l) => ({ ...l, gaze: null }));
      else if (what === 'shuffle') {
        const dx = (Math.random() < 0.5 ? -1 : 1) * (8 + Math.random() * 12);
        setLife((l) => ({ ...l, shuffle: { at: c.stopAt, dx: clamp((l.shuffle?.at === c.stopAt ? l.shuffle.dx : 0) + dx, -28, 28) } }));
        wait += 1500;
      }
      else if (what === 'scratch') {
        setLife((l) => ({ ...l, gaze: null }));
        pulse('scratch', 2600);
        wait += 2600;
      } else if (what === 'yawn') {
        pulse('yawn', 1700);
        wait += 1700;
      } else pulse(what as Exclude<keyof Life, 'gaze' | 'shuffle'>, what === 'sigh' ? 2600 : what === 'tilt' ? 1500 : what === 'sniffAir' ? 1400 : 700);
      later(wait, next);
    };
    later(600 + Math.random() * 1200, next);
    return () => {
      alive = false;
      timers.forEach(clearTimeout);
    };
  }, [id]);
  return life;
}

// Where her head turns, its pitch and her pupils for a gaze (her own coordinates: + is the way she faces)
function aim(g: Gaze | 'ahead' | 'sniff', o: { x: number; facing: 1 | -1; target: Point | null; now: number }) {
  const side = (px: number) => (Math.sign((px - o.x) * o.facing) || 1) as 1 | -1;
  switch (g) {
    case 'sniff':
      return { turn: 0.85, pitch: 0, look: { x: 1.2, y: 2 } };
    case 'ahead':
      return { turn: 0.7, pitch: 2, look: { x: 1.5, y: 0.4 } };
    case 'tree': {
      const s = side(TREE.x);
      const near = Math.abs(TREE.x - o.x) < 50; // right under it: straight up
      return { turn: s * (near ? 0.3 : 0.65), pitch: near ? -24 : -16, look: { x: s * 1.3, y: -2 } };
    }
    case 'visitor': {
      const t = o.target ?? TREE;
      const s = side(t.x);
      return { turn: s * 0.6, pitch: -22, look: { x: s * 1.4, y: -2 } };
    }
    case 'around': {
      const sweep = Math.sin(o.now / 1100);
      return { turn: sweep * 0.85, pitch: -4, look: { x: sweep * 1.6, y: -0.3 } };
    }
    case 'floor':
      return { turn: 0.55, pitch: 12, look: { x: 0.8, y: 1.8 } };
    case 'away':
      return { turn: -0.75, pitch: -3, look: { x: -1.4, y: 0 } };
    case 'user':
    default:
      return { turn: 0, pitch: 0, look: { x: 0, y: 0.3 } };
  }
}

export const Lucy: React.FC<{ lucy: LucyPresentation | null; targets?: LucyTargets }> = ({ lucy, targets = {} }) => {
  const shuffle = useRef<Life['shuffle']>(null);
  const m = useLucyMotion(lucy, targets, shuffle.current);
  const [react, setReact] = useState<{ kind: 'tilt' | 'thump' | 'twitch'; at: number } | null>(null);
  const travel = useRef<{ x: number; y: number; d: number } | null>(null);
  const head = useRef({ turn: 0, pitch: 0, lx: 0, ly: 0 });
  useEffect(() => {
    if (!react) return;
    const t = setTimeout(() => setReact(null), 2400);
    return () => clearTimeout(t);
  }, [react]);
  useEffect(() => setReact(null), [lucy?.id]);

  const stop = m?.stop;
  // What she is doing right now: walking while she moves (or turns around); sitting under a visitor she
  // follows; else her stop
  const pose: 'walking' | 'sitting' | 'down' | 'sleeping' =
    !m || !stop ? 'sitting' : m.moving || m.circling ? 'walking' : m.follow ? 'sitting' : stop.act === 'sit' ? 'sitting' : stop.act === 'down' ? 'down' : stop.act === 'sleep' ? 'sleeping' : 'walking';
  const mode: LifeMode = !m ? 'standing' : m.moving || m.circling ? 'moving' : pose === 'sleeping' ? 'asleep' : pose === 'down' ? 'down' : pose === 'sitting' ? 'sitting' : 'standing';
  const it = lucy?.interest ?? null;
  const life = useLucyLife(lucy?.id ?? null, mode, !!(it && m?.target), stop?.at ?? 0);
  shuffle.current = life.shuffle;

  if (!lucy || !m || !stop || m.gone) return null;
  const asleep = pose === 'sleeping';
  const sniffing = pose === 'walking' && stop.act === 'sniff' && !m.follow && !m.circling;
  const still = reducedMotion();

  // Petting (UI only): a stroke across her, or a tap, gets one answer at a time
  const answer = () => {
    if (still) return;
    if (react && Date.now() - react.at < APP_CONFIG.habitat.lucy.petCooldownMs) return;
    setReact({ kind: asleep ? 'twitch' : pose === 'down' ? 'thump' : 'tilt', at: Date.now() });
  };
  const onMove = (e: React.PointerEvent) => {
    e.stopPropagation(); // she is not the tree's leaves
    const t = travel.current;
    if (!t) {
      travel.current = { x: e.clientX, y: e.clientY, d: 0 };
      return;
    }
    t.d += Math.hypot(e.clientX - t.x, e.clientY - t.y);
    t.x = e.clientX;
    t.y = e.clientY;
    if (t.d > 40) {
      travel.current = null;
      answer();
    }
  };

  // Where she looks: a visitor that holds her (watching, curious, excited); else her own small glances, else
  // what her stop has her watching. Walking she looks ahead, sniffing at the floor where she sniffs.
  const base: Gaze = stop.look === 'around' ? 'around' : stop.look === 'tree' ? 'tree' : 'user';
  const gaze: Gaze | 'ahead' | 'sniff' = sniffing
    ? 'sniff'
    : m.moving || m.circling
    ? 'ahead'
    : m.onVisitor && it && it.level !== 'glance'
    ? 'visitor'
    : life.gaze === 'visitor' && !m.target
    ? base
    : life.gaze ?? (m.onVisitor ? 'visitor' : base);
  const want = still ? aim(gaze === 'around' ? 'user' : gaze, { x: m.x, facing: m.facing, target: m.target, now: Date.now() }) : aim(gaze, { x: m.x, facing: m.facing, target: m.target, now: Date.now() });
  // The head eases toward where she looks (no snapping), a little each frame
  const h = head.current;
  const k = still ? 1 : 0.28;
  h.turn += (want.turn - h.turn) * k;
  h.pitch += (want.pitch - h.pitch) * k;
  h.lx += (want.look.x - h.lx) * k;
  h.ly += (want.look.y - h.ly) * k;

  const excited = m.onVisitor && it?.level === 'excited';
  const breath = pose === 'sleeping' ? lucy.breath.asleep : pose === 'down' ? lucy.breath.down : lucy.breath.up;
  const lookingAtYou = Math.abs(h.turn) < 0.2 && h.pitch > -6;
  const p: Pose = {
    face: {
      turn: asleep ? 0.35 : h.turn,
      look: { x: h.lx, y: h.ly },
      closed: asleep ? 'sleep' : life.scratch || life.yawn ? 'bliss' : life.blink ? 'blink' : 'no',
      drowsy: lucy.night && pose === 'down' && lookingAtYou,
      tongue: (lucy.cue === 'panting' || excited) && !asleep,
      yawn: life.yawn && !asleep,
      earsDown: lucy.cue === 'storm',
      earFlick: life.ear || react?.kind === 'twitch',
      sniffAir: life.sniffAir || sniffing,
    },
    pitch: life.sniffAir && !sniffing ? h.pitch - 6 : h.pitch,
    tilt: react?.kind === 'tilt' || life.tilt || (m.onVisitor && !m.moving && (it?.level === 'curious' || it?.level === 'excited')),
    wag: react?.kind === 'thump' || react?.kind === 'tilt' || excited || (m.follow && !m.moving),
    tailIdle: !asleep && !still,
    breathMs: breath,
    breathe: !still,
    bounce: excited && !m.moving && !still,
    scratch: life.scratch && pose === 'sitting',
    sigh: life.sigh && (pose === 'down' || asleep),
    dream: life.dream && asleep,
    shift: pose === 'walking' && !m.moving && !m.circling && !sniffing && !still,
  };
  const shaking = lucy.cue === 'shake_off' && !m.moving; // just in from the rain: a good shake now and then
  return (
    <g
      transform={`translate(${m.x.toFixed(1)} ${m.y.toFixed(1)}) scale(${SIZE * m.facing} ${SIZE})`}
      onPointerMove={onMove}
      onPointerLeave={() => (travel.current = null)}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation(); // a tap on Lucy is not a tap on the tree
        answer();
      }}
      style={{ cursor: 'grab' }}
      aria-label="Lucy"
    >
      <title>Lucy</title>
      <ellipse cx="0" cy="0.5" rx={pose === 'sitting' ? 17 : 27} ry="2.6" fill="#000" opacity="0.09" />
      <g key={lucy.id} className={`lucy-in${shaking ? ' lucy-shake' : ''}`} style={{ transformBox: 'fill-box', transformOrigin: '50% 100%' }}>
        {pose === 'walking' ? (
          <Walking p={p} moving={m.moving || m.circling} sniff={sniffing} />
        ) : pose === 'sitting' ? (
          <Sitting p={p} />
        ) : pose === 'down' ? (
          <Down p={p} chinOnPaws={lucy.cue === 'concern' || lucy.cue === 'tired' || (lucy.night && lookingAtYou) || gaze === 'floor'} />
        ) : (
          <Sleeping p={p} />
        )}
      </g>
    </g>
  );
};

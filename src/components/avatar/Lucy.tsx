import React, { useEffect, useRef, useState } from 'react';
import { APP_CONFIG } from '../../config/appConfig';
import type { LucyPresentation } from '../../expression/expressionTypes';

// Lucy (expression.lucy): the household's Coton de Tuléar on the floor around the pot. Plays the route
// upstream planned, on the clock: she walks in, sniffs along the floor, sits in different places looking at
// you, up at the tree or around, settles down, dozes, and walks out. A visitor in the tree gets a glance, her
// watching it, or (curious, excited) she walks under it and sits looking up. Evidence class "art". Her look follows the hand-inked card style: white shaggy fur outlined in a
// soft navy ink, blue-grey shading instead of grey, big dark eyes with catch-lights and a large glossy nose.
//
// Local behaviour (UI only, never stored, never brings more visits):
// - she walks between her stops at a dog's pace (slowly, nose down, when sniffing), facing where she goes or
//   what she looks at; in from the left when a visit begins and out again as it ends;
// - she breathes at `breathMs` (about six breaths a minute when down or asleep: a pace to breathe along with);
// - a stroke or a tap: a head tilt (sitting, walking), a tail thump and a look up (down), only an ear twitch
//   asleep: she is never woken. Reduced motion: no walking, no breathing, no reactions; she is just there.

const FUR = '#FDFBF7';
const SHADE = '#C9D5EC'; // the blue-grey shading of the card style
const DEEP = '#A7B6D6';
const INK = '#4A5470'; // soft navy ink, never black
const DARK = '#191A20'; // eyes and nose

// Where she is drawn for each spot (avatar coordinates of the ground under her), and how large
const SPOT: Record<LucyPresentation['spot'], { x: number; y: number }> = {
  pillow: { x: 46, y: 446 }, // on her cushion, left of the stand
  floor_left: { x: 84, y: 456 }, // the cool floor beside her pillow
  by_pot: { x: 140, y: 457 }, // by the stand's left leg, close to the tree
  pot_front: { x: 206, y: 458 }, // in front of the pot
  pot_right: { x: 274, y: 458 },
  floor_right: { x: 362, y: 457 }, // right of the stand (where the boots stand on hike day)
};
const FLOOR_Y = 457;
const TREE_X = 220;
const SPEED = { walk: 70, sniff: 24, excited: 120 }; // px per second
const SIZE = 1.1;
const LEAVE_MS = 6000; // she sets off this long before the visit ends
const OFFSTAGE_X = -70; // she comes in from (and leaves to) the left

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

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
  asleep: boolean;
  look: { x: number; y: number }; // pupils' offset
  tongue: boolean;
  earsDown: boolean; // a storm: ears pressed back and low
  twitch: boolean; // an ear twitch (a stroke while asleep)
  drowsy: boolean; // lying awake at night looking at you: heavy lids, slow blinks
}

// The head, centred at (0,0), seen from the front: the shaggy dome with its top tufts, the long hanging ears
// over its sides, the big eyes, the big glossy nose and the small mouth.
const Head: React.FC<{ f: Face }> = ({ f }) => {
  const ear = (side: 1 | -1) => (
    <g className={f.twitch && side === 1 ? 'lucy-ear-twitch' : undefined} style={{ transformBox: 'fill-box', transformOrigin: '50% 10%' }}>
      <Fluff cx={side * 12.4} cy={f.earsDown ? 5.5 : 3.6} rx={5.4} ry={f.earsDown ? 10 : 12.2} n={12} amp={0.34} seed={side === 1 ? 7 : 9} rot={side * (f.earsDown ? -20 : -6)} shade={DEEP} />
      <Hairs d={`M ${side * 10.5},12.5 q ${side * 0.6},2.2 ${side * -0.4},3.6 M ${side * 13.6},12 q ${side * 1},1.8 ${side * 0.6},3.4`} />
    </g>
  );
  return (
    <g>
      {/* The dome and the top tufts (the card's spiky crown) */}
      <Fluff cx={0} cy={0} rx={14} ry={12.8} n={15} amp={0.2} seed={2} />
      <Fluff cx={0.5} cy={-10.5} rx={9.5} ry={4.6} n={11} amp={0.42} seed={5} />
      <path d="M -5,-14 Q -7,-17.5 -9.4,-18.4 M -1,-14.6 Q -0.6,-18.4 1.4,-20 M 3.4,-14 Q 6,-16.8 8.6,-17 M 6.4,-12.4 Q 9.6,-13.6 11.4,-12.6" stroke={INK} strokeWidth="0.7" fill="none" strokeLinecap="round" />
      <Hairs d="M -10,-6 q -2,-1 -3.5,0.5 M 10,-6 q 2,-1 3.5,0.5 M -3,-7.5 q 0.5,-1.6 2,-2.4" />
      {/* Muzzle: a softer white mass, shaded under the chin */}
      <ellipse cx="0" cy="9.6" rx="7" ry="2.2" fill={SHADE} opacity="0.75" />
      <Fluff cx={0} cy={5.6} rx={7.6} ry={5.6} n={10} amp={0.16} seed={4} ink={false} />
      {/* Eyes: big and dark with catch-lights, small inked brows; asleep: soft closed arcs */}
      {f.asleep ? (
        <g stroke={INK} strokeWidth="0.95" fill="none" strokeLinecap="round">
          <path d="M -7.4,-0.4 Q -5.2,1.5 -3,-0.4" />
          <path d="M 3,-0.4 Q 5.2,1.5 7.4,-0.4" />
        </g>
      ) : (
        <g>
          {[-5.2, 5.2].map((ex) => (
            <g key={ex}>
              <path d={`M ${ex - 2.4},-4.6 Q ${ex},-6 ${ex + 2.2},-4.9`} stroke={INK} strokeWidth="0.7" fill="none" strokeLinecap="round" />
              <ellipse cx={ex + f.look.x * 0.5} cy={-0.4 + f.look.y * 0.5} rx="2.45" ry="2.75" fill={DARK} />
              <circle cx={ex + f.look.x * 0.5 + 0.75} cy={-1.45 + f.look.y * 0.5} r="0.85" fill="#FFFFFF" />
              <circle cx={ex + f.look.x * 0.5 - 0.7} cy={0.75 + f.look.y * 0.5} r="0.32" fill="#FFFFFF" opacity="0.8" />
              {f.drowsy && (
                <g className="lucy-slowblink" style={{ transformBox: 'fill-box', transformOrigin: '50% 0%' }}>
                  <path d={`M ${ex - 2.9},-3.6 L ${ex + 2.9},-3.6 L ${ex + 2.9},-0.9 Q ${ex},0.2 ${ex - 2.9},-0.9 Z`} fill={FUR} />
                  <path d={`M ${ex - 2.9},-0.9 Q ${ex},0.2 ${ex + 2.9},-0.9`} stroke={INK} strokeWidth="0.7" fill="none" strokeLinecap="round" />
                </g>
              )}
            </g>
          ))}
        </g>
      )}
      {/* The nose: big, glossy */}
      <path d="M -3.8,3.4 Q 0,1.6 3.8,3.4 Q 3.9,6.4 0,7.2 Q -3.9,6.4 -3.8,3.4 Z" fill={DARK} />
      <ellipse cx="-1.2" cy="3.4" rx="1.3" ry="0.55" fill="#FFFFFF" opacity="0.75" />
      {/* Mouth (and the tongue when she pants) */}
      <path d="M 0,7.2 L 0,8.4 M -2.8,8.2 Q -1.4,9.6 0,8.4 Q 1.4,9.6 2.8,8.2" stroke={INK} strokeWidth="0.75" fill="none" strokeLinecap="round" />
      {f.tongue && <path d="M -1.6,8.9 Q -1.8,12.6 0,12.8 Q 1.8,12.6 1.6,8.9 Z" fill="#E98B8F" stroke={INK} strokeWidth="0.6" className="lucy-pant" style={{ transformBox: 'fill-box', transformOrigin: '50% 0%' }} />}
      {ear(-1)}
      {ear(1)}
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
const Paw: React.FC<{ x: number; far?: boolean }> = ({ x, far }) => (
  <g>
    <Fluff cx={x - 3} cy={-3.6} rx={7.5} ry={3.6} n={9} amp={0.3} seed={x} shade={far ? DEEP : SHADE} />
    <Fluff cx={x + 4.5} cy={-2.4} rx={4} ry={2.6} n={7} amp={0.14} seed={x + 1} shade={far ? DEEP : SHADE} />
    <Hairs d={`M ${x + 6.6},-3.4 l 1,1.4 M ${x + 7.2},-1.6 l 1,0.6`} />
  </g>
);

// The tail: a plume
const Tail: React.FC<{ x: number; y: number; rot: number; wag: boolean }> = ({ x, y, rot, wag }) => (
  <g className={wag ? 'lucy-wag' : undefined} style={{ transformBox: 'fill-box', transformOrigin: '80% 80%' }}>
    <Fluff cx={x} cy={y} rx={8} ry={5.6} n={9} amp={0.32} seed={11} rot={rot} />
  </g>
);

interface Pose {
  face: Face;
  tilt: boolean; // a head tilt (the card's signature pose)
  wag: boolean;
  breathMs: number;
  breathe: boolean;
  lookUp: boolean; // chin up toward the tree, or a visitor
  lookAround: boolean; // the head sweeping slowly, taking in the room
  bounce: boolean; // excited by a visitor: a little bounce
}
const headClass = (p: Pose) => (p.tilt ? 'lucy-tilt' : p.lookAround ? 'lucy-look-around' : undefined);

function Sitting({ p }: { p: Pose }) {
  return (
    <g>
      <Tail x={-16} y={-24} rot={-35} wag={p.wag} />
      <g className={[p.breathe ? 'lucy-breathe' : '', p.bounce ? 'lucy-bounce' : ''].filter(Boolean).join(' ') || undefined} style={{ animationDuration: p.bounce ? undefined : `${p.breathMs}ms`, transformBox: 'fill-box', transformOrigin: '50% 100%' }}>
        <Fluff cx={-8} cy={-11} rx={13} ry={11} n={12} seed={3} />
        <Fluff cx={-1} cy={-2.2} rx={6.5} ry={2.6} n={7} amp={0.14} seed={5} />
        <Fluff cx={3} cy={-22} rx={11} ry={15} n={13} seed={6} />
        <Hairs d="M -14,-6 q -2,1 -3,3 M 8,-28 q 2,1 3,3 M -2,-14 q 1,2 0,4" />
      </g>
      <Leg x={11.5} top={-17} far />
      <Leg x={5.5} top={-17} />
      <g transform="translate(6 -40)">
        <g className={headClass(p)} style={{ transformBox: 'fill-box', transformOrigin: '50% 90%', transform: p.lookUp ? 'rotate(-10deg)' : undefined }}>
          <Head f={p.face} />
        </g>
      </g>
    </g>
  );
}

function Down({ p, chinOnPaws }: { p: Pose; chinOnPaws: boolean }) {
  return (
    <g>
      <Tail x={-30} y={-9} rot={-15} wag={p.wag} />
      <g className={p.breathe ? 'lucy-breathe-down' : undefined} style={{ animationDuration: `${p.breathMs}ms`, transformBox: 'fill-box', transformOrigin: '50% 100%' }}>
        <Fluff cx={-19} cy={-10.5} rx={11} ry={9.5} n={11} seed={13} />
        <Fluff cx={-5} cy={-10} rx={22} ry={10} n={15} seed={14} />
        <Hairs d="M -18,-2 q -2,1 -3,2.5 M 2,-19 q 2,0 3,2 M -10,-17 q 1,-2 3,-2" />
      </g>
      <Paw x={14} far />
      <Paw x={19} />
      <g transform={chinOnPaws ? 'translate(22 -15) rotate(6)' : 'translate(15 -24)'}>
        <g className={headClass(p)} style={{ transformBox: 'fill-box', transformOrigin: '50% 90%', transform: p.lookUp ? 'rotate(-8deg)' : undefined }}>
          <Head f={p.face} />
        </g>
      </g>
    </g>
  );
}

function Sleeping({ p }: { p: Pose }) {
  return (
    <g>
      <g className={p.breathe ? 'lucy-breathe-down' : undefined} style={{ animationDuration: `${p.breathMs}ms`, transformBox: 'fill-box', transformOrigin: '50% 100%' }}>
        <Fluff cx={-12} cy={-13} rx={12} ry={10} n={11} seed={21} />
        <Fluff cx={0} cy={-10.5} rx={23} ry={10.5} n={16} seed={22} />
        <Hairs d="M -20,-6 q -2,1 -2.5,3 M -4,-20 q 2,-1 4,0 M 10,-18 q 2,0 3,2" />
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
      <Tail x={-19} y={-31} rot={-50} wag />
      <Leg x={-12} top={-16} far className={leg(false)} />
      <Leg x={13} top={-16} far className={leg(true)} />
      <g className={[p.breathe ? 'lucy-breathe' : '', p.bounce ? 'lucy-bounce' : ''].filter(Boolean).join(' ') || undefined} style={{ animationDuration: p.bounce ? undefined : `${p.breathMs}ms`, transformBox: 'fill-box', transformOrigin: '50% 100%' }}>
        <Fluff cx={0} cy={-21} rx={19} ry={10} n={15} seed={31} />
        <Hairs d="M -12,-13 q -1,2 -1,4 M 6,-13 q 1,2 0,4 M -4,-30 q 2,-1 4,0" />
      </g>
      <Leg x={-7} top={-16} className={leg(true)} />
      <Leg x={17} top={-16} className={leg(false)} />
      {/* Sniffing: the head low, nose to the floor, bobbing; else up, looking */}
      <g transform={sniff ? 'translate(25 -16) rotate(26)' : 'translate(21 -33)'}>
        <g className={sniff ? 'lucy-sniff' : headClass(p)} style={{ transformBox: 'fill-box', transformOrigin: '50% 90%', transform: !sniff && p.lookUp ? 'rotate(-10deg)' : undefined }}>
          <Head f={p.face} />
        </g>
      </g>
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

// The stop her route has her at now
function stopAt(lucy: LucyPresentation, now: number): Stop {
  const act = lucy.pose === 'sleeping' ? 'sleep' : lucy.pose === 'down' ? 'down' : lucy.pose === 'sitting' ? 'sit' : 'stand';
  let cur: Stop = lucy.route[0] ?? { at: lucy.startedAt, spot: lucy.spot, act, look: 'user' };
  for (const x of lucy.route) if (x.at <= now) cur = x;
  return cur;
}

// Her body on the floor, moved on the clock toward where she should be: her route's spot, under a visitor
// that makes her curious, or off to the left at the end. Speed by what she does (sniffing is slow).
function useLucyMotion(lucy: LucyPresentation | null, targets: LucyTargets) {
  const [, tick] = useState(0);
  const st = useRef<{ id: string; x: number; y: number; facing: 1 | -1; t: number } | null>(null);
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
  const goal: Point = leaving ? { x: OFFSTAGE_X, y: FLOOR_Y } : follow ? { x: Math.max(30, Math.min(400, target!.x)), y: FLOOR_Y } : SPOT[stop.spot];
  if (st.current?.id !== lucy.id) {
    // She walks in from the left if the page sees her arrive; otherwise she is already where she should be
    const entering = !still && now < lucy.startedAt + 90_000;
    st.current = { id: lucy.id, x: entering ? OFFSTAGE_X : goal.x, y: entering ? FLOOR_Y : goal.y, facing: 1, t: now };
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
    const speed = follow && it!.level === 'excited' ? SPEED.excited : stop.act === 'sniff' && !follow ? SPEED.sniff : SPEED.walk;
    s.x += Math.sign(dx) * Math.min(Math.abs(dx), speed * dt);
    s.facing = dx > 0 ? 1 : -1;
  }
  // On the floor while walking; up onto the cushion once there
  const yGoal = moving ? FLOOR_Y : goal.y;
  s.y += Math.sign(yGoal - s.y) * Math.min(Math.abs(yGoal - s.y), still ? 99 : 30 * dt);
  // A glance now and then; watching, curious and excited: her eyes stay on it
  const onVisitor = !!(it && target && awake && (it.level !== 'glance' || now % 14_000 < 3_500));
  if (!moving) {
    // Facing what she looks at: a visitor, else the tree
    const toward = onVisitor ? target!.x : TREE_X;
    if (Math.abs(toward - s.x) > 4) s.facing = toward > s.x ? 1 : -1;
  }
  return { x: s.x, y: s.y, facing: s.facing, moving, stop, follow, onVisitor, target, gone: leaving && Math.abs(s.x - OFFSTAGE_X) < 1 };
}

export const Lucy: React.FC<{ lucy: LucyPresentation | null; targets?: LucyTargets }> = ({ lucy, targets = {} }) => {
  const m = useLucyMotion(lucy, targets);
  const [react, setReact] = useState<{ kind: 'tilt' | 'thump' | 'twitch'; at: number } | null>(null);
  const travel = useRef<{ x: number; y: number; d: number } | null>(null);
  useEffect(() => {
    if (!react) return;
    const t = setTimeout(() => setReact(null), 2400);
    return () => clearTimeout(t);
  }, [react]);
  useEffect(() => setReact(null), [lucy?.id]);

  if (!lucy || !m || m.gone) return null;
  const { stop } = m;
  const it = lucy.interest ?? null;
  // What she is doing right now: walking while she moves; sitting under a visitor she follows; else her stop
  const pose: 'walking' | 'sitting' | 'down' | 'sleeping' = m.moving ? 'walking' : m.follow ? 'sitting' : stop.act === 'sit' ? 'sitting' : stop.act === 'down' ? 'down' : stop.act === 'sleep' ? 'sleeping' : 'walking';
  const asleep = pose === 'sleeping';
  const sniffing = pose === 'walking' && stop.act === 'sniff' && !m.follow;

  // Petting (UI only): a stroke across her, or a tap, gets one answer at a time
  const answer = () => {
    if (reducedMotion()) return;
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

  // Where her eyes go (her own coordinates: +x is the way she faces): a visitor, up at the tree, at you, around
  const look = m.onVisitor ? 'visitor' : m.moving && !sniffing ? 'ahead' : stop.look;
  const eyes =
    look === 'visitor' && m.target
      ? { x: Math.max(-2, Math.min(2, ((m.target.x - m.x) * m.facing) / 40)), y: -2 }
      : look === 'tree'
      ? { x: 1.6, y: -1.8 }
      : look === 'ahead'
      ? { x: 1.6, y: 0.4 }
      : look === 'around'
      ? { x: 0.8, y: -0.2 }
      : { x: 0, y: 0.3 }; // at you
  const excited = m.onVisitor && it?.level === 'excited';
  const breath = pose === 'sleeping' ? lucy.breath.asleep : pose === 'down' ? lucy.breath.down : lucy.breath.up;
  const p: Pose = {
    face: { asleep, look: eyes, tongue: (lucy.cue === 'panting' || excited) && !asleep, earsDown: lucy.cue === 'storm', twitch: react?.kind === 'twitch', drowsy: lucy.night && pose === 'down' && look === 'user' },
    tilt: react?.kind === 'tilt' || (m.onVisitor && !m.moving && (it?.level === 'curious' || it?.level === 'excited')),
    wag: react?.kind === 'thump' || react?.kind === 'tilt' || excited || (m.follow && !m.moving),
    breathMs: breath,
    breathe: !reducedMotion(),
    lookUp: look === 'tree' || look === 'visitor',
    lookAround: look === 'around' && !m.moving,
    bounce: excited && !m.moving && !reducedMotion(),
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
          <Walking p={p} moving={m.moving} sniff={sniffing} />
        ) : pose === 'sitting' ? (
          <Sitting p={p} />
        ) : pose === 'down' ? (
          <Down p={p} chinOnPaws={lucy.cue === 'concern' || lucy.cue === 'tired' || (lucy.night && look === 'user')} />
        ) : (
          <Sleeping p={p} />
        )}
      </g>
    </g>
  );
};

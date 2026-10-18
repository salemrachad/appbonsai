import React, { useEffect, useRef, useState } from 'react';
import { APP_CONFIG } from '../../config/appConfig';
import type { LucyPresentation } from '../../expression/expressionTypes';

// Lucy (expression.lucy): the household's Coton de Tuléar on the floor by the pot. Draws what upstream
// decided: walking in or out, sitting, lying down, or asleep, on her pillow, on the cool floor or right by
// the pot. Evidence class "art". Her look follows the hand-inked card style: white shaggy fur outlined in a
// soft navy ink, blue-grey shading instead of grey, big dark eyes with catch-lights and a large glossy nose.
//
// Local behaviour (UI only, never stored, never brings more visits):
// - she walks in from the left when a visit begins and out again as it ends, on the clock between polls;
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
  by_pot: { x: 140, y: 457 }, // right in front of the stand, close to the tree
};
const SIZE = 1.1;
const ARRIVE_MS = 5200; // the walk in or out across the floor
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
  lookUp: boolean; // chin up toward the tree
}

function Sitting({ p }: { p: Pose }) {
  return (
    <g>
      <Tail x={-16} y={-24} rot={-35} wag={p.wag} />
      <g className={p.breathe ? 'lucy-breathe' : undefined} style={{ animationDuration: `${p.breathMs}ms`, transformBox: 'fill-box', transformOrigin: '50% 100%' }}>
        <Fluff cx={-8} cy={-11} rx={13} ry={11} n={12} seed={3} />
        <Fluff cx={-1} cy={-2.2} rx={6.5} ry={2.6} n={7} amp={0.14} seed={5} />
        <Fluff cx={3} cy={-22} rx={11} ry={15} n={13} seed={6} />
        <Hairs d="M -14,-6 q -2,1 -3,3 M 8,-28 q 2,1 3,3 M -2,-14 q 1,2 0,4" />
      </g>
      <Leg x={11.5} top={-17} far />
      <Leg x={5.5} top={-17} />
      <g transform="translate(6 -40)">
        <g className={p.tilt ? 'lucy-tilt' : undefined} style={{ transformBox: 'fill-box', transformOrigin: '50% 90%', transform: p.lookUp ? 'rotate(-10deg)' : undefined }}>
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
        <g className={p.tilt ? 'lucy-tilt' : undefined} style={{ transformBox: 'fill-box', transformOrigin: '50% 90%', transform: p.lookUp ? 'rotate(-8deg)' : undefined }}>
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

function Walking({ p, moving }: { p: Pose; moving: boolean }) {
  const leg = (a: boolean) => (moving ? (a ? 'lucy-leg-a' : 'lucy-leg-b') : undefined);
  return (
    <g>
      <Tail x={-19} y={-31} rot={-50} wag />
      <Leg x={-12} top={-16} far className={leg(false)} />
      <Leg x={13} top={-16} far className={leg(true)} />
      <g className={p.breathe ? 'lucy-breathe' : undefined} style={{ animationDuration: `${p.breathMs}ms`, transformBox: 'fill-box', transformOrigin: '50% 100%' }}>
        <Fluff cx={0} cy={-21} rx={19} ry={10} n={15} seed={31} />
        <Hairs d="M -12,-13 q -1,2 -1,4 M 6,-13 q 1,2 0,4 M -4,-30 q 2,-1 4,0" />
      </g>
      <Leg x={-7} top={-16} className={leg(true)} />
      <Leg x={17} top={-16} className={leg(false)} />
      <g transform="translate(21 -33)">
        <g className={p.tilt ? 'lucy-tilt' : undefined} style={{ transformBox: 'fill-box', transformOrigin: '50% 90%' }}>
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

// Walking in and out on the clock: an offset from her spot (0 = there), and whether she is moving now
function useLucyWalk(lucy: LucyPresentation | null) {
  const [, tick] = useState(0);
  const arrivedAt = useRef<{ id: string; at: number } | null>(null);
  const id = lucy?.id ?? null;
  // The arrival plays once per visit, and only if the page sees her while she is still walking in
  if (lucy && arrivedAt.current?.id !== lucy.id) {
    const walkingIn = Date.now() < lucy.startedAt + lucy.walkInMs;
    arrivedAt.current = { id: lucy.id, at: walkingIn && !reducedMotion() ? Date.now() : 0 };
  }
  useEffect(() => {
    if (!id || reducedMotion()) return;
    const t = setInterval(() => tick((n) => n + 1), 120);
    return () => clearInterval(t);
  }, [id]);
  if (!lucy || reducedMotion()) return { dx: 0, moving: false, leaving: false, gone: false };
  const now = Date.now();
  const from = SPOT[lucy.spot].x;
  const offstage = OFFSTAGE_X - from;
  const start = arrivedAt.current?.at ?? 0;
  if (start && now - start < ARRIVE_MS) {
    const k = (now - start) / ARRIVE_MS;
    const ease = 1 - (1 - k) * (1 - k);
    return { dx: offstage * (1 - ease), moving: true, leaving: false, gone: false };
  }
  // Leaving: the last seconds of the visit she trots off to the left (the next poll removes her)
  const leaveAt = lucy.endsAt - ARRIVE_MS;
  if (now >= leaveAt) {
    const k = Math.min(1, (now - leaveAt) / ARRIVE_MS);
    return { dx: offstage * k * k, moving: k < 1, leaving: true, gone: k >= 1 };
  }
  return { dx: 0, moving: false, leaving: false, gone: false };
}

export const Lucy: React.FC<{ lucy: LucyPresentation | null; lookToward?: { x: number; y: number } | null }> = ({ lucy, lookToward = null }) => {
  const walk = useLucyWalk(lucy);
  const [react, setReact] = useState<{ kind: 'tilt' | 'thump' | 'twitch'; at: number } | null>(null);
  const travel = useRef<{ x: number; y: number; d: number } | null>(null);
  useEffect(() => {
    if (!react) return;
    const t = setTimeout(() => setReact(null), 2400);
    return () => clearTimeout(t);
  }, [react]);
  useEffect(() => setReact(null), [lucy?.id]);

  if (!lucy || walk.gone) return null;
  const spot = SPOT[lucy.spot];
  const asleep = lucy.pose === 'sleeping';
  // Out of a walk the pose is upstream's; while she walks in or out she is walking
  const pose = walk.moving ? 'walking' : lucy.pose;

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

  // Where her eyes go: up at the tree when she watches over it, toward a visitor she looks at
  const watching = lucy.cue === 'concern' || lucy.cue === 'storm';
  const look = lookToward ? { x: Math.max(-2, Math.min(2, (lookToward.x - spot.x) / 60)), y: -2 } : watching ? { x: 1.4, y: -1.8 } : { x: 0.6, y: 0 };
  const p: Pose = {
    face: { asleep, look, tongue: lucy.cue === 'panting' && !asleep, earsDown: lucy.cue === 'storm', twitch: react?.kind === 'twitch' },
    tilt: react?.kind === 'tilt' || (!!lookToward && !asleep),
    wag: react?.kind === 'thump' || react?.kind === 'tilt',
    breathMs: lucy.breathMs,
    breathe: !reducedMotion(),
    lookUp: watching || !!lookToward,
  };
  const facing = walk.leaving ? -1 : 1; // facing the pot; leaving, she turns to go
  const shaking = lucy.cue === 'shake_off' && pose === 'walking' && !walk.moving;
  return (
    <g
      transform={`translate(${spot.x + walk.dx} ${spot.y}) scale(${SIZE * facing} ${SIZE})`}
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
        {pose === 'walking' ? <Walking p={p} moving={walk.moving} /> : pose === 'sitting' ? <Sitting p={p} /> : pose === 'down' ? <Down p={p} chinOnPaws={lucy.cue === 'concern' || lucy.cue === 'tired'} /> : <Sleeping p={p} />}
      </g>
    </g>
  );
};

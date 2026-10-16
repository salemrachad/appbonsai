import React, { useEffect, useRef, useState } from 'react';
import type { DragonflyPresentation } from '../../expression/expressionTypes';
import { APP_CONFIG } from '../../config/appConfig';

// The dragonfly (expression.dragonfly). Draws what upstream decided: its route through the visit (perched
// on a tip, hovering by one, flying between them, back to its home perch again and again), played on the
// clock between polls; its wings beat at the tempo the Expression Engine set from the warmth. Evidence
// class "art". Its only local behaviour: a stroke on the leaves makes it dart off, hover a moment and land
// back where it was (never stored, never sent). Resting on the sloth it is drawn by the sloth (so it sways
// with it); flying to and from the sloth is drawn here. Reduced motion: no flights, it is just where it is.

type Perch = DragonflyPresentation['perch'];
type Stop = DragonflyPresentation['route'][number];

// Leaf tips at the edges of the pads (SVG coordinates of the avatar)
const PERCH: Record<Exclude<Perch, 'on_sloth'>, { x: number; y: number; dir: 1 | -1 }> = {
  left_tip: { x: 66, y: 182, dir: -1 },
  right_tip: { x: 378, y: 146, dir: 1 },
  crown_tip: { x: 292, y: 40, dir: 1 },
  left_top: { x: 100, y: 152, dir: -1 },
};

const SIZE = 1.7; // drawn at this scale so it reads next to the squirrel
const ON_SLOTH = 0.6; // its scale while on the sloth (as the sloth draws its rider)
const HOVER_LIFT = 40; // a hover sits this far above the tip

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

type Spot = { x: number; y: number; dir: 1 | -1 };
// A stop in avatar coordinates (on the sloth: the sloth's rider spot, or left_tip when there's no sloth)
const spotOf = (perch: Perch, rider: Spot | null): Spot => (perch === 'on_sloth' ? rider ?? PERCH.left_tip : PERCH[perch]);

// Where it is on its route right now: the stop it is at, or the stop it is flying to (and from where)
export interface Flight {
  stop: Stop;
  from: Stop | null; // set while flying to `stop`
}
function flightAt(route: Stop[], flightMs: number, now: number): Flight | null {
  if (!route.length) return null;
  let i = 0;
  while (i + 1 < route.length && route[i + 1].at - flightMs <= now) i++;
  const flying = i > 0 && now < route[i].at;
  return { stop: route[i], from: flying ? route[i - 1] : null };
}
// Re-renders at every departure and arrival of the route
export function useDragonflyFlight(df: DragonflyPresentation | null): Flight | null {
  const [, setTick] = useState(0);
  // An older server sends no route: it just stays on its tip
  const route = df ? (df.route?.length ? df.route : [{ at: 0, perch: df.perch, mode: df.presence }]) : [];
  const flightMs = df?.flightMs ?? 1400;
  const f = df ? flightAt(route, flightMs, Date.now()) : null;
  useEffect(() => {
    if (!df) return;
    const next = route.flatMap((s) => [s.at - flightMs, s.at]).find((t) => t > Date.now());
    if (next === undefined) return;
    const t = setTimeout(() => setTick((n) => n + 1), Math.min(next - Date.now() + 20, 2147483647));
    return () => clearTimeout(t);
  });
  if (!f) return null;
  // Reduced motion: no flights, it is simply at its current stop
  return reducedMotion() ? { stop: f.stop, from: null } : f;
}

// Where it is (avatar coordinates), for the squirrel to watch
export function dragonflyAt(f: Flight | null, rider: Spot | null): { x: number; y: number } | null {
  if (!f) return null;
  const s = spotOf(f.stop.perch, rider);
  return { x: s.x, y: s.y - (f.stop.mode === 'hovering' ? HOVER_LIFT : 0) };
}

// Facing right, perched at (0,0): a slender body along the leaf, four glassy wings
const Body: React.FC<{ flying: boolean }> = ({ flying }) => (
  <g>
    <defs>
      <linearGradient id="dfWing" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#E8F7FF" stopOpacity="0.85" />
        <stop offset="55%" stopColor="#BFE6F5" stopOpacity="0.45" />
        <stop offset="100%" stopColor="#D9C8F2" stopOpacity="0.55" />
      </linearGradient>
    </defs>
    {/* Wings: flat and spread when perched, a shimmering blur when flying */}
    <g className={flying ? 'df-wings df-wings-fly' : 'df-wings'} style={{ transformBox: 'fill-box', transformOrigin: '50% 50%' }}>
      <ellipse cx="-1" cy="-7" rx="10" ry="2.6" transform="rotate(-18 -1 -7)" fill="url(#dfWing)" stroke="#9DBFD0" strokeWidth="0.4" />
      <ellipse cx="-1" cy="5" rx="10" ry="2.6" transform="rotate(18 -1 5)" fill="url(#dfWing)" stroke="#9DBFD0" strokeWidth="0.4" />
      <ellipse cx="4" cy="-6" rx="9" ry="2.3" transform="rotate(-32 4 -6)" fill="url(#dfWing)" stroke="#9DBFD0" strokeWidth="0.4" />
      <ellipse cx="4" cy="4" rx="9" ry="2.3" transform="rotate(32 4 4)" fill="url(#dfWing)" stroke="#9DBFD0" strokeWidth="0.4" />
    </g>
    {/* Long tail, thorax, head with big eyes */}
    <path d="M -22,-0.6 L 0,-1.2 L 0,1.2 L -22,0.6 Z" fill="#2E7C93" />
    {[-18, -14, -10, -6].map((x) => (
      <line key={x} x1={x} y1="-1" x2={x} y2="1" stroke="#1B4F60" strokeWidth="0.5" />
    ))}
    <ellipse cx="2.5" cy="0" rx="4" ry="2.4" fill="#3A9AB3" />
    <circle cx="7.5" cy="-1.2" r="1.9" fill="#1F5E70" />
    <circle cx="7.5" cy="1.2" r="1.9" fill="#1F5E70" />
    <circle cx="8.1" cy="-1.6" r="0.5" fill="#FFFFFF" opacity="0.8" />
  </g>
);

// The free dragonfly (leaf tips, hovering, flights), or with onSloth the one resting on the sloth (the sloth
// places it). `rider` is the sloth's rider spot in avatar coordinates, for flights to and from it.
export const Dragonfly: React.FC<{ dragonfly: DragonflyPresentation | null; flight: Flight | null; strokeAt: number | null; rider?: Spot | null; onSloth?: boolean }> = ({
  dragonfly,
  flight,
  strokeAt,
  rider = null,
  onSloth = false,
}) => {
  const [dart, setDart] = useState(0);
  const seen = useRef(strokeAt);
  const lastDart = useRef(0);
  const resting = !!flight && !flight.from && flight.stop.perch === 'on_sloth' && flight.stop.mode === 'perched' && !!rider;
  const shown = !!dragonfly && !!flight && (onSloth ? resting : !resting);
  useEffect(() => {
    if (strokeAt === null || strokeAt === seen.current) return;
    seen.current = strokeAt;
    if (!shown || flight?.from || reducedMotion()) return; // mid-flight it is already off
    // One dart at a time: while it is away, more strokes don't restart it
    if (Date.now() - lastDart.current < APP_CONFIG.habitat.dragonfly.returnAfterDartMs) return;
    lastDart.current = Date.now();
    setDart(Date.now());
  }, [strokeAt]); // eslint-disable-line react-hooks/exhaustive-deps
  // Back where it was: wings flat again
  useEffect(() => {
    if (!dart) return;
    const t = setTimeout(() => setDart(0), APP_CONFIG.habitat.dragonfly.returnAfterDartMs + 100);
    return () => clearTimeout(t);
  }, [dart]);

  if (!dragonfly || !flight) return null;
  const darting = dart > 0;
  const wing = { '--wing-tempo': dragonfly.wingTempo } as React.CSSProperties;

  if (onSloth) {
    if (!resting) return null;
    return (
      <g style={wing}>
        <g key={`${dragonfly.id}:${dart}`} className={darting ? 'df-dart' : 'df-perch'}>
          <Body flying={darting} />
        </g>
      </g>
    );
  }

  // Free: at its stop, or flying to it (the position glides over the flight time; it faces where it flies)
  const { stop, from } = flight;
  const to = spotOf(stop.perch, rider);
  const toSloth = stop.perch === 'on_sloth' && !!rider;
  const lift = stop.mode === 'hovering' ? HOVER_LIFT : 0;
  const prev = from ? spotOf(from.perch, rider) : null;
  const dir: 1 | -1 = prev && Math.abs(to.x - prev.x) > 4 ? (to.x > prev.x ? 1 : -1) : to.dir;
  const scale = toSloth && stop.mode === 'perched' ? SIZE * ON_SLOTH : SIZE; // shrinks to its size on the sloth as it lands there
  const flying = !!from || stop.mode === 'hovering' || darting;
  const motion = darting ? 'df-dart' : from ? 'df-fly' : stop.mode === 'hovering' ? 'df-hover-here' : 'df-perch';
  return (
    <g
      pointerEvents="none"
      aria-hidden
      style={{
        ...wing,
        opacity: resting ? 0 : 1, // landed on the sloth: the sloth draws it now (this one waits there, invisible)
        transform: `translate(${to.x}px, ${to.y - lift}px) scale(${dir * scale}, ${scale})`,
        transition: reducedMotion() ? 'none' : `transform ${dragonfly.flightMs}ms cubic-bezier(0.5, 0, 0.3, 1)`,
      }}
    >
      {/* key: the dart replays from where it is, and it lands back exactly there */}
      <g key={`${dragonfly.id}:${dart}`} className={motion}>
        <Body flying={flying} />
      </g>
    </g>
  );
};

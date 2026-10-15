import React, { useCallback, useEffect, useRef, useState } from 'react';
import { APP_CONFIG } from '../../config/appConfig';
import type { TouchResponse } from '../../expression/expressionTypes';
import { habituate } from '../../expression/touch';
import { PADS } from './Foliage';

// Petting: stroking the foliage. Attention, not care. This hook only animates the answer the Expression
// Engine chose (`expression.touch`) and reports finished SESSIONS; it decides nothing about the tree and
// never sends anything while the pointer moves.
//
// Two kinds of feedback, kept apart on purpose:
// - YOUR HAND (always the same, whatever the tree's state): an open-hand cursor over the foliage and a
//   soft glow under the pointer while petting. It shows what you are doing, not how the tree feels.
// - THE TREE'S ANSWER (from expression.touch): leaves bend with the hand and rustle while it moves, the
//   tree leans, a blink. A thirsty, sleeping or unsure tree answers less, however you pet it.
//
// Gestures:
// - Mouse: moving over the foliage pets it (no click needed); a held-button drag works too. Hover petting
//   starts after HOVER_START_PX of movement over the leaves and ends when the mouse rests or leaves them.
// - Touch / pen: a drag across the foliage. `touch-action: pan-y` keeps vertical swipes scrolling.
// - Tap vs stroke: a press that travels less than STROKE_PX stays a tap (the existing tap reaction).
// - A stroke shorter than MIN_STROKE_MS (brushing past) shows the hand but is not counted or acknowledged.
//
// Motion: one damped spring per foliage pad plus a lean spring, driven from a single rAF loop that runs only
// while something moves. Transforms go straight to the <g> elements (no React render per frame). Leaves
// bend sideways and may settle a little lower, never higher: petting never lifts a droop.
// Habituation: continuous stroking settles the answer toward `touch.habituation.floor` (calm acceptance,
// never a refusal); a rest recovers it (`habituate()` in expression/touch.ts). Lives only in this page.
// prefers-reduced-motion: the hand glow and the blink only; leaves don't move.

export interface PetSession {
  startedAt: number;
  endedAt: number;
  count: number; // strokes
  activeMs: number; // time with the hand actually on the tree
}

const STROKE_PX = 8; // screen px a press must travel to become a stroke
const HOVER_START_PX = 20; // screen px of mouse movement over the leaves before hovering becomes petting
const HOVER_REST_MS = 500; // a hovering mouse that stops this long has lifted its hand
const MIN_STROKE_MS = 300; // shorter strokes are brushing past: not counted, not acknowledged
const MAX_BEND = 18; // svg units of sideways bend at full give
const REACH = 1.5; // how far beyond a pad's radius the hand still moves it
const GLOW = 0.55; // opacity of the hand glow while petting

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

interface Spring {
  x: number;
  v: number;
}

interface Stroke {
  source: 'press' | 'hover';
  pointerId: number;
  startedAt: number; // Date.now()
  acknowledged: boolean; // passed MIN_STROKE_MS: counted, blinked at
}

export function usePetting(svg: React.RefObject<SVGSVGElement | null>, touch: TouchResponse | null, onSession?: (s: PetSession) => void) {
  const pads = useRef<(SVGGElement | null)[]>([null, null, null]);
  const lean = useRef<SVGGElement | null>(null);
  const glow = useRef<SVGCircleElement | null>(null);
  const [blink, setBlink] = useState<{ kind: 'soft_close' | 'slow'; at: number } | null>(null);

  const touchRef = useRef(touch);
  touchRef.current = touch;
  const onSessionRef = useRef(onSession);
  onSessionRef.current = onSession;

  const press = useRef<{ id: number; x: number; y: number } | null>(null); // a pressed pointer not yet stroking
  const hover = useRef<{ x: number; y: number; travel: number } | null>(null); // mouse over the leaves, not yet petting
  const stroke = useRef<Stroke | null>(null);
  const hand = useRef<{ x: number; y: number; vx: number; speed: number; t: number } | null>(null);
  const springs = useRef<Spring[]>(PADS.map(() => ({ x: 0, v: 0 })));
  const rustle = useRef<number[]>(PADS.map(() => 0)); // per-pad quick leaf rustle amplitude (deg)
  const leanSpring = useRef<Spring>({ x: 0, v: 0 });
  const glowOpacity = useRef(0);
  const frame = useRef(0);
  const lastFrame = useRef(0);
  const suppressClick = useRef(false);
  const lastBlinkAt = useRef(0);
  const session = useRef<PetSession | null>(null);
  const level = useRef(1); // habituation: 1 = fresh answer … floor = settled
  const restingSince = useRef<number | null>(null); // when the last stroke ended (performance.now)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverRest = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Screen → SVG viewBox coordinates (respects the viewBox scaling and letterboxing)
  const toSvg = useCallback(
    (clientX: number, clientY: number) => {
      const ctm = svg.current?.getScreenCTM();
      if (!ctm) return null;
      const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
      return { x: p.x, y: p.y };
    },
    [svg]
  );

  const nearFoliage = (p: { x: number; y: number }) => PADS.some((pad) => Math.hypot((p.x - pad.cx) / pad.rx, (p.y - pad.cy) / pad.ry) <= REACH);

  const closeSession = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = null;
    const s = session.current;
    session.current = null;
    if (s && s.count > 0) onSessionRef.current?.(s);
  }, []);

  const write = (t: number) => {
    const still = reducedMotion();
    springs.current.forEach((s, i) => {
      const g = pads.current[i];
      if (!g) return;
      const pad = PADS[i];
      const r = rustle.current[i];
      if (still || (Math.abs(s.x) < 0.02 && r < 0.02)) return g.removeAttribute('transform');
      // Sideways bend about the pad's base (a bend only settles slightly lower, never lifts), plus a quick
      // rustle while the hand moves through the leaves
      const rot = s.x * 0.5 + r * Math.sin(t / 38 + i * 2.1);
      g.setAttribute('transform', `translate(${s.x.toFixed(2)} ${(Math.abs(s.x) * 0.08).toFixed(2)}) rotate(${rot.toFixed(2)} ${pad.cx} ${pad.cy + pad.ry})`);
    });
    const l = leanSpring.current;
    if (lean.current) {
      if (still || Math.abs(l.x) < 0.01) lean.current.removeAttribute('transform');
      else lean.current.setAttribute('transform', `rotate(${l.x.toFixed(3)} 220 374)`);
    }
    const gl = glow.current;
    const h = hand.current;
    if (gl && h) {
      gl.setAttribute('cx', h.x.toFixed(1));
      gl.setAttribute('cy', h.y.toFixed(1));
    }
    if (gl) gl.setAttribute('opacity', glowOpacity.current.toFixed(3));
  };

  const step = useCallback((t: number) => {
    const touch = touchRef.current;
    const dt = Math.min(1 / 30, Math.max(0.001, (t - (lastFrame.current || t)) / 1000));
    lastFrame.current = t;
    const h = stroke.current ? hand.current : null;
    let moving = !!h;
    if (h) {
      h.vx *= Math.pow(0.02, dt); // the hand's push fades when it rests
      h.speed *= Math.pow(0.01, dt);
    }
    if (h && touch) level.current = habituate(level.current, touch.habituation, dt * 1000, true);

    const k = touch?.stiffness ?? 80;
    const c = touch?.damping ?? 14;
    const give = (touch?.give ?? 0.5) * level.current;
    springs.current.forEach((s, i) => {
      const pad = PADS[i];
      let target = 0;
      let rustleTarget = 0;
      if (h) {
        const d = Math.hypot((h.x - pad.cx) / pad.rx, (h.y - pad.cy) / pad.ry);
        const falloff = Math.exp(-((d / REACH) ** 2) * 1.6);
        // Follow the hand's movement, and lean toward where it rests
        const push = h.vx * 0.09 + ((h.x - pad.cx) / pad.rx) * 3.5;
        target = Math.max(-MAX_BEND, Math.min(MAX_BEND, push)) * give * falloff;
        rustleTarget = Math.min(1, h.speed / 350) * falloff * give * 2.4;
      }
      s.v += (-k * (s.x - target) - c * s.v) * dt;
      s.x += s.v * dt;
      rustle.current[i] += (rustleTarget - rustle.current[i]) * Math.min(1, dt * 10);
      if (Math.abs(s.x - target) > 0.03 || Math.abs(s.v) > 0.03 || rustle.current[i] > 0.02) moving = true;
    });
    const l = leanSpring.current;
    const leanTarget = h ? Math.sign(h.x - 220) * (touch?.lean ?? 0) * level.current * 2.2 : 0;
    l.v += (-k * 0.35 * (l.x - leanTarget) - c * 0.6 * l.v) * dt;
    l.x += l.v * dt;
    if (Math.abs(l.x - leanTarget) > 0.005 || Math.abs(l.v) > 0.005) moving = true;

    // The hand glow: the same for every tree, it shows the petting, not the tree's state
    const glowTarget = h ? GLOW : 0;
    glowOpacity.current += (glowTarget - glowOpacity.current) * Math.min(1, dt * (h ? 12 : 5));
    if (Math.abs(glowOpacity.current - glowTarget) > 0.01) moving = true;

    write(t);
    if (moving) frame.current = requestAnimationFrame(step);
    else {
      frame.current = 0;
      lastFrame.current = 0;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const kick = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(step);
  }, [step]);

  const startStroke = (source: Stroke['source'], pointerId: number, p: { x: number; y: number }) => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = null;
    const now = Date.now();
    if (!session.current) session.current = { startedAt: now, endedAt: now, count: 0, activeMs: 0 };
    // The rest since the last stroke lets the answer recover
    const touch = touchRef.current;
    if (touch && restingSince.current !== null) level.current = habituate(level.current, touch.habituation, performance.now() - restingSince.current, false);
    restingSince.current = null;
    stroke.current = { source, pointerId, startedAt: now, acknowledged: false };
    hand.current = { x: p.x, y: p.y, vx: 0, speed: 0, t: performance.now() };
    kick();
  };

  // Past MIN_STROKE_MS a stroke is real petting: it counts, and the tree acknowledges it (a settled tree
  // no longer blinks at every stroke)
  const acknowledge = (s: Stroke) => {
    if (s.acknowledged || Date.now() - s.startedAt < MIN_STROKE_MS) return;
    s.acknowledged = true;
    const b = touchRef.current?.blink ?? 'none';
    const now = Date.now();
    if (b !== 'none' && level.current > 0.7 && now - lastBlinkAt.current > 2500) {
      lastBlinkAt.current = now;
      setBlink({ kind: b, at: now });
    }
  };

  const endStroke = () => {
    if (hoverRest.current) clearTimeout(hoverRest.current);
    hoverRest.current = null;
    const s = stroke.current;
    stroke.current = null;
    hover.current = null;
    if (!s) return;
    const now = Date.now();
    restingSince.current = performance.now();
    acknowledge(s);
    if (s.acknowledged && session.current) {
      session.current.count += 1;
      session.current.endedAt = now;
      session.current.activeMs += now - s.startedAt;
    }
    if (session.current) idleTimer.current = setTimeout(closeSession, APP_CONFIG.attention.sessionIdleMs);
    kick(); // let the springs and the glow settle
  };

  const moveHand = (p: { x: number; y: number }) => {
    const h = hand.current;
    if (!h) return;
    const t = performance.now();
    const dt = Math.max(1, t - h.t) / 1000;
    const vx = (p.x - h.x) / dt; // svg units per second
    const speed = Math.hypot(p.x - h.x, p.y - h.y) / dt;
    hand.current = { x: p.x, y: p.y, vx: h.vx * 0.6 + vx * 0.4, speed: h.speed * 0.6 + speed * 0.4, t };
    if (stroke.current) acknowledge(stroke.current);
    kick();
  };

  const onPointerDown = (e: React.PointerEvent) => {
    suppressClick.current = false; // a touch stroke may end without a click: never swallow the next tap
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (stroke.current?.source === 'hover') endStroke(); // a click while hover-petting starts fresh
    const p = toSvg(e.clientX, e.clientY);
    if (!p || !nearFoliage(p)) return;
    press.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = toSvg(e.clientX, e.clientY);
    const el = e.currentTarget as HTMLElement;
    const over = !!p && nearFoliage(p);
    // The cursor tells you the leaves can be petted
    if (e.pointerType === 'mouse') el.style.cursor = over || stroke.current ? 'grab' : '';

    // A pressed pointer (any kind) becomes a stroke once it travels
    const pr = press.current;
    if (pr && pr.id === e.pointerId) {
      if (!stroke.current) {
        if (Math.hypot(e.clientX - pr.x, e.clientY - pr.y) < STROKE_PX || !p) return;
        suppressClick.current = true;
        el.setPointerCapture?.(e.pointerId);
        startStroke('press', e.pointerId, p);
      }
      if (p) moveHand(p);
      return;
    }

    // Mouse hover (no button held): moving over the leaves pets them
    if (e.pointerType !== 'mouse' || e.buttons !== 0 || !p) return;
    if (!over) {
      if (stroke.current?.source === 'hover') endStroke();
      hover.current = null;
      return;
    }
    if (!stroke.current) {
      const hv = hover.current;
      if (!hv) {
        hover.current = { x: e.clientX, y: e.clientY, travel: 0 };
        return;
      }
      hv.travel += Math.hypot(e.clientX - hv.x, e.clientY - hv.y);
      hv.x = e.clientX;
      hv.y = e.clientY;
      if (hv.travel < HOVER_START_PX) return;
      startStroke('hover', e.pointerId, p);
    }
    if (stroke.current?.source !== 'hover') return;
    moveHand(p);
    // A resting mouse has lifted its hand
    if (hoverRest.current) clearTimeout(hoverRest.current);
    hoverRest.current = setTimeout(endStroke, HOVER_REST_MS);
  };

  const onPointerEnd = (e: React.PointerEvent) => {
    if (press.current?.id === e.pointerId) press.current = null;
    if (stroke.current?.source === 'press' && stroke.current.pointerId === e.pointerId) endStroke();
  };

  const onPointerLeave = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).style.cursor = '';
    if (stroke.current?.source === 'hover') endStroke();
    hover.current = null;
  };

  // The click that follows a stroke is not a tap
  const consumeClick = () => {
    const s = suppressClick.current;
    suppressClick.current = false;
    return s;
  };

  // Unmount or leaving the page closes an open session (one report, never a stream)
  useEffect(() => {
    const onHide = () => closeSession();
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      cancelAnimationFrame(frame.current);
      if (hoverRest.current) clearTimeout(hoverRest.current);
      closeSession();
    };
  }, [closeSession]);

  return {
    padRef: (i: number) => (el: SVGGElement | null) => {
      pads.current[i] = el;
    },
    leanRef: lean,
    glowRef: glow,
    blink,
    consumeClick,
    handlers: { onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd, onPointerLeave },
  };
}

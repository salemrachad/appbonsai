import React, { useEffect, useRef, useState } from 'react';
import type { AvatarPresentation, ExpressionState, Gaze, Gesture } from '../../expression/expressionTypes';
import { AvatarEffects, BodyDetails, ForegroundEffects, Lanterns, SoilEffects } from './AvatarEffects';
import { AvatarFace } from './AvatarFace';
import { FoliageDefs, PadBranchlets, PadLeaves, PADS, paletteFor } from './Foliage';
import { PetSession, usePetting } from './usePetting';
import { Dragonfly, dragonflyAt, useDragonflyFlight } from './Dragonfly';
import { Sloth, slothAt, slothRiderAt } from './Sloth';
import { HikingBoots } from './HikingBoots';
import { Lucy, LucyPillow } from './Lucy';
import { Drey, SquirrelTraces, useVisitorPlay, Visitor, visitorAt } from './Visitor';

interface BonsaiAvatarProps {
  expression: ExpressionState | null;
  onClick?: () => void;
  onTouch?: () => void; // the tree was tapped (Home may reveal its current thought)
  onPetSession?: (s: PetSession) => void; // a petting session ended (attention, reported once per session)
  className?: string;
}

// Canopy pads at a given droop (-0.2 lifted … 1 wilting). CSS transforms on wrapper groups, so the
// sway animation (on the inner group) and the droop (outer group, smoothly transitioned) don't fight.
function droopTransforms(d: number, shrink: boolean) {
  const s = shrink ? 0.93 : 1;
  return {
    left: { transform: `translate(${shrink ? 8 : 0}px, ${d * 20}px) rotate(${d * 11}deg) scale(${s})`, transformOrigin: '170px 225px' },
    right: { transform: `translate(${shrink ? -8 : 0}px, ${d * 20}px) rotate(${-d * 11}deg) scale(${s})`, transformOrigin: '275px 215px' },
    top: { transform: `translate(0px, ${d * 15}px) scale(${s * (1 - d * 0.07)}, ${s * (1 - d * 0.11)})`, transformOrigin: '220px 140px' },
  };
}

const RESTING: AvatarPresentation = {
  eyes: 'drowsy',
  mouth: 'flat',
  blush: 'normal',
  sweat: false,
  posture: 'normal',
  foliage: 'lush',
  foliageBlend: null,
  seasonalLeaves: { newGrowth: 0, yellowing: 0, leafDrop: 0 },
  canopy: { fullness: 1, refilling: 0 },
  soil: 'moist',
  gaze: 'center',
  gesture: null,
  filter: null,
  effects: [],
  animation: 'animate-tree-breathe-slow',
  halo: 'bg-[#81B29A]/10 blur-2xl',
};

// How long each gesture plays, and how it changes the face while it does
const GESTURE_MS: Record<Gesture, number> = {
  wiggle: 1300, sigh: 2600, shiver_burst: 1500, yawn: 2600, shake_off: 1300, fan: 1800, stretch_up: 2800,
  look_around: 2600, nod_off: 3200, shield: 2400, tremble: 1700, tilt: 2400,
};
const GESTURE_FACE: Partial<Record<Gesture, Partial<AvatarPresentation>>> = {
  wiggle: { eyes: 'joy' },
  sigh: { mouth: 'gasp', eyes: 'heavy' },
  shiver_burst: { eyes: 'squint_hard', mouth: 'chatter' },
  yawn: { mouth: 'yawn', eyes: 'closed' },
  shake_off: { eyes: 'squint_hard' },
  stretch_up: { mouth: 'gasp' },
  nod_off: { mouth: 'sleep' },
  shield: { eyes: 'squint_hard' },
};

// Where the eyes rest for each gaze mode (pupil offset in px); the avatar adds saccades around it.
const GAZE_BASE: Record<Gaze, { x: number; y: number; spread: number }> = {
  around: { x: 0, y: 0, spread: 2.6 },
  center: { x: 0, y: 0, spread: 0.5 },
  down: { x: 0, y: 2.6, spread: 1 },
  up: { x: 0, y: -2.6, spread: 1 },
  toward_light: { x: 3.2, y: -0.8, spread: 0.6 }, // the lantern on the right branch
  away: { x: -2.6, y: 1.8, spread: 0.7 }, // away from the glaring sun (top right)
  search: { x: 0, y: 0, spread: 3.4 },
  east: { x: -3.2, y: -1.2, spread: 0.6 }, // toward the rising sun (left of the sky)
  west: { x: 3.2, y: -0.4, spread: 0.6 }, // toward the setting sun (right)
};

const prefersReducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const FACE = { x: 220 / 440, y: 282 / 460 }; // face centre as a share of the SVG box

// Gaze: idle saccades around the mode's resting point; follows the pointer when someone is near.
function useGaze(mode: Gaze, eyesOpen: boolean, follow: boolean, gesture: Gesture | null, svg: React.RefObject<SVGSVGElement | null>) {
  const [gaze, setGaze] = useState({ x: 0, y: 0 });
  const pointerAt = useRef(0);

  useEffect(() => {
    if (!eyesOpen || !follow || prefersReducedMotion()) return;
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      const box = svg.current?.getBoundingClientRect();
      if (!box) return;
      const dx = (e.clientX - (box.left + box.width * FACE.x)) / box.width;
      const dy = (e.clientY - (box.top + box.height * FACE.y)) / box.height;
      if (Math.hypot(dx, dy) > 1.6) return; // too far away to notice
      pointerAt.current = Date.now();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setGaze({ x: Math.max(-3.4, Math.min(3.4, dx * 9)), y: Math.max(-2.6, Math.min(2.6, dy * 8)) }));
    };
    window.addEventListener('pointermove', onMove);
    return () => {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(frame);
    };
  }, [eyesOpen, follow, svg]);

  useEffect(() => {
    if (!eyesOpen) return;
    const base = GAZE_BASE[mode];
    if (prefersReducedMotion()) {
      setGaze({ x: base.x, y: base.y });
      return;
    }
    let t: ReturnType<typeof setTimeout>;
    const step = () => {
      if (Date.now() - pointerAt.current > 2500) {
        // Mostly glance near the resting point, sometimes return straight to it
        const back = Math.random() < 0.3;
        setGaze({
          x: base.x + (back ? 0 : (Math.random() - 0.5) * 2 * base.spread),
          y: base.y + (back ? 0 : (Math.random() - 0.5) * base.spread),
        });
      }
      const pace = mode === 'search' ? 450 + Math.random() * 700 : 1400 + Math.random() * 3200;
      t = setTimeout(step, pace);
    };
    step();
    return () => clearTimeout(t);
  }, [mode, eyesOpen]);

  // Looking around: a slow sweep left, then right
  useEffect(() => {
    if (gesture !== 'look_around') return;
    setGaze({ x: -3.2, y: -0.4 });
    const t = setTimeout(() => setGaze({ x: 3.2, y: -0.2 }), 1100);
    return () => clearTimeout(t);
  }, [gesture]);

  return gaze;
}

// A recurring gesture at an irregular interval, so the tree never looks like a loop.
function useGesture(g: AvatarPresentation['gesture']) {
  const [active, setActive] = useState<Gesture | null>(null);
  useEffect(() => {
    setActive(null);
    if (!g || prefersReducedMotion()) return;
    let t: ReturnType<typeof setTimeout>;
    let end: ReturnType<typeof setTimeout>;
    const play = () => {
      setActive(g.kind);
      end = setTimeout(() => setActive(null), GESTURE_MS[g.kind]);
      t = setTimeout(play, g.everyMs * (0.7 + Math.random() * 0.6));
    };
    t = setTimeout(play, 1800 + Math.random() * 2500); // the first one comes soon after a change
    return () => {
      clearTimeout(t);
      clearTimeout(end);
    };
  }, [g?.kind, g?.everyMs]); // eslint-disable-line react-hooks/exhaustive-deps
  return active;
}

const FILTER_URL: Record<NonNullable<AvatarPresentation['filter']>, string> = {
  heat_shimmer: 'url(#fxHeat)',
  frost: 'url(#fxFrost)',
  desaturate: 'url(#fxWashed)',
  glare: 'url(#fxGlare)',
  gloom: 'url(#fxGloom)',
};

// The animated bonsai character. Draws what the Expression Engine decided; never sees health or sensor values.
const BonsaiAvatarView: React.FC<BonsaiAvatarProps> = ({ expression, onClick, onTouch, onPetSession, className = '' }) => {
  const base = expression?.avatar ?? RESTING;
  const motion = expression?.motion ?? { swaySpeed: 0.6, swayAmount: 0.5, flutter: 0.4, blinkEveryMs: 6000 };
  const strength = expression?.reactionStrength ?? 0.5;
  const svgRef = useRef<SVGSVGElement>(null);
  const [isBlinking, setIsBlinking] = useState(false);
  const [tapReaction, setTapReaction] = useState(false);

  const gesture = useGesture(base.gesture);
  const look: AvatarPresentation = gesture ? { ...base, ...GESTURE_FACE[gesture] } : base;
  const eyesOpen = look.eyes !== 'closed' && look.eyes !== 'joy';
  const gaze = useGaze(base.gaze, eyesOpen, strength >= 0.35, gesture, svgRef);
  const isWatering = look.effects.includes('rain');
  const petting = usePetting(svgRef, expression?.touch ?? null, onPetSession);
  // Petting while the squirrel visits is play (attention only); how it plays was decided upstream
  const visitor = expression?.visitor ?? null;
  const visitorPose = useVisitorPlay(visitor, petting.strokeAt, expression?.touch.habituation ?? null);
  // Encounters (decided upstream): where each visitor is, so the others can look at it
  const squirrelAt = visitorAt(visitorPose);
  const slothGrip = expression?.sloth ? slothAt(expression.sloth.branch) : null;
  // The dragonfly flies its route on the clock; the sloth's rider spot is where it lands on the sloth
  const dragonfly = expression?.dragonfly ?? null;
  const flight = useDragonflyFlight(dragonfly);
  const riderSpot = expression?.sloth ? slothRiderAt(expression.sloth) : null;
  const watchAt =
    visitor?.lookAt === 'dragonfly' && dragonfly
      ? dragonflyAt(flight, riderSpot)
      : visitor?.lookAt === 'sloth' && slothGrip
      ? { x: slothGrip.x, y: slothGrip.y + 30 }
      : null;

  // Petting's acknowledgement is nonverbal: a soft or slow eye-close, nothing said
  useEffect(() => {
    if (!petting.blink || motion.blinkEveryMs === null) return;
    setIsBlinking(true);
    const t = setTimeout(() => setIsBlinking(false), petting.blink.kind === 'soft_close' ? 700 : 420);
    return () => clearTimeout(t);
  }, [petting.blink]); // eslint-disable-line react-hooks/exhaustive-deps

  // Blinking: livelier trees blink more often, sometimes twice; asleep, never
  useEffect(() => {
    if (motion.blinkEveryMs === null) return;
    let t: ReturnType<typeof setTimeout>;
    const blink = () => {
      setIsBlinking(true);
      setTimeout(() => setIsBlinking(false), 160);
      if (Math.random() < 0.18) {
        setTimeout(() => setIsBlinking(true), 320);
        setTimeout(() => setIsBlinking(false), 470);
      }
      t = setTimeout(blink, motion.blinkEveryMs! * (0.6 + Math.random() * 0.8));
    };
    t = setTimeout(blink, motion.blinkEveryMs * Math.random());
    return () => clearTimeout(t);
  }, [motion.blinkEveryMs]);

  // Touch: a responsive tree perks up visibly; a sleepy or unsure one barely stirs
  const handleInteract = () => {
    if (petting.consumeClick()) return; // that was a stroke, not a tap
    if (strength >= 0.35) {
      setTapReaction(true);
      setTimeout(() => setTapReaction(false), 600 + strength * 800);
    }
    if (motion.blinkEveryMs !== null) {
      setIsBlinking(true);
      setTimeout(() => setIsBlinking(false), 300);
    }
    onTouch?.();
    onClick?.();
  };

  const droopValue = expression?.leafDroop ?? 0.1;
  const droop = droopTransforms(droopValue, look.posture === 'shrink');
  const motionVars = {
    '--sway-speed': motion.swaySpeed,
    '--sway-amp': motion.swayAmount,
    '--flutter-amp': motion.flutter,
  } as React.CSSProperties;
  const palette = paletteFor(look.foliage, look.foliageBlend);
  // A thin canopy (the last weeks) looks lighter: the soft pad highlights fade a little
  const fullness = look.canopy?.fullness ?? 1;
  const hiOpacity = fullness < 0.8 ? Math.round((0.55 + ((fullness - 0.6) / 0.2) * 0.45) * 100) / 100 : 1;
  const sprouting = look.effects.includes('sprout');
  const animation = tapReaction ? (strength >= 0.7 ? 'transition-transform duration-300 scale-105 -rotate-1' : 'transition-transform duration-500 scale-[1.02]') : look.animation;
  const soilFill = { dry: 'url(#soilGradientDry)', wet: 'url(#soilGradientWet)', frozen: 'url(#soilGradientFrozen)', moist: 'url(#soilGradientMoist)' }[look.soil];
  const mossDim = look.foliage === 'thirsty' || look.foliage === 'parched' || look.foliage === 'scorched';
  const gestureClass = gesture ? `gesture-${gesture.replace('_', '-')}` : '';
  const pivot = { transformOrigin: '220px 374px', transformBox: 'view-box' } as React.CSSProperties;

  return (
    <div
      id="bonsai-avatar-container"
      onClick={handleInteract}
      {...petting.handlers}
      className={`relative flex items-center justify-center select-none cursor-pointer transition-all duration-500 ${className}`}
      style={{ touchAction: 'pan-y' }}
      title="Tap the tree, or move over its leaves to pet it"
    >
      <div className={`absolute w-72 h-72 rounded-full pointer-events-none transition-all duration-700 ${look.halo}`} />

      <svg
        ref={svgRef}
        viewBox="0 0 440 460"
        className={`w-full h-full drop-shadow-md transition-transform duration-500 ${animation}`}
        style={{ transformOrigin: '220px 420px', ...motionVars }}
      >
        <defs>
          <FoliageDefs palette={palette} />
          <linearGradient id="barkGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#5A4E40" />
            <stop offset="35%" stopColor="#6B5E4F" />
            <stop offset="70%" stopColor="#5A4E40" />
            <stop offset="100%" stopColor="#483D31" />
          </linearGradient>
          <linearGradient id="barkHighlight" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#8C7D6D" />
            <stop offset="100%" stopColor="#5A4E40" />
          </linearGradient>
          <linearGradient id="potGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#C16345" />
            <stop offset="30%" stopColor="#D97757" />
            <stop offset="70%" stopColor="#C16345" />
            <stop offset="100%" stopColor="#A44E33" />
          </linearGradient>
          <linearGradient id="potRim" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#C16345" />
            <stop offset="50%" stopColor="#E28667" />
            <stop offset="100%" stopColor="#A44E33" />
          </linearGradient>
          <linearGradient id="soilGradientMoist" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={isWatering ? '#2B1E16' : '#423024'} />
            <stop offset="100%" stopColor={isWatering ? '#1D140E' : '#2A1F18'} />
          </linearGradient>
          <linearGradient id="soilGradientWet" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#24180F" />
            <stop offset="100%" stopColor="#140D08" />
          </linearGradient>
          <linearGradient id="soilGradientDry" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#C4A882" />
            <stop offset="100%" stopColor="#9C825E" />
          </linearGradient>
          <linearGradient id="soilGradientFrozen" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#DCE9F0" />
            <stop offset="100%" stopColor="#8EA4B2" />
          </linearGradient>
          {/* The petting hand: a soft warm glow under the pointer (the same for every state) */}
          <radialGradient id="petHandGlow">
            <stop offset="0%" stopColor="#FFF6DC" stopOpacity="0.95" />
            <stop offset="45%" stopColor="#FFF1C9" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#FFF1C9" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="waterDropGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#70D6FF" />
            <stop offset="100%" stopColor="#0077B6" />
          </linearGradient>
          <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="6" />
            <feColorMatrix type="matrix" values="0 0 0 0 0   0 0 0 0 0   0 0 0 0 0  0 0 0 0.18 0" />
            <feOffset dx="0" dy="6" />
            <feBlend in="SourceGraphic" in2="blurOut" mode="normal" />
          </filter>
          {/* Whole-tree filters: heat haze, frost tint, washed out (no data), glare, gloom */}
          <filter id="fxHeat" x="-10%" y="-10%" width="120%" height="120%">
            <feTurbulence type="fractalNoise" baseFrequency="0.01 0.045" numOctaves="1" seed="3" result="noise">
              <animate attributeName="baseFrequency" dur="4s" values="0.01 0.04;0.012 0.06;0.01 0.04" repeatCount="indefinite" />
            </feTurbulence>
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="3" xChannelSelector="R" yChannelSelector="G" />
          </filter>
          <filter id="fxFrost">
            <feColorMatrix type="matrix" values="0.8 0.1 0.1 0 0.04  0.1 0.85 0.12 0 0.06  0.12 0.15 0.95 0 0.12  0 0 0 1 0" />
          </filter>
          <filter id="fxWashed">
            <feColorMatrix type="saturate" values="0.2" />
          </filter>
          <filter id="fxGlare">
            <feComponentTransfer>
              <feFuncR type="linear" slope="1.15" intercept="0.05" />
              <feFuncG type="linear" slope="1.15" intercept="0.05" />
              <feFuncB type="linear" slope="1.05" intercept="0.02" />
            </feComponentTransfer>
          </filter>
          <filter id="fxGloom">
            <feColorMatrix type="matrix" values="0.7 0.1 0.1 0 0  0.08 0.68 0.1 0 0  0.12 0.1 0.8 0 0.02  0 0 0 1 0" />
          </filter>
        </defs>

        <AvatarEffects effects={look.effects} />

        {/* Shadow & stand */}
        <ellipse cx="220" cy="438" rx="145" ry="14" fill="#000000" opacity="0.08" filter="url(#softShadow)" />
        <g id="bonsai-stand">
          <rect x="100" y="420" width="240" height="9" rx="3" fill="#3D2619" />
          <rect x="102" y="421" width="236" height="3" rx="1.5" fill="#5A3A27" opacity="0.6" />
          <path d="M 125,429 L 120,439 L 136,439 L 132,429 Z" fill="#2E1D13" />
          <path d="M 308,429 L 304,439 L 320,439 L 315,429 Z" fill="#2E1D13" />
        </g>
        {/* Hike day: two pairs of hiking boots on the ground by the stand */}
        <HikingBoots show={!!expression?.hike?.boots} />
        {/* Lucy's pillow: always there, on the floor left of the stand */}
        <LucyPillow />

        {/* A squirrel's tail now and then over the back of the pot (its traces, before it visits) */}
        <SquirrelTraces traces={expression?.squirrelTraces ?? null} layer="behind_pot" />
        {/* Pot & soil */}
        <g id="bonsai-pot">
          <path d="M 120,380 C 120,380 130,418 142,420 C 160,422 280,422 298,420 C 310,418 320,380 320,380 Z" fill="url(#potGradient)" />
          <rect x="114" y="372" width="212" height="12" rx="4" fill="url(#potRim)" />
          <rect x="116" y="373" width="208" height="3" rx="1.5" fill="#E88F6E" opacity="0.4" />
          <rect x="145" y="418" width="16" height="4" rx="2" fill="#75351E" />
          <rect x="279" y="418" width="16" height="4" rx="2" fill="#75351E" />
          <ellipse cx="220" cy="374" rx="98" ry="12" fill={soilFill} />
          <ellipse cx="165" cy="374" rx="22" ry="6" fill="url(#mossGradient)" opacity={mossDim ? 0.6 : 0.9} />
          <ellipse cx="275" cy="373" rx="25" ry="7" fill="url(#mossGradient)" opacity={mossDim ? 0.55 : 0.85} />
          <ellipse cx="220" cy="376" rx="35" ry="5" fill="url(#mossGradient)" opacity={mossDim ? 0.5 : 0.75} />
          <SoilEffects effects={look.effects} soil={look.soil} />
          <rect x="213" y="394" width="14" height="14" rx="2" fill="#7A3922" opacity="0.6" />
          <path d="M 217,398 L 223,398 M 220,398 L 220,404 M 217,404 L 223,404" stroke="#C86D4B" strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />
        </g>
        {/* Lucy, the household dog: on the floor in front of the stand and the pot, never in the tree */}
        <Lucy lucy={expression?.lucy ?? null} lookToward={expression?.lucy?.lookAt === 'squirrel' ? squirrelAt : expression?.lucy?.lookAt === 'dragonfly' && dragonfly ? dragonflyAt(flight, riderSpot) : null} />

        {/* The living tree: gestures move it from the base of the trunk; filters tint it whole */}
        <g className={gestureClass} style={pivot}>
          <g ref={petting.leanRef}>
          <g filter={look.filter ? FILTER_URL[look.filter] : undefined}>
            {/* Roots, trunk & face (the trunk breathes) */}
            <g id="bonsai-trunk">
              <path d="M 185,375 C 180,360 170,350 160,375 C 168,377 180,378 185,375 Z" fill="url(#barkGradient)" />
              <path d="M 255,375 C 260,360 270,348 280,375 C 272,377 260,378 255,375 Z" fill="url(#barkGradient)" />
              <g className="trunk-breathe" style={pivot}>
                <path
                  d="M 175,374 C 165,340 160,310 180,270 C 192,246 195,215 190,185 C 195,160 215,145 220,130 C 225,145 240,165 240,190 C 240,225 258,255 265,285 C 272,320 270,350 265,374 Z"
                  fill="url(#barkGradient)"
                />
                <path d="M 188,365 C 178,335 178,310 192,275 C 200,255 204,230 200,195" stroke="url(#barkHighlight)" strokeWidth="3.5" strokeLinecap="round" fill="none" opacity="0.65" />
                <path d="M 245,360 C 255,330 252,295 244,265 C 238,245 236,220 238,190" stroke="#4A3326" strokeWidth="2.5" strokeLinecap="round" fill="none" opacity="0.7" />
                <path d="M 218,368 C 215,330 212,290 222,250" stroke="#9C7356" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.4" />
                <AvatarFace look={look} blinking={isBlinking} gaze={gaze} />
              </g>
            </g>

            {/* Branches */}
            <g id="bonsai-branches">
              <path d="M 185,250 C 160,240 135,225 105,210 C 120,215 145,230 178,238 Z" fill="url(#barkGradient)" />
              <path d="M 140,225 C 130,205 115,190 95,175" stroke="url(#barkGradient)" strokeWidth="5" strokeLinecap="round" fill="none" />
              <path d="M 255,235 C 285,225 315,205 345,185 C 330,195 300,212 260,222 Z" fill="url(#barkGradient)" />
              <path d="M 305,208 C 325,185 340,165 355,145" stroke="url(#barkGradient)" strokeWidth="5.5" strokeLinecap="round" fill="none" />
              <path d="M 205,170 C 190,140 180,110 175,80" stroke="url(#barkGradient)" strokeWidth="7" strokeLinecap="round" fill="none" />
              <path d="M 235,160 C 250,135 265,105 275,75" stroke="url(#barkGradient)" strokeWidth="7" strokeLinecap="round" fill="none" />
              <path d="M 220,140 C 220,105 220,80 220,55" stroke="url(#barkGradient)" strokeWidth="7.5" strokeLinecap="round" fill="none" />
            </g>

            {/* A hiding visitor sits behind the pads, so only its head peeks over the leaves */}
            <Visitor visitor={visitor} pose={visitorPose} layer="behind" watchAt={watchAt} />

            {/* Foliage pads: a soft body plus individual leaves */}
            <g id="bonsai-foliage">
              <g className="canopy-droop" style={droop.left}>
                <g ref={petting.padRef(0)}>
                <g className="animate-branch-left">
                  <g>
                    <ellipse cx="105" cy="195" rx="55" ry="32" fill={palette.shadow} opacity="0.8" />
                    <path d="M 60,195 C 50,175 75,150 105,155 C 125,145 155,160 160,180 C 170,200 150,225 125,225 C 90,230 65,215 60,195 Z" fill="url(#canopyFill)" />
                    <ellipse cx="95" cy="175" rx="26" ry="14" fill="url(#canopyHi)" opacity={hiOpacity} className="animate-leaf-flutter-1" />
                    <ellipse cx="130" cy="188" rx="22" ry="12" fill="url(#canopyHi)" opacity={hiOpacity} className="animate-leaf-flutter-2" />
                  </g>
                  <PadBranchlets pad={PADS[0]} fullness={fullness} palette={palette} />
                  <PadLeaves pad={PADS[0]} foliage={look.foliage} palette={palette} droop={droopValue} effects={look.effects} seasonal={look.seasonalLeaves} canopy={look.canopy} />
                </g>
                </g>
              </g>

              <g className="canopy-droop" style={droop.right}>
                <g ref={petting.padRef(1)}>
                <g className={gesture === 'fan' ? 'gesture-fan-pad' : ''} style={{ transformOrigin: '270px 225px', transformBox: 'view-box' }}>
                  <g className="animate-branch-right">
                    <g>
                      <ellipse cx="335" cy="170" rx="60" ry="34" fill={palette.shadow} opacity="0.8" />
                      <path d="M 285,170 C 275,145 310,125 340,132 C 365,125 395,145 395,170 C 400,195 375,215 345,212 C 310,215 290,195 285,170 Z" fill="url(#canopyFill)" />
                      <ellipse cx="330" cy="155" rx="28" ry="15" fill="url(#canopyHi)" opacity={hiOpacity} className="animate-leaf-flutter-2" />
                      <ellipse cx="365" cy="170" rx="22" ry="12" fill="url(#canopyHi)" opacity={hiOpacity} className="animate-leaf-flutter-3" />
                    </g>
                    <PadBranchlets pad={PADS[1]} fullness={fullness} palette={palette} />
                  <PadLeaves pad={PADS[1]} foliage={look.foliage} palette={palette} droop={droopValue} effects={look.effects} seasonal={look.seasonalLeaves} canopy={look.canopy} />
                  </g>
                </g>
                </g>
              </g>

              <g className="canopy-droop" style={droop.top}>
                <g ref={petting.padRef(2)}>
                <g className="animate-branch-left" style={{ transformOrigin: '220px 100px' }}>
                  <g>
                    <ellipse cx="220" cy="85" rx="85" ry="46" fill={palette.shadow} opacity="0.75" />
                    <path d="M 140,85 C 135,50 180,25 220,28 C 260,25 305,50 300,85 C 305,115 270,135 220,132 C 170,135 135,115 140,85 Z" fill="url(#canopyFill)" />
                    <ellipse cx="185" cy="65" rx="36" ry="20" fill="url(#canopyHi)" opacity={hiOpacity} className="animate-leaf-flutter-1" />
                    <ellipse cx="255" cy="68" rx="34" ry="18" fill="url(#canopyHi)" opacity={hiOpacity} className="animate-leaf-flutter-2" />
                    <ellipse cx="220" cy="50" rx="38" ry="20" fill="url(#canopyHi)" opacity={hiOpacity} className="animate-leaf-flutter-3" />
                  </g>
                  <PadBranchlets pad={PADS[2]} fullness={fullness} palette={palette} />
                  <PadLeaves pad={PADS[2]} foliage={look.foliage} palette={palette} droop={droopValue} effects={look.effects} seasonal={look.seasonalLeaves} canopy={look.canopy} />
                  {/* The drey: weeks of a welcoming tree, tucked into the crown (sways with it) */}
                  <Drey stage={expression?.drey ?? 'none'} visitor={visitor} pose={visitorPose} leaf={palette.leaf[1]} />
                  {/* Young crown leaf: sprouts when thriving or recovering */}
                  <g className={sprouting ? 'animate-sprout' : ''} style={{ transformOrigin: '220px 22px' }}>
                    <path d="M 215,22 Q 220,8 225,22 Q 220,28 215,22 Z" fill={sprouting ? '#D4FFB2' : palette.leaf[0]} />
                    {sprouting && <circle cx="220" cy="12" r="3" fill="#FFF9A6" className="animate-sparkle-1" />}
                  </g>
                </g>
                </g>
              </g>
            </g>

            <BodyDetails effects={look.effects} shielding={gesture === 'shield'} shaking={gesture === 'shake_off'} />
            <Visitor visitor={visitor} pose={visitorPose} layer="front" watchAt={watchAt} />
            <SquirrelTraces traces={expression?.squirrelTraces ?? null} layer="front" />
            <Sloth sloth={expression?.sloth ?? null} strokeAt={petting.strokeAt} lookToward={squirrelAt?.x ?? null}>
              {/* Encounter: a dragonfly resting on the sloth rides along with it */}
              <Dragonfly dragonfly={dragonfly} flight={flight} rider={riderSpot} strokeAt={petting.strokeAt} onSloth />
            </Sloth>
            <Dragonfly dragonfly={dragonfly} flight={flight} rider={riderSpot} strokeAt={petting.strokeAt} />
          </g>
          </g>
        </g>

        <Lanterns effects={look.effects} />
        <ForegroundEffects effects={look.effects} palette={palette} seasonal={look.seasonalLeaves} />
        <circle ref={petting.glowRef} cx="220" cy="120" r="34" fill="url(#petHandGlow)" opacity="0" pointerEvents="none" style={{ mixBlendMode: 'screen' }} />
      </svg>

      {tapReaction && expression && (
        <div className={`absolute top-4 bg-[#2D332A]/90 text-[#FAF7F2] text-xs font-semibold px-3 py-1.5 rounded-full shadow-lg backdrop-blur-md ${strength >= 0.7 ? 'animate-bounce' : ''}`}>
          {expression.tapLabel}
        </div>
      )}
    </div>
  );
};

// Redrawn only when its props change: a toast or an opened panel leaves the tree alone (its own timers and
// pointer handlers keep it alive in between)
export const BonsaiAvatar = React.memo(BonsaiAvatarView);

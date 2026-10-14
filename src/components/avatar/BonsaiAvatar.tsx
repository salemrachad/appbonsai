import React, { useEffect, useState } from 'react';
import type { AvatarPresentation, ExpressionState } from '../../expression/expressionTypes';
import { AvatarEffects, Lanterns, SoilEffects } from './AvatarEffects';
import { AvatarFace } from './AvatarFace';
interface BonsaiAvatarProps {
  expression: ExpressionState | null;
  onClick?: () => void;
  onTouch?: () => void; // the tree was tapped (Home may reveal its current thought)
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
  leaves: 'lush',
  soil: 'moist',
  effects: [],
  animation: 'animate-tree-breathe-slow',
  halo: 'bg-[#81B29A]/10 blur-2xl',
};

// The animated bonsai character. Draws what the Expression Engine decided; never sees health or sensor values.
export const BonsaiAvatar: React.FC<BonsaiAvatarProps> = ({ expression, onClick, onTouch, className = '' }) => {
  const look = expression?.avatar ?? RESTING;
  const isWatering = look.effects.includes('rain');
  const motion = expression?.motion ?? { swaySpeed: 0.6, swayAmount: 0.5, flutter: 0.4, blinkEveryMs: 6000 };
  const strength = expression?.reactionStrength ?? 0.5;
  const [isBlinking, setIsBlinking] = useState(false);
  const [tapReaction, setTapReaction] = useState(false);

  // Blinking: livelier trees blink more often; asleep, never
  useEffect(() => {
    if (motion.blinkEveryMs === null) return;
    const every = motion.blinkEveryMs;
    const id = setInterval(() => {
      setIsBlinking(true);
      setTimeout(() => setIsBlinking(false), 220);
    }, every * (0.8 + Math.random() * 0.4));
    return () => clearInterval(id);
  }, [motion.blinkEveryMs]);

  // Touch: a responsive tree perks up visibly; a sleepy or unsure one barely stirs
  const handleInteract = () => {
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

  const droop = droopTransforms(expression?.leafDroop ?? 0.1, look.posture === 'shrink');
  const motionVars = {
    '--sway-speed': motion.swaySpeed,
    '--sway-amp': motion.swayAmount,
    '--flutter-amp': motion.flutter,
  } as React.CSSProperties;
  const dryLeaves = look.leaves === 'dry';
  const fillCanopy = dryLeaves ? 'url(#canopyThirsty)' : 'url(#canopyLush)';
  const fillHighlight = dryLeaves ? '#8A9A78' : 'url(#canopyHighlight)';
  const leafTip = dryLeaves ? '#9EAA8E' : '#A8D59D';
  const crownTip = dryLeaves ? '#9EAA8E' : '#B2DE9F';
  const sprouting = look.effects.includes('sprout');
  const animation = tapReaction ? (strength >= 0.7 ? 'transition-transform duration-300 scale-105 -rotate-1' : 'transition-transform duration-500 scale-[1.02]') : look.animation;
  const soilFill = look.soil === 'dry' ? 'url(#soilGradientDry)' : look.soil === 'wet' ? 'url(#soilGradientWet)' : 'url(#soilGradientMoist)';

  return (
    <div
      id="bonsai-avatar-container"
      onClick={handleInteract}
      className={`relative flex items-center justify-center select-none cursor-pointer transition-all duration-500 ${className}`}
      title="Touch the tree"
    >
      <div className={`absolute w-72 h-72 rounded-full pointer-events-none transition-all duration-700 ${look.halo}`} />

      <svg
        viewBox="0 0 440 460"
        className={`w-full h-full drop-shadow-md transition-transform duration-500 ${animation}`}
        style={{ transformOrigin: '220px 420px', ...motionVars }}
      >
        <defs>
          <linearGradient id="canopyLush" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#5A7A50" />
            <stop offset="60%" stopColor="#4A6741" />
            <stop offset="100%" stopColor="#334D2E" />
          </linearGradient>
          <linearGradient id="canopyHighlight" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#7E9F74" />
            <stop offset="100%" stopColor="#4A6741" />
          </linearGradient>
          <linearGradient id="canopyThirsty" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#969F86" />
            <stop offset="60%" stopColor="#768466" />
            <stop offset="100%" stopColor="#525E45" />
          </linearGradient>
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
          <linearGradient id="mossGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={dryLeaves ? '#858F6F' : '#5E8348'} />
            <stop offset="100%" stopColor={dryLeaves ? '#5D664D' : '#3C5C2A'} />
          </linearGradient>
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

        {/* Pot & soil */}
        <g id="bonsai-pot">
          <path d="M 120,380 C 120,380 130,418 142,420 C 160,422 280,422 298,420 C 310,418 320,380 320,380 Z" fill="url(#potGradient)" />
          <rect x="114" y="372" width="212" height="12" rx="4" fill="url(#potRim)" />
          <rect x="116" y="373" width="208" height="3" rx="1.5" fill="#E88F6E" opacity="0.4" />
          <rect x="145" y="418" width="16" height="4" rx="2" fill="#75351E" />
          <rect x="279" y="418" width="16" height="4" rx="2" fill="#75351E" />
          <ellipse cx="220" cy="374" rx="98" ry="12" fill={soilFill} />
          <ellipse cx="165" cy="374" rx="22" ry="6" fill="url(#mossGradient)" opacity={dryLeaves ? 0.6 : 0.9} />
          <ellipse cx="275" cy="373" rx="25" ry="7" fill="url(#mossGradient)" opacity={dryLeaves ? 0.55 : 0.85} />
          <ellipse cx="220" cy="376" rx="35" ry="5" fill="url(#mossGradient)" opacity={dryLeaves ? 0.5 : 0.75} />
          <SoilEffects effects={look.effects} />
          <rect x="213" y="394" width="14" height="14" rx="2" fill="#7A3922" opacity="0.6" />
          <path d="M 217,398 L 223,398 M 220,398 L 220,404 M 217,404 L 223,404" stroke="#C86D4B" strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />
        </g>

        {/* Roots, trunk & face */}
        <g id="bonsai-trunk">
          <path d="M 185,375 C 180,360 170,350 160,375 C 168,377 180,378 185,375 Z" fill="url(#barkGradient)" />
          <path d="M 255,375 C 260,360 270,348 280,375 C 272,377 260,378 255,375 Z" fill="url(#barkGradient)" />
          <path
            d="M 175,374 C 165,340 160,310 180,270 C 192,246 195,215 190,185 C 195,160 215,145 220,130 C 225,145 240,165 240,190 C 240,225 258,255 265,285 C 272,320 270,350 265,374 Z"
            fill="url(#barkGradient)"
          />
          <path d="M 188,365 C 178,335 178,310 192,275 C 200,255 204,230 200,195" stroke="url(#barkHighlight)" strokeWidth="3.5" strokeLinecap="round" fill="none" opacity="0.65" />
          <path d="M 245,360 C 255,330 252,295 244,265 C 238,245 236,220 238,190" stroke="#4A3326" strokeWidth="2.5" strokeLinecap="round" fill="none" opacity="0.7" />
          <path d="M 218,368 C 215,330 212,290 222,250" stroke="#9C7356" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.4" />
          <AvatarFace look={look} blinking={isBlinking} />
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

        {/* Foliage pads */}
        <g id="bonsai-foliage">
          <g className="canopy-droop" style={droop.left}>
          <g className="animate-branch-left">
            <ellipse cx="105" cy="195" rx="55" ry="32" fill="#23462F" opacity={dryLeaves ? 0.65 : 0.8} />
            <path d="M 60,195 C 50,175 75,150 105,155 C 125,145 155,160 160,180 C 170,200 150,225 125,225 C 90,230 65,215 60,195 Z" fill={fillCanopy} />
            <ellipse cx="95" cy="175" rx="26" ry="14" fill={fillHighlight} className="animate-leaf-flutter-1" />
            <ellipse cx="130" cy="188" rx="22" ry="12" fill={fillHighlight} className="animate-leaf-flutter-2" />
            <path d="M 65,170 Q 75,160 90,170 Q 75,178 65,170 Z" fill={leafTip} />
            <path d="M 142,175 Q 155,168 162,180 Q 150,185 142,175 Z" fill={leafTip} />
          </g>
          </g>

          <g className="canopy-droop" style={droop.right}>
          <g className="animate-branch-right">
            <ellipse cx="335" cy="170" rx="60" ry="34" fill="#23462F" opacity={dryLeaves ? 0.65 : 0.8} />
            <path d="M 285,170 C 275,145 310,125 340,132 C 365,125 395,145 395,170 C 400,195 375,215 345,212 C 310,215 290,195 285,170 Z" fill={fillCanopy} />
            <ellipse cx="330" cy="155" rx="28" ry="15" fill={fillHighlight} className="animate-leaf-flutter-2" />
            <ellipse cx="365" cy="170" rx="22" ry="12" fill={fillHighlight} className="animate-leaf-flutter-3" />
            <path d="M 370,145 Q 385,140 390,155 Q 378,158 370,145 Z" fill={leafTip} />
            <path d="M 295,150 Q 305,138 318,148 Q 308,155 295,150 Z" fill={leafTip} />
          </g>
          </g>

          <g className="canopy-droop" style={droop.top}>
          <g className="animate-branch-left" style={{ transformOrigin: '220px 100px' }}>
            <ellipse cx="220" cy="85" rx="85" ry="46" fill="#1C3826" opacity={dryLeaves ? 0.6 : 0.75} />
            <path d="M 140,85 C 135,50 180,25 220,28 C 260,25 305,50 300,85 C 305,115 270,135 220,132 C 170,135 135,115 140,85 Z" fill={fillCanopy} />
            <ellipse cx="185" cy="65" rx="36" ry="20" fill={fillHighlight} className="animate-leaf-flutter-1" />
            <ellipse cx="255" cy="68" rx="34" ry="18" fill={fillHighlight} className="animate-leaf-flutter-2" />
            <ellipse cx="220" cy="50" rx="38" ry="20" fill={fillHighlight} className="animate-leaf-flutter-3" />
            {/* Young crown leaf: sprouts when thriving or recovering */}
            <g className={sprouting ? 'animate-sprout' : ''} style={{ transformOrigin: '220px 22px' }}>
              <path d="M 215,22 Q 220,8 225,22 Q 220,28 215,22 Z" fill={sprouting ? '#D4FFB2' : '#C5E8B7'} />
              {sprouting && <circle cx="220" cy="12" r="3" fill="#FFF9A6" className="animate-sparkle-1" />}
            </g>
            <path d="M 175,40 Q 185,28 195,38 Q 185,45 175,40 Z" fill={crownTip} />
            <path d="M 245,38 Q 258,30 265,42 Q 252,48 245,38 Z" fill={crownTip} />
          </g>
          </g>
        </g>

        <Lanterns effects={look.effects} />
      </svg>

      {tapReaction && expression && (
        <div className={`absolute top-4 bg-[#2D332A]/90 text-[#FAF7F2] text-xs font-semibold px-3 py-1.5 rounded-full shadow-lg backdrop-blur-md ${strength >= 0.7 ? 'animate-bounce' : ''}`}>
          {expression.tapLabel}
        </div>
      )}
    </div>
  );
};

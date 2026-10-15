import React from 'react';
import { AvatarPresentation } from './avatarStates';

const INK = '#2C1D11';
const BARK = '#6B5E4F';

const BLUSH: Record<AvatarPresentation['blush'], { fill: string; opacity: number; r: number }> = {
  normal: { fill: '#F4A261', opacity: 0.35, r: 7 },
  happy: { fill: '#FF8FA3', opacity: 0.75, r: 8.5 },
  hot: { fill: '#FF6B6B', opacity: 0.85, r: 8 },
  cold: { fill: '#9FA8DA', opacity: 0.6, r: 7 },
  pale: { fill: '#D4A373', opacity: 0.3, r: 6.5 },
  none: { fill: '#000000', opacity: 0, r: 0 },
};

// Eye centres
const L = { x: 203, y: 280 };
const R = { x: 237, y: 280 };

type Gaze = { x: number; y: number };

// Pupils follow the gaze; brows and lids stay put, so a look reads as the eyes moving, not the face.
function Pupils({ r, gaze, shine = 2, lower = 0 }: { r: number; gaze: Gaze; shine?: number; lower?: number }) {
  return (
    <g style={{ transform: `translate(${gaze.x}px, ${gaze.y + lower}px)`, transition: 'transform 180ms cubic-bezier(0.3, 0.7, 0.4, 1)' }}>
      {[L, R].map((e, i) => (
        <g key={i}>
          <circle cx={e.x} cy={e.y} r={r} fill={INK} />
          {shine > 0 && <circle cx={e.x - r * 0.3} cy={e.y - r * 0.35} r={shine} fill="#FFFFFF" />}
          {shine > 1.5 && <circle cx={e.x + r * 0.28} cy={e.y + r * 0.3} r={shine * 0.45} fill="#FFFFFF" opacity="0.85" />}
        </g>
      ))}
    </g>
  );
}

const arc = (cx: number, y: number, up: boolean, w = 7, h = 6) => `M ${cx - w},${y} Q ${cx},${up ? y - h : y + h} ${cx + w},${y}`;

function Eyes({ style, blinking, gaze }: { style: AvatarPresentation['eyes']; blinking: boolean; gaze: Gaze }) {
  if (blinking || style === 'closed') {
    return (
      <g stroke={INK} strokeWidth="2.8" strokeLinecap="round" fill="none">
        <path d={arc(L.x, 281, true, 7, 5)} />
        <path d={arc(R.x, 281, true, 7, 5)} />
      </g>
    );
  }
  const line = { stroke: INK, strokeLinecap: 'round' as const, fill: 'none' };
  switch (style) {
    case 'joy':
      return (
        <g {...line} strokeWidth="3">
          <path d={arc(L.x, 281, true)} />
          <path d={arc(R.x, 281, true)} />
        </g>
      );
    case 'drowsy':
      return (
        <g>
          <g clipPath="url(#lidLow)">
            <Pupils r={5} gaze={{ x: gaze.x * 0.6, y: 1 + gaze.y * 0.3 }} shine={1.2} />
          </g>
          <g {...line} strokeWidth="2.6">
            <path d={`M ${L.x - 7},280 L ${L.x + 7},280`} />
            <path d={`M ${R.x - 7},280 L ${R.x + 7},280`} />
          </g>
        </g>
      );
    case 'heavy':
      return (
        <g>
          <Pupils r={4.8} gaze={{ x: gaze.x * 0.7, y: Math.max(0, gaze.y) * 0.6 }} shine={1.4} lower={1.5} />
          {/* Lids droop toward the outer corners: tired, not cross */}
          <path d={`M ${L.x - 8},274 L ${L.x + 8},274 L ${L.x + 7},279.5 Q ${L.x},280 ${L.x - 7},282 Z`} fill={BARK} />
          <path d={`M ${R.x - 8},274 L ${R.x + 8},274 L ${R.x + 7},282 Q ${R.x},280 ${R.x - 7},279.5 Z`} fill={BARK} />
          <g {...line} strokeWidth="1.8">
            <path d={`M ${L.x - 7},282 Q ${L.x},280 ${L.x + 7},279.5`} />
            <path d={`M ${R.x - 7},279.5 Q ${R.x},280 ${R.x + 7},282`} />
          </g>
        </g>
      );
    case 'alert':
      return (
        <g>
          <Pupils r={6.5} gaze={gaze} shine={2.4} />
          <g {...line} strokeWidth="2">
            <path d={arc(L.x, 269, true, 6, 2.5)} />
            <path d={arc(R.x, 269, true, 6, 2.5)} />
          </g>
        </g>
      );
    case 'wide':
      return (
        <g>
          <circle cx={L.x} cy={L.y} r="7.5" fill="#FFFFFF" stroke={INK} strokeWidth="1.6" />
          <circle cx={R.x} cy={R.y} r="7.5" fill="#FFFFFF" stroke={INK} strokeWidth="1.6" />
          <Pupils r={3} gaze={{ x: gaze.x * 0.8, y: gaze.y * 0.8 }} shine={0.9} />
          <g {...line} strokeWidth="2.2">
            <path d={`M ${L.x - 7},267 L ${L.x + 6},269`} />
            <path d={`M ${R.x + 7},267 L ${R.x - 6},269`} />
          </g>
        </g>
      );
    case 'pleading':
      return (
        <g>
          <Pupils r={6.8} gaze={{ x: gaze.x * 0.5, y: Math.min(gaze.y, -1) }} shine={2.8} />
          {/* tears welling on the lower lids */}
          <path d={`M ${L.x - 6},286 Q ${L.x},289 ${L.x + 6},286`} stroke="#8FD3FF" strokeWidth="2" fill="none" opacity="0.9" strokeLinecap="round" />
          <path d={`M ${R.x - 6},286 Q ${R.x},289 ${R.x + 6},286`} stroke="#8FD3FF" strokeWidth="2" fill="none" opacity="0.9" strokeLinecap="round" />
          <g {...line} strokeWidth="2.2">
            <path d={`M ${L.x - 7},274 L ${L.x + 5},268`} />
            <path d={`M ${R.x + 7},274 L ${R.x - 5},268`} />
          </g>
        </g>
      );
    case 'sad':
      return (
        <g>
          <Pupils r={5} gaze={gaze} shine={1.8} lower={1} />
          <g {...line} strokeWidth="2">
            <path d={`M ${L.x - 6},272 L ${L.x + 5},276`} />
            <path d={`M ${R.x + 6},272 L ${R.x - 5},276`} />
          </g>
        </g>
      );
    case 'worried':
      return (
        <g>
          <Pupils r={5.5} gaze={gaze} shine={2} />
          <g {...line} strokeWidth="2">
            <path d={`M ${L.x - 7},271 Q ${L.x - 1},267 ${L.x + 5},273`} />
            <path d={`M ${R.x + 7},271 Q ${R.x + 1},267 ${R.x - 5},273`} />
          </g>
        </g>
      );
    case 'swirl':
      return (
        <g {...line} strokeWidth="1.9" className="animate-eye-swirl">
          {[L, R].map((e, i) => (
            <path
              key={i}
              d={`M ${e.x},${e.y} m 0,-1 a 1,1 0 1 1 -1,1 a 2.5,2.5 0 1 1 3.5,-1.5 a 4.5,4.5 0 1 1 -6.5,3`}
              style={{ transformOrigin: `${e.x}px ${e.y}px`, transformBox: 'view-box' }}
            />
          ))}
        </g>
      );
    case 'squint_hard':
      return (
        <g {...line} strokeWidth="2.6">
          <path d="M 197,276 L 207,281 L 197,286" />
          <path d="M 243,276 L 233,281 L 243,286" />
        </g>
      );
    case 'squint_soft':
      return (
        <g {...line} strokeWidth="2.8">
          <path d={arc(L.x, 281, true, 7, 2.5)} />
          <path d={arc(R.x, 281, true, 7, 2.5)} />
        </g>
      );
    case 'unsure':
      return (
        <g>
          <Pupils r={5} gaze={gaze} shine={1.8} />
          <g {...line} strokeWidth="2">
            <path d={`M ${L.x - 6},275 L ${L.x + 6},275`} />
            <path d={`M ${R.x - 7},270 Q ${R.x},265 ${R.x + 7},270`} />
          </g>
        </g>
      );
    case 'happy':
    default:
      return <Pupils r={5.5} gaze={gaze} shine={2} />;
  }
}

function Mouth({ style }: { style: AvatarPresentation['mouth'] }) {
  const line = { stroke: INK, strokeLinecap: 'round' as const, fill: 'none' };
  switch (style) {
    case 'grin':
      return (
        <g>
          <path d="M 212,291 Q 220,305 228,291 Z" fill="#B93A3A" stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M 215,297 Q 220,302 225,297" fill="#F28B82" />
        </g>
      );
    case 'chatter':
      return (
        <g className="animate-chatter" style={{ transformOrigin: '220px 294px', transformBox: 'view-box' }}>
          <rect x="212" y="290" width="16" height="7" rx="2.5" fill="#3A2416" />
          <path d="M 213,293.5 L 227,293.5 M 216.5,290.5 L 216.5,296.5 M 220,290.5 L 220,296.5 M 223.5,290.5 L 223.5,296.5" stroke="#F4EFE6" strokeWidth="1.3" />
        </g>
      );
    case 'pant':
      return (
        <g className="animate-pant-mouth" style={{ transformOrigin: '220px 292px', transformBox: 'view-box' }}>
          <path d="M 213,291 Q 220,301 227,291 Z" fill="#7A2E2E" stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M 216.5,295 Q 220,303 223.5,295 Z" fill="#F07C7C" />
        </g>
      );
    case 'frown':
      return <path d="M 214,296 Q 220,290 226,296" {...line} strokeWidth="2.4" />;
    case 'wobble':
      return <path d="M 213,295 Q 216,291 219,295 Q 222,299 225,295 Q 227,292 228,294" {...line} strokeWidth="2.2" className="animate-wobble-mouth" />;
    case 'parched':
      return (
        <g>
          <ellipse cx="220" cy="294.5" rx="4" ry="2.6" fill="#3A2416" />
          <path d="M 214.5,292.5 Q 220,290 225.5,292.5" stroke="#B89A7A" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        </g>
      );
    case 'pucker':
      return (
        <g>
          <ellipse cx="220" cy="294" rx="3" ry="3.2" fill="none" stroke={INK} strokeWidth="2" />
          <path d="M 216.5,291 L 215,290 M 223.5,291 L 225,290" stroke={INK} strokeWidth="1.2" strokeLinecap="round" />
        </g>
      );
    case 'queasy':
      return (
        <g>
          <path d="M 212,294 Q 214.5,291 217,294 Q 219.5,297 222,294 Q 224.5,291 227,294" {...line} strokeWidth="2.2" />
          <circle cx="210" cy="292" r="3.2" fill="#A7D3A6" opacity="0.55" />
          <circle cx="230" cy="292" r="3.2" fill="#A7D3A6" opacity="0.55" />
        </g>
      );
    case 'gasp':
      return <ellipse cx="220" cy="294.5" rx="3.2" ry="4" fill="#3A2416" />;
    case 'yawn':
      return (
        <g>
          <ellipse cx="220" cy="296" rx="5.5" ry="7.5" fill="#3A2416" />
          <ellipse cx="220" cy="300" rx="3.5" ry="2.8" fill="#E57373" />
        </g>
      );
    case 'sleep':
      return <path d="M 217,293 Q 220,296 223,293" {...line} strokeWidth="2" />;
    case 'flat':
      return <path d="M 215,294 L 225,294" {...line} strokeWidth="2.2" />;
    case 'smile':
    default:
      return <path d="M 214,291 Q 220,298 226,291" {...line} strokeWidth="2.2" />;
  }
}

export const AvatarFace: React.FC<{ look: AvatarPresentation; blinking: boolean; gaze: Gaze }> = ({ look, blinking, gaze }) => {
  const blush = BLUSH[look.blush];
  return (
    <g id="bonsai-face">
      <defs>
        <clipPath id="lidLow">
          <rect x="190" y="280" width="60" height="14" />
        </clipPath>
      </defs>
      {blush.r > 0 && (
        <>
          <circle cx="195" cy="292" r={blush.r} fill={blush.fill} opacity={blush.opacity} className={look.blush === 'hot' ? 'animate-flush' : ''} />
          <circle cx="245" cy="292" r={blush.r} fill={blush.fill} opacity={blush.opacity} className={look.blush === 'hot' ? 'animate-flush' : ''} />
        </>
      )}
      {look.sweat && (
        <path
          d="M 248,270 C 248,270 253,278 253,282 C 253,285 250,287 248,287 C 246,287 243,285 243,282 C 243,278 248,270 248,270 Z"
          fill="#64B5F6"
          className="animate-sweat"
        />
      )}
      <Eyes style={look.eyes} blinking={blinking} gaze={gaze} />
      <Mouth style={look.mouth} />
    </g>
  );
};

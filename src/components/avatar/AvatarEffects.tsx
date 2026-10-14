import React from 'react';
import { AvatarEffect } from './avatarStates';

const RAYS = [0, 45, 90, 135, 180, 225, 270, 315];
const snowflake = 'M -6,0 L 6,0 M 0,-6 L 0,6 M -4,-4 L 4,4 M -4,4 L 4,-4';
const sparkle = (x: number, y: number, s: number) =>
  `M ${x},${y - s} Q ${x},${y} ${x - s},${y} Q ${x},${y} ${x},${y + s} Q ${x},${y} ${x + s},${y} Q ${x},${y} ${x},${y - s}`;

// Background/foreground mood effects. Drawn inside the avatar SVG (viewBox 0 0 440 460).
export const AvatarEffects: React.FC<{ effects: AvatarEffect[] }> = ({ effects }) => {
  const has = (e: AvatarEffect) => effects.includes(e);
  return (
    <>
      {has('moon_zzz') && (
        <g className="opacity-90">
          <path d="M 330,60 A 22,22 0 0 0 352,38 A 18,18 0 1 1 330,60 Z" fill="#F4E8C1" opacity="0.85" />
          <text x="250" y="240" fill="#90A4AE" fontSize="13" fontWeight="700" className="animate-zzz-1">z</text>
          <text x="264" y="224" fill="#90A4AE" fontSize="16" fontWeight="700" className="animate-zzz-2">Z</text>
        </g>
      )}

      {has('bright_sun') && !has('hot_sun') && (
        <g className="animate-pulse-halo" style={{ transformOrigin: '350px 55px' }}>
          <circle cx="350" cy="55" r="14" fill="#F9D776" />
          <g stroke="#F2C14E" strokeWidth="3" strokeLinecap="round">
            {RAYS.map((a) => {
              const r = (a * Math.PI) / 180;
              return <line key={a} x1={350 + Math.cos(r) * 20} y1={55 + Math.sin(r) * 20} x2={350 + Math.cos(r) * 28} y2={55 + Math.sin(r) * 28} />;
            })}
          </g>
        </g>
      )}

      {has('hot_sun') && (
        <g transform="translate(340, 50)" className="animate-pulse-halo">
          <circle r="18" fill="#F4A261" opacity="0.8" />
          <circle r="12" fill="#E76F51" />
          {RAYS.map((a) => (
            <line key={a} y1="-22" y2="-26" stroke="#E76F51" strokeWidth="2.5" strokeLinecap="round" transform={`rotate(${a})`} />
          ))}
        </g>
      )}

      {has('heat_waves') && (
        <g stroke="#E07A5F" fill="none" strokeLinecap="round">
          <path d="M 120,75 Q 125,65 130,75 T 140,75" strokeWidth="2.5" className="animate-heat-wave-1" />
          <path d="M 285,70 Q 290,60 295,70 T 305,70" strokeWidth="2.5" className="animate-heat-wave-2" />
          <path d="M 205,45 Q 210,35 215,45 T 225,45" strokeWidth="2" className="animate-heat-wave-1" />
        </g>
      )}

      {has('sparkles') && (
        <g>
          <path d={sparkle(115, 122, 12)} fill="#F9D776" className="animate-sparkle-1" />
          <path d={sparkle(325, 135, 10)} fill="#98D8AA" className="animate-sparkle-2" />
          <path d={sparkle(220, 75, 10)} fill="#FFEBB2" className="animate-sparkle-3" />
          <path d={sparkle(160, 172, 7)} fill="#F9D776" className="animate-sparkle-2" />
        </g>
      )}

      {has('snow') && (
        <g stroke="#A2D2FF" strokeWidth="1.8" strokeLinecap="round">
          <g transform="translate(110, 140)" className="animate-snow-1"><path d={snowflake} /></g>
          <g transform="translate(320, 110)" className="animate-snow-2"><path d={snowflake} stroke="#BDE0FE" strokeWidth="2" /></g>
          <g transform="translate(220, 40)" className="animate-snow-3"><path d={snowflake} /></g>
          <g transform="translate(150, 240)" className="animate-snow-2"><circle r="2.5" fill="#FFFFFF" stroke="none" opacity="0.9" /></g>
        </g>
      )}

      {has('frost') && (
        <g opacity="0.7">
          <path d="M 116,372 L 324,372" stroke="#DDEEFF" strokeWidth="3" strokeLinecap="round" strokeDasharray="2 6" />
          <g transform="translate(90, 300)" className="animate-snow-1"><path d={snowflake} stroke="#CFE8FF" strokeWidth="2" /></g>
          <g transform="translate(350, 290)" className="animate-snow-3"><path d={snowflake} stroke="#CFE8FF" strokeWidth="2" /></g>
        </g>
      )}

      {has('water_badge') && !has('rain') && (
        <g className="animate-water-badge" style={{ transformOrigin: '335px 235px' }}>
          <circle cx="335" cy="245" r="16" fill="#FFFFFF" opacity="0.9" filter="url(#softShadow)" />
          <path
            d="M 335,233 C 335,233 344,245 344,251 C 344,256 340,260 335,260 C 330,260 326,256 326,251 C 326,245 335,233 335,233 Z"
            fill="url(#waterDropGrad)"
          />
          <circle cx="332" cy="249" r="2" fill="#FFFFFF" opacity="0.8" />
        </g>
      )}

      {has('mist') && (
        <g fill="#B8C7D1" opacity="0.35">
          <ellipse cx="120" cy="250" rx="40" ry="8" className="animate-heat-wave-1" />
          <ellipse cx="320" cy="230" rx="46" ry="9" className="animate-heat-wave-2" />
          <ellipse cx="220" cy="20" rx="60" ry="8" className="animate-heat-wave-1" />
        </g>
      )}

      {has('dry_wind') && (
        <g stroke="#C9B48F" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.8">
          <path d="M 60,120 Q 85,112 110,120 T 150,118" className="animate-heat-wave-1" />
          <path d="M 300,250 Q 325,242 350,250 T 390,248" className="animate-heat-wave-2" />
          <path d="M 70,280 Q 90,274 110,280" className="animate-heat-wave-2" />
        </g>
      )}

      {has('question') && (
        <g className="animate-water-badge" style={{ transformOrigin: '335px 240px' }}>
          <circle cx="335" cy="240" r="16" fill="#FFFFFF" opacity="0.9" filter="url(#softShadow)" />
          <text x="335" y="247" textAnchor="middle" fontSize="20" fontWeight="700" fill="#6B7A8F">?</text>
        </g>
      )}

      {has('rain') && (
        <g strokeLinecap="round">
          <path d="M 170,120 L 165,155" stroke="#48CAE4" strokeWidth="3" className="animate-water-drop" />
          <path d="M 220,90 L 216,130" stroke="#48CAE4" strokeWidth="3.5" className="animate-water-drop" style={{ animationDelay: '0.2s' }} />
          <path d="M 270,110 L 266,150" stroke="#48CAE4" strokeWidth="3" className="animate-water-drop" style={{ animationDelay: '0.4s' }} />
          <path d="M 195,140 L 192,175" stroke="#90E0EF" strokeWidth="2.5" className="animate-water-drop" style={{ animationDelay: '0.1s' }} />
          <path d="M 245,135 L 242,170" stroke="#90E0EF" strokeWidth="2.5" className="animate-water-drop" style={{ animationDelay: '0.35s' }} />
        </g>
      )}
    </>
  );
};

// Drawn on top of the soil: standing water when the pot is waterlogged.
export const SoilEffects: React.FC<{ effects: AvatarEffect[] }> = ({ effects }) =>
  effects.includes('puddle') ? (
    <g>
      <ellipse cx="200" cy="373" rx="34" ry="4.5" fill="#5DA9E9" opacity="0.55" />
      <ellipse cx="262" cy="374" rx="20" ry="3.5" fill="#5DA9E9" opacity="0.45" />
      <circle cx="190" cy="371" r="1.5" fill="#FFFFFF" opacity="0.8" />
    </g>
  ) : null;

interface LanternProps {
  x: number; // where the string ties to the branch
  y: number;
  len: number; // string length
  s?: number; // scale
  delay?: number; // animation offset so lanterns don't move in sync
}

function Lantern({ x, y, len, s = 1, delay = 0 }: LanternProps) {
  const top = y + len;
  const cy = top + 4 * s + 13 * s;
  const rib = { fill: 'none', stroke: '#8E1F17', strokeWidth: s, opacity: 0.55 };
  return (
    <g className="animate-lantern-sway" style={{ transformOrigin: `${x}px ${y}px`, animationDelay: `${-delay}s` }}>
      <circle cx={x} cy={cy} r={58 * s} fill="url(#lanternGlow)" className="animate-lantern-glow" style={{ animationDelay: `${-delay * 0.7}s` }} />
      <line x1={x} y1={y} x2={x} y2={top} stroke="#3A2A1C" strokeWidth="1.2" />
      <rect x={x - 6 * s} y={top} width={12 * s} height={4 * s} rx={1.5 * s} fill="#C9962E" />
      <ellipse cx={x} cy={cy} rx={13 * s} ry={14 * s} fill="url(#lanternBody)" />
      <ellipse cx={x} cy={cy} rx={8 * s} ry={14 * s} {...rib} />
      <ellipse cx={x} cy={cy} rx={3 * s} ry={14 * s} {...rib} />
      <ellipse cx={x} cy={cy} rx={6 * s} ry={9 * s} fill="#FFD27A" opacity="0.35" className="animate-lantern-glow" />
      <rect x={x - 6 * s} y={cy + 13 * s} width={12 * s} height={4 * s} rx={1.5 * s} fill="#C9962E" />
      <circle cx={x} cy={cy + 19 * s} r={1.8 * s} fill="#C9962E" />
      <line x1={x} y1={cy + 20 * s} x2={x} y2={cy + 31 * s} stroke="#D8452F" strokeWidth={2.2 * s} strokeLinecap="round" />
    </g>
  );
}

// Red paper lanterns hanging from the branches with a soft yellow glow (too-dark mode).
// Drawn after the foliage so they hang in front of it.
export const Lanterns: React.FC<{ effects: AvatarEffect[] }> = ({ effects }) =>
  effects.includes('lanterns') ? (
    <g id="bonsai-lanterns">
      <defs>
        <radialGradient id="lanternGlow">
          <stop offset="0%" stopColor="#FFE7A3" stopOpacity="0.95" />
          <stop offset="40%" stopColor="#FFC861" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#FFC861" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="lanternBody" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#B8261C" />
          <stop offset="45%" stopColor="#F0563F" />
          <stop offset="100%" stopColor="#9E2219" />
        </linearGradient>
      </defs>
      <Lantern x={102} y={218} len={26} delay={0} />
      <Lantern x={352} y={206} len={32} delay={1.8} />
      <Lantern x={270} y={126} len={18} s={0.8} delay={3.1} />
    </g>
  ) : null;

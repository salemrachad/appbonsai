import React from 'react';
import { AvatarEffect, AvatarPresentation } from './avatarStates';
import { PAD_UNDERSIDES, type Palette } from './Foliage';

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
          {/* the moon itself is in the night sky (SceneBackdrop) */}
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
        <g transform="translate(340, 50)">
          <g className="animate-sun-throb">
            <circle r="18" fill="#F4A261" opacity="0.8" />
            <circle r="12" fill="#E76F51" />
            {RAYS.map((a) => (
              <line key={a} y1="-22" y2="-26" stroke="#E76F51" strokeWidth="2.5" strokeLinecap="round" transform={`rotate(${a})`} />
            ))}
          </g>
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

// Drawn on top of the soil: standing water, cracks in dry soil, ice on a frozen pot.
export const SoilEffects: React.FC<{ effects: AvatarEffect[]; soil: AvatarPresentation['soil'] }> = ({ effects, soil }) => (
  <g>
    {effects.includes('puddle') && (
      <g>
        <ellipse cx="200" cy="373" rx="34" ry="4.5" fill="#5DA9E9" opacity="0.55" />
        <ellipse cx="262" cy="374" rx="20" ry="3.5" fill="#5DA9E9" opacity="0.45" />
        <circle cx="190" cy="371" r="1.5" fill="#FFFFFF" opacity="0.8" />
        {/* drops landing make rings */}
        <ellipse cx="205" cy="373" rx="6" ry="1.6" fill="none" stroke="#BFE3FF" strokeWidth="1" className="animate-ripple" style={{ transformOrigin: '205px 373px' }} />
        <ellipse cx="258" cy="374" rx="5" ry="1.3" fill="none" stroke="#BFE3FF" strokeWidth="1" className="animate-ripple" style={{ transformOrigin: '258px 374px', animationDelay: '1.3s' }} />
      </g>
    )}
    {effects.includes('cracks') && (
      <g stroke="#7A5E3E" strokeWidth="1.3" strokeLinecap="round" fill="none" opacity="0.8">
        <path d="M 140,374 L 152,371 L 160,375 L 172,372" />
        <path d="M 186,377 L 196,373 L 204,378" />
        <path d="M 236,372 L 246,376 L 258,371 L 266,375" />
        <path d="M 282,376 L 292,372 L 304,374" />
        <path d="M 196,373 L 199,368 M 246,376 L 248,380" />
      </g>
    )}
    {soil === 'frozen' && (
      <g>
        <ellipse cx="220" cy="372" rx="90" ry="6" fill="#FFFFFF" opacity="0.35" />
        <path d={sparkle(170, 371, 3)} fill="#FFFFFF" className="animate-sparkle-1" />
        <path d={sparkle(262, 373, 2.5)} fill="#FFFFFF" className="animate-sparkle-2" />
      </g>
    )}
  </g>
);

// Details that belong to the tree's body (they move with it): icicles, drips, a leaf held over the eyes.
export const BodyDetails: React.FC<{ effects: AvatarEffect[]; shielding: boolean; shaking: boolean }> = ({ effects, shielding, shaking }) => {
  const has = (e: AvatarEffect) => effects.includes(e);
  return (
    <>
      {has('icicles') && (
        <g fill="url(#icicleGrad)" opacity="0.9">
          <defs>
            <linearGradient id="icicleGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#FFFFFF" />
              <stop offset="100%" stopColor="#A9D6F5" stopOpacity="0.6" />
            </linearGradient>
          </defs>
          {PAD_UNDERSIDES.map((p, i) => {
            const len = 9 + ((i * 7) % 9);
            return <path key={i} d={`M ${p.x - 3},${p.y - 2} L ${p.x + 3},${p.y - 2} L ${p.x},${p.y + len} Z`} />;
          })}
          {/* a drop of melt on one tip, now and then */}
          <circle cx={PAD_UNDERSIDES[4].x} cy={PAD_UNDERSIDES[4].y + 14} r="1.6" fill="#CFEAFF" className="animate-drip" />
        </g>
      )}
      {has('drips') && (
        <g fill="#7CC4F2">
          {PAD_UNDERSIDES.filter((_, i) => i % 2 === 0).map((p, i) => (
            <path
              key={i}
              d={`M ${p.x},${p.y} C ${p.x},${p.y} ${p.x + 2.5},${p.y + 4} ${p.x + 2.5},${p.y + 5.5} C ${p.x + 2.5},${p.y + 7} ${p.x + 1.2},${p.y + 8} ${p.x},${p.y + 8} C ${p.x - 1.2},${p.y + 8} ${p.x - 2.5},${p.y + 7} ${p.x - 2.5},${p.y + 5.5} C ${p.x - 2.5},${p.y + 4} ${p.x},${p.y} ${p.x},${p.y} Z`}
              className={shaking ? 'animate-drip-fast' : 'animate-drip'}
              style={{ animationDelay: `${(i * 0.9) % 3.2}s`, transformOrigin: `${p.x}px ${p.y}px` }}
            />
          ))}
        </g>
      )}
      {has('leaf_visor') && (
        <g className={shielding ? 'visor-lower' : 'visor-rest'} style={{ transformOrigin: '262px 262px', transformBox: 'view-box' }}>
          <ellipse cx="220" cy="275" rx="30" ry="8" fill="#000000" opacity="0.12" />
          <path d="M 186,266 Q 214,248 258,258 Q 240,270 186,266 Z" fill="#5FA048" stroke="#357A2E" strokeWidth="1" />
          <path d="M 192,264 Q 222,257 252,259" stroke="#357A2E" strokeWidth="0.8" fill="none" opacity="0.6" />
          <path d="M 258,258 Q 262,262 262,268" stroke="#5A4E40" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        </g>
      )}
    </>
  );
};

// Leaves that let go, drift and land; breath in the cold; fireflies; a little cloud of worry; visitors.
export const ForegroundEffects: React.FC<{ effects: AvatarEffect[]; palette: Palette; seasonal: AvatarPresentation['seasonalLeaves'] }> = ({
  effects,
  palette: pal,
  seasonal,
}) => {
  const has = (e: AvatarEffect) => effects.includes(e);
  const autumnal = has('yellow_leaves') || seasonal.yellowing >= 0.3;
  const fallColors = autumnal ? ['#E2C35A', '#D9A93F', pal.leaf[1]] : [pal.leaf[0], '#B59A5A', pal.leaf[1]];
  // A stress lets three leaves go; the season lets up to three go, more of them the nearer the peak
  const falling = has('falling_leaves') ? 3 : seasonal.leafDrop >= 0.15 ? Math.ceil(3 * seasonal.leafDrop) : 0;
  return (
    <>
      {falling > 0 && (
        <g>
          {[
            { x: 100, y: 215, d: 0, dur: 9 },
            { x: 345, y: 205, d: 3.4, dur: 10.5 },
            { x: 250, y: 125, d: 6.1, dur: 11.5 },
          ].slice(0, falling).map((l, i) => (
            <g key={i} transform={`translate(${l.x} ${l.y})`}>
              <g className="animate-leaf-fall" style={{ animationDelay: `${l.d}s`, animationDuration: `${l.dur}s` }}>
                <path d="M -6,0 Q -1,-4.5 6,0 Q -1,4.5 -6,0 Z" fill={fallColors[i]} />
              </g>
            </g>
          ))}
        </g>
      )}

      {has('night_mist') && (
        // A humid night: a soft mist bank lying low around the pot and the stand, drifting slowly
        <g pointerEvents="none" aria-hidden>
          <defs>
            <filter id="nightMistBlur" x="-20%" y="-100%" width="140%" height="300%">
              <feGaussianBlur stdDeviation="7" />
            </filter>
          </defs>
          <g filter="url(#nightMistBlur)" fill="#D3DEE8">
            <ellipse cx="220" cy="404" rx="200" ry="17" opacity="0.55" className="night-mist-1" />
            <ellipse cx="140" cy="372" rx="105" ry="11" opacity="0.4" className="night-mist-2" />
            <ellipse cx="315" cy="360" rx="85" ry="9" opacity="0.32" className="night-mist-1" style={{ animationDelay: '-9s' }} />
            <ellipse cx="225" cy="62" rx="130" ry="9" opacity="0.2" className="night-mist-2" style={{ animationDelay: '-5s' }} />
          </g>
        </g>
      )}

      {has('dew') && (
        // Now and then a drop of dew lets go of a leaf and falls
        <g fill="#CFE7F7">
          {PAD_UNDERSIDES.filter((_, i) => i % 3 === 1).slice(0, 3).map((p, i) => (
            <path
              key={i}
              d={`M ${p.x},${p.y} C ${p.x},${p.y} ${p.x + 2},${p.y + 3.4} ${p.x + 2},${p.y + 4.6} C ${p.x + 2},${p.y + 5.8} ${p.x + 1},${p.y + 6.6} ${p.x},${p.y + 6.6} C ${p.x - 1},${p.y + 6.6} ${p.x - 2},${p.y + 5.8} ${p.x - 2},${p.y + 4.6} C ${p.x - 2},${p.y + 3.4} ${p.x},${p.y} ${p.x},${p.y} Z`}
              className="dew-fall"
              style={{ animationDelay: `${i * 3.7}s`, transformOrigin: `${p.x}px ${p.y}px` }}
            />
          ))}
        </g>
      )}

      {has('breath_vapor') && (
        <g fill="#FFFFFF">
          {[0, 1.1, 2.2].map((d, i) => (
            <circle key={i} cx="232" cy="296" r="4" className="animate-breath" style={{ animationDelay: `${d}s`, transformOrigin: '232px 296px' }} />
          ))}
        </g>
      )}

      {has('sweat_drops') && (
        <g fill="#7CC4F2">
          <path d="M 186,270 q -3,4 0,7 q 3,-3 0,-7 z" className="animate-sweat-fly-left" style={{ transformOrigin: '186px 272px' }} />
          <path d="M 256,268 q -3,4 0,7 q 3,-3 0,-7 z" className="animate-sweat-fly-right" style={{ transformOrigin: '256px 270px', animationDelay: '0.7s' }} />
        </g>
      )}

      {has('fireflies') && (
        <g fill="#FFF3A3">
          {[
            { x: 70, y: 150, d: 0 },
            { x: 380, y: 120, d: 1.7 },
            { x: 300, y: 300, d: 3.1 },
            { x: 140, y: 300, d: 4.4 },
            { x: 230, y: 20, d: 2.4 },
          ].map((f, i) => (
            <g key={i} transform={`translate(${f.x} ${f.y})`}>
              <g className="animate-firefly" style={{ animationDelay: `${-f.d}s`, animationDuration: `${7 + i}s` }}>
                <circle r="6" fill="#FFE97A" opacity="0.25" />
                <circle r="1.8" />
              </g>
            </g>
          ))}
        </g>
      )}

      {has('gloom_cloud') && (
        <g className="animate-cloud-bob" style={{ transformOrigin: '220px 0px' }}>
          <g fill="#8C8496" opacity="0.85">
            <ellipse cx="205" cy="2" rx="22" ry="12" />
            <ellipse cx="228" cy="-4" rx="20" ry="14" />
            <ellipse cx="246" cy="4" rx="16" ry="10" />
          </g>
          <g stroke="#9DB3C8" strokeWidth="1.6" strokeLinecap="round">
            <path d="M 208,16 L 205,24" className="animate-water-drop" />
            <path d="M 228,16 L 225,24" className="animate-water-drop" style={{ animationDelay: '0.4s' }} />
            <path d="M 244,15 L 241,23" className="animate-water-drop" style={{ animationDelay: '0.8s' }} />
          </g>
        </g>
      )}

      {has('butterfly') && (
        <g className="animate-butterfly-path">
          <g className="animate-butterfly-wings" style={{ transformOrigin: '0px 0px' }}>
            <path d="M 0,0 C -9,-10 -14,-2 -8,3 C -5,6 -2,3 0,0 Z" fill="#F4A261" />
            <path d="M 0,0 C 9,-10 14,-2 8,3 C 5,6 2,3 0,0 Z" fill="#E76F51" />
          </g>
          <ellipse cx="0" cy="0" rx="1" ry="4" fill="#3A2A1C" />
        </g>
      )}

      {has('pollen') && (
        <g fill="#FFF1A8">
          {[
            { x: 130, y: 260, d: 0 },
            { x: 300, y: 250, d: 2 },
            { x: 210, y: 180, d: 3.6 },
            { x: 360, y: 210, d: 5.1 },
          ].map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r="1.8" className="animate-pollen" style={{ animationDelay: `${p.d}s` }} />
          ))}
        </g>
      )}
    </>
  );
};

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

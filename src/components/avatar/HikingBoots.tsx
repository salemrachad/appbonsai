import React from 'react';

// Hike day (expression.hike.boots): two pairs of hiking boots on the ground by the stand, theirs. Drawn
// only; the tree's state never depends on them. Each pair's toes point toward the tree.

interface BootColors {
  upper: string;
  dark: string; // toe rand, heel counter
  collar: string;
  lace: string;
}

const PAIRS: { x: number; scale: number; mirror: boolean; colors: BootColors; label: string }[] = [
  // The larger pair, left of the tree: tan leather, orange laces
  { x: 30, scale: 1.25, mirror: false, colors: { upper: '#9A6B43', dark: '#5E3F27', collar: '#C9A27A', lace: '#E0823D' }, label: 'one pair' },
  // The smaller pair, right of the tree: slate and plum, teal laces
  { x: 410, scale: 1.1, mirror: true, colors: { upper: '#6D5A72', dark: '#3E3346', collar: '#B9A7BC', lace: '#3FA39A' }, label: 'the other pair' },
];

// One boot, side view: heel at x=0, toe at x≈40, standing on y=0
const Boot: React.FC<{ c: BootColors }> = ({ c }) => (
  <g>
    {/* Lugged sole and a light midsole */}
    <path d="M -1,0 L 39,0 Q 41.5,-1 40.5,-4.5 L 40,-6 L -1,-6 Z" fill="#2B2724" />
    <path d="M 3,0 v -1.6 M 9,0 v -1.6 M 15,0 v -1.6 M 21,0 v -1.6 M 27,0 v -1.6 M 33,0 v -1.6" stroke="#4A433D" strokeWidth="2" />
    <path d="M -1,-6 L 40,-6 L 39.5,-8.5 L -1,-8.5 Z" fill="#D8CDBD" />
    {/* Upper: the shaft up to the ankle, then the vamp down to the toe */}
    <path d="M 0,-8.5 L 0,-30 Q 0,-33 3,-33 L 16,-33 Q 18,-33 18.5,-31 L 20,-21 Q 26,-17 33,-15 Q 39.5,-13 39.5,-8.5 Z" fill={c.upper} />
    <path d="M 29,-15.2 Q 39.5,-13 39.5,-8.5 L 26.5,-8.5 Q 26,-13 29,-15.2 Z" fill={c.dark} />
    <path d="M 0,-8.5 L 0,-18 Q 7,-17 10,-8.5 Z" fill={c.dark} />
    {/* Tongue and padded collar */}
    <path d="M 14.5,-32.5 Q 17,-37.5 21.5,-35.5 L 20.5,-30 Z" fill={c.collar} />
    <path d="M 0.5,-31.5 Q 9,-35.5 18.5,-31.5" stroke={c.collar} strokeWidth="3" strokeLinecap="round" fill="none" />
    {/* Laces and hooks */}
    <path d="M 16.5,-30 L 20.5,-27.5 M 17.5,-26 L 21.5,-23.5 M 19,-22 L 24,-19.5" stroke={c.lace} strokeWidth="1.6" strokeLinecap="round" />
    <circle cx="16.8" cy="-30" r="1.1" fill="#E9E1D3" />
    <circle cx="17.8" cy="-26" r="1.1" fill="#E9E1D3" />
    <circle cx="19.4" cy="-22" r="1.1" fill="#E9E1D3" />
    {/* A crease of worn leather */}
    <path d="M 4,-14 Q 10,-16 15,-13" stroke={c.dark} strokeWidth="1" fill="none" opacity="0.5" />
  </g>
);

export const HikingBoots: React.FC<{ show: boolean }> = ({ show }) => {
  if (!show) return null;
  return (
    <g id="hiking-boots" pointerEvents="none">
      <title>Hike day: the boots are out</title>
      {PAIRS.map((p, i) => (
        <g key={p.label} transform={`translate(${p.x} 440) scale(${p.mirror ? -p.scale : p.scale} ${p.scale})`}>
          <g className="hike-boots-in" style={{ animationDelay: `${i * 180}ms` }}>
            <ellipse cx="24" cy="0.5" rx="30" ry="3" fill="#000" opacity="0.12" />
            {/* The back boot, a step behind and in shade */}
            <g transform="translate(12 -3)" style={{ filter: 'brightness(0.78)' }}>
              <Boot c={p.colors} />
            </g>
            <Boot c={p.colors} />
          </g>
        </g>
      ))}
    </g>
  );
};

import React from 'react';

// Hike day (expression.hike.boots): two pairs of hiking boots and their two water bottles, set down together
// on the ground right of the stand, ready to go. Drawn only; the tree's state never depends on them. The
// two pairs stand side by side, toes toward the tree, neither hiding the other; the bottles stand in front
// between them.

interface BootColors {
  upper: string;
  dark: string; // toe rand, heel counter
  collar: string;
  lace: string;
  bottle: string; // the water bottle next to the pair
}

// Mirrored (toes left, toward the tree): the pair's heel is at x, its toes reach about 52.5 × scale to the
// left. Side by side on one ground line with a small gap: the free ground right of the stand (x ≈ 340–440)
// holds both only a little smaller than life.
const PAIRS: { x: number; y: number; scale: number; shade: number; colors: BootColors; label: string }[] = [
  // Nearer the tree: tan leather, orange laces (x ≈ 339–387)
  { x: 386, y: 447, scale: 0.9, shade: 1, colors: { upper: '#9A6B43', dark: '#5E3F27', collar: '#C9A27A', lace: '#E0823D', bottle: '#4F7F6A' }, label: 'one pair' },
  // Further out: slate and plum, teal laces (x ≈ 391–438)
  { x: 437, y: 447, scale: 0.88, shade: 1, colors: { upper: '#6D5A72', dark: '#3E3346', collar: '#B9A7BC', lace: '#3FA39A', bottle: '#D98A6C' }, label: 'the other pair' },
];
// The two bottles stand in front (lower on the ground, drawn after the boots) between the pairs: x is a
// bottle's right edge. They may cover a heel or a toe, never a whole boot.
const BOTTLES = [
  { x: 398, y: 456, scale: 0.9, pair: 0 },
  { x: 409, y: 456, scale: 0.9, pair: 1 },
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

// A metal water bottle, standing on y=0 between x=-16 and x=-4: cap with a carry loop, a band, a highlight
const Bottle: React.FC<{ color: string }> = ({ color }) => (
  <g>
    <path d="M -15.5,-2 L -15.5,-24 Q -15.5,-27.5 -12.5,-28.5 L -7.5,-28.5 Q -4.5,-27.5 -4.5,-24 L -4.5,-2 Q -4.5,0 -6.5,0 L -13.5,0 Q -15.5,0 -15.5,-2 Z" fill={color} />
    <rect x="-15.5" y="-9" width="11" height="2.2" fill="#000" opacity="0.15" />
    <path d="M -13.6,-24 L -13.6,-4" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" opacity="0.35" />
    <rect x="-13" y="-33" width="6" height="4.8" rx="1.2" fill="#2B2724" />
    <path d="M -11.5,-33 Q -10,-37.5 -8.5,-33" stroke="#2B2724" strokeWidth="1.3" fill="none" />
  </g>
);

export const HikingBoots: React.FC<{ show: boolean }> = ({ show }) => {
  if (!show) return null;
  return (
    <g id="hiking-boots" pointerEvents="none">
      <title>Hike day: the boots and the water bottles are out</title>
      <ellipse cx="388" cy="450" rx="54" ry="6" fill="#000" opacity="0.1" />
      {PAIRS.map((p, i) => (
        <g key={p.label} transform={`translate(${p.x} ${p.y}) scale(${-p.scale} ${p.scale})`}>
          <g className="hike-boots-in" style={{ animationDelay: `${i * 180}ms`, filter: p.shade < 1 ? `brightness(${p.shade})` : undefined }}>
            {/* The pair's other boot, half a step back and in shade */}
            <g transform="translate(12 -3)" style={{ filter: 'brightness(0.78)' }}>
              <Boot c={p.colors} />
            </g>
            <Boot c={p.colors} />
          </g>
        </g>
      ))}
      {BOTTLES.map((b, i) => (
        // Bottle drawn between x=-16 and -4: shift it so x is its right edge
        <g key={i} transform={`translate(${b.x + 4 * b.scale} ${b.y}) scale(${b.scale})`}>
          <g className="hike-boots-in" style={{ animationDelay: `${360 + i * 140}ms` }}>
            <Bottle color={PAIRS[b.pair].colors.bottle} />
          </g>
        </g>
      ))}
    </g>
  );
};

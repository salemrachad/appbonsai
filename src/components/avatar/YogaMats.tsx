import React from 'react';

// A yoga day (expression.yoga.mats): two mats on the floor right of the stand, where the boots stand on hike
// day (the two never share a day). One rolled out flat, seen in perspective, with a light band near its edge
// (Lucy sometimes lies on it); one rolled up, standing on end at the right, its strap around it. Drawn only:
// the tree's state never depends on them.

const OPEN = { fill: '#8FAF9C', edge: '#6E8F7C', band: '#B9D1C2' }; // sage
const ROLLED = { fill: '#C9908A', dark: '#A5706B', light: '#E2B3AC', strap: '#5E4A44' }; // dusty rose

export const YogaMats: React.FC<{ show: boolean }> = ({ show }) =>
  !show ? null : (
    <g id="yoga-mats" pointerEvents="none" aria-label="two yoga mats">
      {/* The open mat, lying flat (a long, shallow parallelogram: the floor seen from slightly above) */}
      <path d="M 318,463 L 406,463 L 414,449 L 330,449 Z" fill={OPEN.fill} />
      <path d="M 318,463 L 406,463 L 406,465.5 L 318,465.5 Z" fill={OPEN.edge} />
      <path d="M 322,460.5 L 405,460.5 L 406.5,458.5 L 323.5,458.5 Z" fill={OPEN.band} opacity="0.7" />
      <path d="M 330,449 L 414,449" stroke={OPEN.band} strokeWidth="0.8" opacity="0.6" />
      {/* The rolled mat, standing on end: a cylinder with its spiral on top and a strap */}
      <rect x="419" y="420" width="15" height="43" rx="2" fill={ROLLED.fill} />
      <rect x="419" y="420" width="4" height="43" fill={ROLLED.light} opacity="0.55" />
      <rect x="430" y="420" width="4" height="43" fill={ROLLED.dark} opacity="0.5" />
      <ellipse cx="426.5" cy="420" rx="7.5" ry="2.6" fill={ROLLED.light} />
      <path d="M 426.5,420 m -4.5,0 a 4.5,1.6 0 1,0 9,0 a 3,1.1 0 1,0 -6,0 a 1.6,0.6 0 1,0 3,0" fill="none" stroke={ROLLED.dark} strokeWidth="0.7" />
      <rect x="418.5" y="438" width="16" height="3" fill={ROLLED.strap} opacity="0.85" />
      <ellipse cx="426.5" cy="463" rx="8" ry="1.6" fill="#000" opacity="0.12" />
    </g>
  );

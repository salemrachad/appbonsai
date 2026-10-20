import type { DreamMotif } from '../../behaviour/behaviourTypes';
import type { AvatarEffect, AvatarPresentation, DreamPresentation } from '../../expression/expressionTypes';
import { AvatarEffects, BodyDetails, ForegroundEffects, SoilEffects } from './AvatarEffects';
import type { Palette } from './Foliage';
import { isDreamAtmosphere } from '../../behaviour/messages';

// The tree's dream while it sleeps (expression.dream; behaviour/dreams.ts decides what it is made of and when).
// A faint, moonlit image drifting in the sky right of the crown, two small breaths of light rising to it from
// the crown. Only in a dreaming phase; nothing in deep sleep. Restless (asleep under a stress): it flickers and
// breaks off. Where the dream moves on, the motif before lingers in the new one (a combined scene). Low contrast on purpose: a dream is glimpsed, not shown. Reduced motion: still, fainter.

const INK = '#E9E6FF';

// Each motif as a few pale strokes, centred on 0,0 (about ±22)
function Glyph({ motif }: { motif: DreamMotif }) {
  const line = { stroke: INK, strokeWidth: 1.6, strokeLinecap: 'round' as const, fill: 'none' };
  const fill = { fill: INK, stroke: 'none' };
  switch (motif) {
    case 'rain': // drops falling upward
      return (
        <g className="dream-rise">
          {[[-12, 6], [-3, -4], [7, 10], [14, -8], [2, 16]].map(([x, y], i) => (
            <path key={i} d={`M ${x},${y - 5} Q ${x + 3},${y + 1} ${x},${y + 3} Q ${x - 3},${y + 1} ${x},${y - 5} Z`} {...fill} opacity={0.75} />
          ))}
        </g>
      );
    case 'dry_wind':
      return (
        <g className="dream-sway">
          {[-10, 0, 10].map((y, i) => <path key={i} d={`M -20,${y} C -10,${y - 6} -2,${y + 6} 8,${y} S 18,${y - 4} 22,${y}`} {...line} opacity={0.8 - i * 0.15} />)}
        </g>
      );
    case 'sun':
    case 'glare':
      return (
        <g className="dream-turn">
          <circle r={motif === 'glare' ? 9 : 7} {...fill} opacity={motif === 'glare' ? 0.85 : 0.65} />
          {Array.from({ length: motif === 'glare' ? 16 : 8 }, (_, i) => {
            const a = (i / (motif === 'glare' ? 16 : 8)) * Math.PI * 2;
            const r0 = 12;
            const r1 = motif === 'glare' ? 22 : 18;
            return <line key={i} x1={Math.cos(a) * r0} y1={Math.sin(a) * r0} x2={Math.cos(a) * r1} y2={Math.sin(a) * r1} {...line} strokeWidth={motif === 'glare' ? 1 : 1.6} />;
          })}
        </g>
      );
    case 'frost':
      return (
        <g className="dream-turn">
          {[0, 60, 120].map((r) => (
            <g key={r} transform={`rotate(${r})`}>
              <line x1={0} y1={-18} x2={0} y2={18} {...line} />
              <path d="M -4,-13 L 0,-9 L 4,-13 M -4,13 L 0,9 L 4,13" {...line} strokeWidth={1.2} />
            </g>
          ))}
        </g>
      );
    case 'flood':
      return (
        <g className="dream-sway">
          {[-8, 2, 12].map((y, i) => <path key={i} d={`M -22,${y} Q -16,${y - 5} -11,${y} T 0,${y} T 11,${y} T 22,${y}`} {...line} opacity={0.85 - i * 0.2} />)}
        </g>
      );
    case 'mist':
      return (
        <g className="dream-sway">
          {[[-4, -8, 18], [4, 2, 22], [-2, 12, 16]].map(([x, y, rx], i) => <ellipse key={i} cx={x} cy={y} rx={rx} ry={3.5} {...fill} opacity={0.35} />)}
        </g>
      );
    case 'storm':
      return (
        <g>
          <path d="M -16,-2 C -20,-10 -10,-17 -3,-12 C 1,-20 15,-17 14,-8 C 21,-7 20,3 13,3 L -12,3 C -18,3 -19,-1 -16,-2 Z" {...fill} opacity={0.5} />
          <path d="M 1,5 L -4,13 L 2,13 L -3,22" {...line} className="dream-flash" />
        </g>
      );
    case 'snow':
      return (
        <g className="dream-fall">
          {[[-14, -10], [-4, 2], [8, -6], [16, 8], [-10, 14], [3, 16], [12, -16]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={1.8} {...fill} opacity={0.8} />)}
        </g>
      );
    case 'new_shoots':
    case 'new_leaves':
      return (
        <g className="dream-grow">
          <path d="M 0,18 C 0,8 -2,0 2,-10" {...line} />
          <path d="M 1,-2 C 9,-8 15,-4 16,0 C 10,2 5,1 1,-2 Z" {...fill} opacity={0.7} />
          <path d="M 0,6 C -8,0 -14,4 -15,8 C -9,10 -4,9 0,6 Z" {...fill} opacity={0.6} />
          {motif === 'new_leaves' && <path d="M 2,-10 C 6,-18 12,-18 13,-15 C 9,-12 5,-11 2,-10 Z" {...fill} opacity={0.8} />}
        </g>
      );
    case 'new_ground':
      return (
        <g className="dream-sway">
          <path d="M -16,-6 L 16,-6 L 12,14 L -12,14 Z" {...line} />
          <path d="M 0,-6 L 0,4 M 0,2 L -6,10 M 0,4 L 7,11" {...line} strokeWidth={1.1} opacity={0.7} />
        </g>
      );
    case 'new_light':
      return (
        <g className="dream-turn">
          <rect x={-10} y={-12} width={20} height={20} rx={2} {...line} />
          <path d="M 0,-12 L 0,8 M -10,-2 L 10,-2" {...line} strokeWidth={1} />
          <path d="M -6,12 L -14,22 M 0,12 L 0,22 M 6,12 L 14,22" {...line} strokeWidth={1} opacity={0.5} />
        </g>
      );
    case 'warm_hand':
      return (
        <g className="dream-breathe">
          <circle r={16} fill="#FFE9C2" opacity={0.18} />
          <ellipse cx={0} cy={6} rx={8} ry={9} {...fill} opacity={0.55} />
          {[[-9, -6, -20], [-3, -11, -6], [3, -11, 6], [9, -6, 20]].map(([x, y, r], i) => (
            <ellipse key={i} cx={x} cy={y} rx={2.4} ry={6} transform={`rotate(${r} ${x} ${y})`} {...fill} opacity={0.55} />
          ))}
        </g>
      );
    case 'squirrel': // the curl of its tail
      return (
        <g className="dream-sway">
          <path d="M -12,16 C -20,4 -14,-14 2,-16 C 16,-18 22,-4 14,4 C 8,10 -2,6 0,-2 C 2,-8 10,-6 9,-1" {...line} strokeWidth={3} opacity={0.75} />
        </g>
      );
    case 'drey':
      return (
        <g className="dream-breathe">
          <ellipse rx={18} ry={11} {...line} />
          <path d="M -15,-3 L 14,5 M -14,4 L 15,-4 M -8,-9 L 6,10 M 9,-9 L -5,10" {...line} strokeWidth={0.9} opacity={0.6} />
        </g>
      );
    case 'sloth': // hanging from a branch
      return (
        <g className="dream-sway" style={{ transformOrigin: '0 -14px' }}>
          <path d="M -22,-14 L 22,-14" {...line} />
          <path d="M -8,-14 C -10,-2 -6,10 2,10 C 10,10 12,-2 9,-14" {...line} strokeWidth={2.2} opacity={0.8} />
          <circle cx={2} cy={12} r={5} {...fill} opacity={0.5} />
        </g>
      );
    case 'dragonfly':
      return (
        <g className="dream-hover">
          <line x1={0} y1={-14} x2={0} y2={16} {...line} strokeWidth={1.8} />
          {[-1, 1].map((s) => (
            <g key={s}>
              <ellipse cx={s * 10} cy={-6} rx={10} ry={3} {...fill} opacity={0.45} />
              <ellipse cx={s * 9} cy={1} rx={9} ry={2.6} {...fill} opacity={0.4} />
            </g>
          ))}
        </g>
      );
    case 'lucy': // a paw print
      return (
        <g className="dream-breathe">
          <ellipse cx={0} cy={6} rx={8} ry={7} {...fill} opacity={0.6} />
          {[[-9, -4], [-3, -9], [3, -9], [9, -4]].map(([x, y], i) => <ellipse key={i} cx={x} cy={y} rx={3} ry={3.6} {...fill} opacity={0.6} />)}
        </g>
      );
    case 'boots':
      return (
        <g className="dream-walk">
          <path d="M -10,-14 L -2,-14 L -2,4 L 12,8 C 15,9 15,14 12,14 L -12,14 C -13,6 -11,-4 -10,-14 Z" {...line} />
          <path d="M -9,-6 L -3,-6 M -9,0 L -3,0" {...line} strokeWidth={1} opacity={0.6} />
        </g>
      );
    case 'wind_rising':
      return (
        <g className="dream-turn">
          <path d="M 0,0 C 4,-2 6,4 2,6 C -4,8 -8,0 -4,-6 C 2,-12 12,-8 12,2 C 12,12 0,18 -10,14" {...line} />
        </g>
      );
  }
}

// A combined scene (expression.dream.with: the motif before, lingering as the dream moves on). A sky-like motif
// is where it happens, drawn large and soft behind; a figure stands in it. Two figures share the scene; two
// skies mix. The lingering one fades slowly as the new one takes over.
function Scene({ motif, lingering }: { motif: DreamMotif; lingering: DreamMotif | null }) {
  if (!lingering || lingering === motif) return <Glyph motif={motif} />;
  const linger = (m: DreamMotif) => (m === lingering ? 'dream-linger' : undefined);
  const skyA = isDreamAtmosphere(motif);
  const skyB = isDreamAtmosphere(lingering);
  if (skyA !== skyB) {
    const sky = skyA ? motif : lingering;
    const figure = skyA ? lingering : motif;
    return (
      <>
        {/* The weather fills the scene: spread around the figure */}
        <g opacity={0.75} className={linger(sky)}>
          {[[-16, -8], [15, -4], [-2, 12]].map(([x, y], i) => (
            <g key={i} transform={`translate(${x} ${y}) scale(0.8)`}>
              <Glyph motif={sky} />
            </g>
          ))}
        </g>
        <g transform="scale(0.78)" className={linger(figure)}>
          <Glyph motif={figure} />
        </g>
      </>
    );
  }
  if (!skyA)
    return (
      <>
        <g transform="translate(-13 3) scale(0.62)" className="dream-linger">
          <Glyph motif={lingering} />
        </g>
        <g transform="translate(11 -1) scale(0.72)">
          <Glyph motif={motif} />
        </g>
      </>
    );
  return (
    <>
      <g opacity={0.55} className="dream-linger">
        <Glyph motif={lingering} />
      </g>
      <Glyph motif={motif} />
    </>
  );
}

export function Dream({ dream }: { dream: DreamPresentation | null }) {
  if (!dream || dream.phase !== 'dreaming' || !dream.motif) return null;
  return (
    <g key={dream.key} pointerEvents="none" className={dream.restless ? 'dream dream-restless' : 'dream'} aria-hidden>
      {/* Two small breaths of light rising from the crown */}
      <circle cx={292} cy={52} r={2.5} fill={INK} className="dream-wisp-1" />
      <circle cx={312} cy={40} r={4} fill={INK} className="dream-wisp-2" />
      <g className="dream-drift" style={{ transformOrigin: '360px 60px', transformBox: 'view-box' }}>
        <circle cx={360} cy={60} r={dream.with ? 52 : 46} fill="url(#dreamHalo)" />
        <g transform="translate(360 60) scale(1.35)">
          <Scene motif={dream.motif} lingering={dream.with ?? null} />
        </g>
      </g>
    </g>
  );
}

// The halo the dream floats in (in the avatar's <defs>)
export function DreamDefs() {
  return (
    <radialGradient id="dreamHalo">
      <stop offset="0%" stopColor="#CFC8FF" stopOpacity="0.42" />
      <stop offset="60%" stopColor="#B9B0F5" stopOpacity="0.2" />
      <stop offset="100%" stopColor="#B9B0F5" stopOpacity="0" />
    </radialGradient>
  );
}

// Echoes: while it dreams, the tree's body now and then re-lives what it dreams of, with its own effects (the
// rain it drank, the dry wind it felt), faint and short: in to ~45 % over 2 s, held 4 s, out 2 s, every 30 s;
// in a combined scene the lingering motif's echo first, the new one half a cycle later. Restless: brief
// flickers. Drawn over the tree, never instead of its look; effects it already shows are left out (no doubles).
const NO_SEASON: AvatarPresentation['seasonalLeaves'] = { newGrowth: 0, yellowing: 0, leafDrop: 0 };
export function DreamEcho({ dream, shown, palette, soil }: { dream: DreamPresentation | null; shown: AvatarEffect[]; palette: Palette; soil: AvatarPresentation['soil'] }) {
  if (!dream || dream.phase !== 'dreaming' || !dream.echo?.length) return null;
  const slots = dream.echo.map((fx) => fx.filter((e) => !shown.includes(e))).filter((fx) => fx.length);
  if (!slots.length) return null;
  return (
    <g key={dream.key} pointerEvents="none" aria-hidden>
      {slots.map((fx, i) => (
        <g key={i} className={dream.restless ? 'dream-echo dream-echo-restless' : 'dream-echo'} style={{ animationDelay: `${3 + i * (dream.restless ? 4.5 : 15)}s` }}>
          <AvatarEffects effects={fx} />
          <SoilEffects effects={fx} soil={soil} />
          <BodyDetails effects={fx} shielding={false} shaking={false} />
          <ForegroundEffects effects={fx} palette={palette} seasonal={NO_SEASON} />
        </g>
      ))}
    </g>
  );
}

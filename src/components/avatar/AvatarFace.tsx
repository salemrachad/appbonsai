import React from 'react';
import { AvatarPresentation } from './avatarStates';

const INK = '#2C1D11';
const BARK = '#6B5E4F';

const BLUSH: Record<AvatarPresentation['blush'], { fill: string; opacity: number; r: number }> = {
  normal: { fill: '#F4A261', opacity: 0.35, r: 7 },
  happy: { fill: '#FF8FA3', opacity: 0.75, r: 8.5 },
  hot: { fill: '#FF6B6B', opacity: 0.8, r: 7 },
  cold: { fill: '#9FA8DA', opacity: 0.6, r: 7 },
  pale: { fill: '#D4A373', opacity: 0.35, r: 7 },
};

function Eyes({ style, blinking }: { style: AvatarPresentation['eyes']; blinking: boolean }) {
  if (blinking || style === 'closed') {
    return (
      <g stroke={INK} strokeWidth="2.8" strokeLinecap="round" fill="none">
        <path d="M 196,281 Q 203,275 210,281" />
        <path d="M 230,281 Q 237,275 244,281" />
      </g>
    );
  }
  switch (style) {
    case 'joy':
      return (
        <g stroke={INK} strokeWidth="3" strokeLinecap="round" fill="none">
          <path d="M 196,280 Q 203,273 210,280" />
          <path d="M 230,280 Q 237,273 244,280" />
        </g>
      );
    case 'drowsy':
      return (
        <g stroke={INK} strokeWidth="2.5" strokeLinecap="round" fill="none">
          <path d="M 197,281 Q 203,284 209,281" />
          <path d="M 231,281 Q 237,284 243,281" />
        </g>
      );
    case 'heavy':
      return (
        <g>
          <circle cx="203" cy="282" r="4.5" fill={INK} />
          <circle cx="237" cy="282" r="4.5" fill={INK} />
          <path d="M 197,279 L 209,279" stroke={BARK} strokeWidth="3.5" strokeLinecap="round" />
          <path d="M 231,279 L 243,279" stroke={BARK} strokeWidth="3.5" strokeLinecap="round" />
        </g>
      );
    case 'alert':
      return (
        <g>
          <circle cx="203" cy="279" r="6.5" fill={INK} />
          <circle cx="237" cy="279" r="6.5" fill={INK} />
          <circle cx="201" cy="276.5" r="2.4" fill="#FFFFFF" />
          <circle cx="235" cy="276.5" r="2.4" fill="#FFFFFF" />
        </g>
      );
    case 'sad':
      return (
        <g>
          <circle cx="203" cy="281" r="5" fill={INK} />
          <circle cx="237" cy="281" r="5" fill={INK} />
          <circle cx="201" cy="279" r="1.8" fill="#FFFFFF" />
          <circle cx="235" cy="279" r="1.8" fill="#FFFFFF" />
          <path d="M 197,272 L 208,276" stroke={INK} strokeWidth="2" strokeLinecap="round" />
          <path d="M 243,272 L 232,276" stroke={INK} strokeWidth="2" strokeLinecap="round" />
        </g>
      );
    case 'worried':
      return (
        <g>
          <circle cx="203" cy="280" r="5.5" fill={INK} />
          <circle cx="237" cy="280" r="5.5" fill={INK} />
          <circle cx="202" cy="278" r="2" fill="#FFFFFF" />
          <circle cx="236" cy="278" r="2" fill="#FFFFFF" />
          <path d="M 196,271 L 207,273" stroke={INK} strokeWidth="2" strokeLinecap="round" />
          <path d="M 244,271 L 233,273" stroke={INK} strokeWidth="2" strokeLinecap="round" />
        </g>
      );
    case 'squint_hard':
      return (
        <g stroke={INK} strokeWidth="2.6" strokeLinecap="round" fill="none">
          <path d="M 197,277 L 206,281 L 197,285" />
          <path d="M 243,277 L 234,281 L 243,285" />
        </g>
      );
    case 'squint_soft':
      return (
        <g stroke={INK} strokeWidth="2.8" strokeLinecap="round" fill="none">
          <path d="M 196,281 Q 203,278 210,281" />
          <path d="M 230,281 Q 237,278 244,281" />
        </g>
      );
    case 'unsure':
      return (
        <g>
          <circle cx="203" cy="281" r="5" fill={INK} />
          <circle cx="237" cy="280" r="5.5" fill={INK} />
          <circle cx="235.5" cy="278" r="2" fill="#FFFFFF" />
          <path d="M 197,276 L 209,276" stroke={INK} strokeWidth="2" strokeLinecap="round" />
          <path d="M 231,270 Q 237,266 244,270" stroke={INK} strokeWidth="2" strokeLinecap="round" fill="none" />
        </g>
      );
    case 'happy':
    default:
      return (
        <g>
          <circle cx="203" cy="280" r="5.5" fill={INK} />
          <circle cx="237" cy="280" r="5.5" fill={INK} />
          <circle cx="201.5" cy="278" r="2" fill="#FFFFFF" />
          <circle cx="235.5" cy="278" r="2" fill="#FFFFFF" />
          <circle cx="204.5" cy="282" r="1" fill="#FFFFFF" />
          <circle cx="238.5" cy="282" r="1" fill="#FFFFFF" />
        </g>
      );
  }
}

function Mouth({ style }: { style: AvatarPresentation['mouth'] }) {
  const line = { stroke: INK, strokeLinecap: 'round' as const, fill: 'none' };
  switch (style) {
    case 'grin':
      return <path d="M 213,291 Q 220,303 227,291 Z" fill="#D9534F" stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />;
    case 'chatter':
      return <path d="M 213,294 L 216,292 L 219,295 L 222,292 L 225,295 L 228,293" {...line} strokeWidth="2" strokeLinejoin="round" />;
    case 'pant':
      return <path d="M 214,293 Q 220,298 226,293 Z" fill="#E57373" stroke={INK} strokeWidth="1.6" />;
    case 'frown':
      return <path d="M 214,296 Q 220,290 226,296" {...line} strokeWidth="2.4" />;
    case 'wobble':
      return <path d="M 213,295 Q 216,291 219,295 Q 222,299 225,295 Q 227,292 228,294" {...line} strokeWidth="2.2" />;
    case 'sleep':
      return <path d="M 217,293 Q 220,296 223,293" {...line} strokeWidth="2" />;
    case 'flat':
      return <path d="M 215,294 L 225,294" {...line} strokeWidth="2.2" />;
    case 'smile':
    default:
      return <path d="M 214,291 Q 220,298 226,291" {...line} strokeWidth="2.2" />;
  }
}

export const AvatarFace: React.FC<{ look: AvatarPresentation; blinking: boolean }> = ({ look, blinking }) => {
  const blush = BLUSH[look.blush];
  return (
    <g id="bonsai-face" className="transition-all duration-300">
      <circle cx="195" cy="292" r={blush.r} fill={blush.fill} opacity={blush.opacity} />
      <circle cx="245" cy="292" r={blush.r} fill={blush.fill} opacity={blush.opacity} />
      {look.sweat && (
        <path
          d="M 248,278 C 248,278 253,286 253,290 C 253,293 250,295 248,295 C 246,295 243,293 243,290 C 243,286 248,278 248,278 Z"
          fill="#64B5F6"
          className="animate-sweat"
        />
      )}
      <Eyes style={look.eyes} blinking={blinking} />
      <Mouth style={look.mouth} />
    </g>
  );
};

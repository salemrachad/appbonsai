// The visual vocabulary of the bonsai character, and the instructions the Expression Engine
// gives the avatar. The avatar only draws these; it never sees health or sensor values.

export type EyeStyle =
  | 'happy' // open, sparkly
  | 'joy' // closed upward curves
  | 'closed' // asleep
  | 'drowsy' // half-closed
  | 'heavy' // heavy-lidded
  | 'alert' // wide open
  | 'sad' // droopy with sad brows
  | 'worried' // open with raised worried brows
  | 'squint_hard' // > <
  | 'squint_soft' // gentle squint
  | 'unsure'; // one brow raised

export type MouthStyle = 'smile' | 'grin' | 'frown' | 'pant' | 'chatter' | 'sleep' | 'flat' | 'wobble';
export type BlushStyle = 'normal' | 'happy' | 'hot' | 'cold' | 'pale';
export type Posture = 'perky' | 'normal' | 'droop' | 'wilt' | 'shrink';

export type AvatarEffect =
  | 'sparkles'
  | 'sprout'
  | 'water_badge'
  | 'heat_waves'
  | 'hot_sun'
  | 'snow'
  | 'frost'
  | 'moon_zzz'
  | 'bright_sun'
  | 'puddle'
  | 'mist'
  | 'dry_wind'
  | 'question'
  | 'rain'
  | 'lanterns';

// What the avatar draws.
export interface AvatarPresentation {
  eyes: EyeStyle;
  mouth: MouthStyle;
  blush: BlushStyle;
  sweat: boolean;
  posture: Posture;
  leaves: 'lush' | 'dry';
  soil: 'moist' | 'dry' | 'wet';
  effects: AvatarEffect[];
  animation: string; // CSS class on the tree
  halo: string; // CSS classes for the background glow
}

export type GaugeTone = 'thriving' | 'happy' | 'okay' | 'stressed' | 'critical' | 'paused';

export interface ExpressionMessage {
  text: string; // the current thought (always available, e.g. when the tree is tapped)
  tip: string;
  visible: boolean; // false = the tree is quiet right now (animation only)
  intent: string;
  key: string; // catalog key, e.g. "thirst:moderate"
  variant: number;
  reason: string; // why it speaks / stays silent (developer panel)
  spokenAt: number | null;
  cooldownRemainingMs: number | null; // null = until something changes
  onceStatus: string;
}

// Everything the avatar and the companion screen need. The UI renders this and nothing else.
export interface ExpressionState {
  avatar: AvatarPresentation;
  leafDroop: number; // -0.2 (lifted, perky) … 0 (relaxed) … 1 (wilting); interpolated smoothly by the avatar
  motion: {
    swaySpeed: number; // 1 = normal tempo
    swayAmount: number; // 1 = normal amplitude; ~0.2 almost still
    flutter: number; // leaf flutter amplitude
    blinkEveryMs: number | null; // null = eyes closed / no blinking
  };
  reactionStrength: number; // 0-1, from responsiveness: how visibly touch and care register
  atmosphere: { theme: 'day' | 'night'; phase: string };
  gauge: { label: string; tone: GaugeTone }; // vitality chip label/colour, decided upstream
  tapLabel: string; // short mood label shown when the tree is tapped
  message: ExpressionMessage;
  intensity: number; // 0-1
  // Living Art's three levels of expression
  layers: {
    epidermal: string[]; // immediate physical reaction ("slight leaf droop", "slower sway")
    wording: string; // emotional communication
    diffraction: string | null; // response emerging from history + context ("watered while thirsty → relief")
  };
}

// The visual vocabulary of the bonsai character, and the instructions the Expression Engine
// gives the avatar. The avatar only draws these; it never sees health or sensor values.

import type { Season } from '../perception/season';

export type EyeStyle =
  | 'happy' // open, sparkly
  | 'joy' // closed upward curves
  | 'closed' // asleep
  | 'drowsy' // half-closed
  | 'heavy' // heavy-lidded
  | 'alert' // wide open
  | 'sad' // droopy with sad brows
  | 'worried' // open with raised worried brows
  | 'pleading' // big wet eyes, brows up (badly in need)
  | 'wide' // stiff, wide open (frozen)
  | 'swirl' // dizzy spirals (overwhelmed)
  | 'squint_hard' // > <
  | 'squint_soft' // gentle squint
  | 'unsure'; // one brow raised

export type MouthStyle =
  | 'smile'
  | 'grin'
  | 'frown'
  | 'pant'
  | 'chatter'
  | 'sleep'
  | 'flat'
  | 'wobble'
  | 'parched' // small open, dry
  | 'pucker' // pursed (dry air)
  | 'queasy' // uneasy wavy, cheeks puffed
  | 'gasp' // small round "o"
  | 'yawn'; // tall open
export type BlushStyle = 'normal' | 'happy' | 'hot' | 'cold' | 'pale' | 'none';
export type Posture = 'perky' | 'normal' | 'droop' | 'wilt' | 'shrink';

// Where the eyes go when nobody is pointing at the tree (the avatar adds saccades and pointer tracking).
export type Gaze = 'around' | 'center' | 'down' | 'up' | 'toward_light' | 'away' | 'search';

// Leaf colour and texture: the state shows in the foliage, the season tints the calm states.
export type Foliage =
  | 'lush' // healthy green
  | 'vivid' // glossy, saturated (thriving, summer)
  | 'tender' // fresh light-green (spring flush, recovering)
  | 'deep' // dark, quiet green (winter rest)
  | 'thirsty' // dull grey-green
  | 'parched' // yellow-brown, crisp
  | 'scorched' // sun-bleached, brown edges
  | 'soaked' // dark, glossy, heavy
  | 'frosted' // white-edged, blue-green
  | 'frozen' // iced, blue-grey
  | 'curled' // pale, edges rolled
  | 'dewy' // dull with beads of moisture
  | 'dim' // pale and stretched (low light)
  | 'washed'; // desaturated (uncertain data, glare)

// A small recurring action, so the tree is never a loop: a sigh, a shiver burst, a yawn…
export type Gesture =
  | 'wiggle'
  | 'sigh'
  | 'shiver_burst'
  | 'yawn'
  | 'shake_off' // shakes drops off its leaves
  | 'fan' // fans itself with a branch
  | 'stretch_up' // reaches up toward light
  | 'look_around'
  | 'nod_off'
  | 'shield' // pulls a pad over its eyes
  | 'tremble'
  | 'tilt';

export type AvatarFilter = 'heat_shimmer' | 'desaturate' | 'frost' | 'glare' | 'gloom' | null;

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
  | 'lanterns'
  // body details
  | 'falling_leaves' // a few leaves let go (very dry, heat, autumn)
  | 'yellow_leaves' // some old leaves yellowing
  | 'new_leaves' // light-green fresh tips (spring flush, recovering)
  | 'drips' // water dripping from the pads
  | 'icicles'
  | 'breath_vapor' // breath clouds in the cold
  | 'cracks' // cracked dry soil
  | 'condensation' // beads of water on the leaves
  | 'sweat_drops'
  | 'fireflies'
  | 'gloom_cloud'
  | 'butterfly'
  | 'pollen'
  | 'leaf_visor'; // a pad held over the eyes

// What the avatar draws.
export interface AvatarPresentation {
  eyes: EyeStyle;
  mouth: MouthStyle;
  blush: BlushStyle;
  sweat: boolean;
  posture: Posture;
  foliage: Foliage;
  // Mixed into the foliage colours (0-1): the neighbouring season's tone near a boundary
  foliageBlend: { tone: Foliage; amount: number } | null;
  // Where the tree is in its year (0-1 each): share of fresh leaves, yellowing leaves, leaves letting go
  seasonalLeaves: { newGrowth: number; yellowing: number; leafDrop: number };
  soil: 'moist' | 'dry' | 'wet' | 'frozen';
  gaze: Gaze;
  gesture: { kind: Gesture; everyMs: number } | null;
  filter: AvatarFilter;
  effects: AvatarEffect[];
  animation: string; // CSS class on the tree
  halo: string; // CSS classes for the background glow
}

export type GaugeTone = 'thriving' | 'happy' | 'okay' | 'stressed' | 'critical' | 'paused';

// The whole screen takes on the state, like night does: each condition has its own scene.
export type SceneId =
  | 'calm' // comfortable (tinted by the season)
  | 'golden' // thriving
  | 'parched' // thirsty
  | 'drought' // very dry
  | 'scorching' // hot, hot and dry
  | 'sodden' // too wet
  | 'chill' // cold
  | 'frozen' // freezing risk
  | 'dim' // too dark (lanterns)
  | 'night' // sleeping
  | 'glare' // very bright
  | 'windy' // dry air
  | 'fog' // high humidity
  | 'renewal' // recovering
  | 'storm' // multiple stress
  | 'static'; // sensor uncertain

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
  atmosphere: {
    theme: 'day' | 'night';
    phase: string;
    scene: SceneId;
    season: Season;
    seasonStage: 'early' | 'mid' | 'late';
    intensity: number; // 0-1: how strongly the scene shows (follows the state's intensity)
  };
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

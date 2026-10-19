// The visual vocabulary of the bonsai character, and the instructions the Expression Engine
// gives the avatar. The avatar only draws these; it never sees health or sensor values.

import type { HikePlan } from '../behaviour/hike';
import type { DreamMotif } from '../behaviour/behaviourTypes';
import type { Season } from '../perception/season';
import type { OutsideSky } from '../telemetry/outsideWeather';

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
export type Gaze = 'around' | 'center' | 'down' | 'up' | 'toward_light' | 'away' | 'search' | 'east' | 'west'; // east/west: toward the rising / setting sun

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
  | 'dew' // a humid night: larger beads glinting on the leaves, now and then a drop falls
  | 'night_mist' // a humid night: a soft mist bank drifting low around the pot
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
  // The last weeks: how full the canopy is (0.6-1) and how much of the gap is coming back as fresh tips
  canopy: { fullness: number; refilling: number };
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

// Outside weather, drawn as its own background layer behind the tree (the tree itself never changes).
// Context only: from perception.outside, never from health.
export interface WeatherLook {
  sky: OutsideSky;
  windy: boolean;
  intensity: number; // 0-1: how much of it the layer shows (drizzle light, a downpour heavy)
  label: string; // short header chip text, e.g. "Rain · 9°C"
  haze?: number; // 0-1: a veil of bad air outside (absent when the air is moderate or better, or unknown)
}

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

// How the foliage answers a stroke (petting). Decided by the Expression Engine from the current state;
// the avatar only animates it. Petting is attention, not care: it never changes the state it reads.
export type TouchKind =
  | 'lean_in' // calm: leaves follow the hand softly, a slight lean, a soft eye-close
  | 'gentle' // recovering / afterglow: a careful, smaller answer
  | 'dry_rustle' // dry or hot: stiff, papery, barely follows; never lifts the droop
  | 'braced' // cold: tight and still
  | 'slow_stir' // asleep: a slow, soft sway, eyes stay closed
  | 'muted'; // unsure of its own state (no trustworthy data): almost no answer

export interface TouchResponse {
  kind: TouchKind;
  give: number; // 0-1: how far leaves near the hand follow it
  stiffness: number; // spring constant (higher = snaps back sooner, papery)
  damping: number; // spring damping (higher = no overshoot)
  lean: number; // 0-1: whole-tree lean toward the hand
  blink: 'soft_close' | 'slow' | 'none'; // the nonverbal acknowledgement
  // Within a session: continuous stroking settles the answer toward `floor` (calm acceptance, never a
  // refusal) at settlePerSec; a rest recovers it with time constant recoverMs. See expression/touch.ts.
  habituation: { settlePerSec: number; floor: number; recoverMs: number };
  familiarity: number; // 0-1 applied to this answer (0 outside the calm kinds): ease with the caretaker's hand
}

// A visitor in the tree (evidence class "art", from behaviour.habitat). The avatar only draws it: out on a
// branch (`visiting`) or tucked behind the leaves, peeking (`hiding`). A stroke startles it (UI only).
export interface VisitorPresentation {
  kind: 'squirrel';
  id: string; // stable per visit: the avatar replays the arrival only when it changes
  mode: 'visiting' | 'peek' | 'hiding' | 'sleeping'; // peek: a new (or wary) squirrel only peeks from the leaves; sleeping: curled in its drey
  spot: 'left_branch' | 'right_branch' | 'crown' | 'trunk' | 'pot_rim';
  carrying: 'nut' | null;
  // What it's doing on this visit: drinking at the pot rim after a watering, inspecting a pruning,
  // shaking off after the rain outside (null: just visiting)
  action: 'drinking' | 'inspecting' | 'shake_off' | null;
  play: VisitorPlay; // how it answers petting, decided from the tree's state
  // Encounters: who it watches (its head follows them), and the spots its play never hops to (the sloth's
  // branch, the branch the dragonfly rests by)
  lookAt?: 'sloth' | 'dragonfly' | 'lucy' | null;
  avoid?: VisitorPresentation['spot'][];
}

// The dragonfly (from behaviour.habitat.dragonfly): perched on a leaf tip or hovering near it. Its wings
// beat at `wingTempo` (livelier in warmer air). A stroke makes it dart off and return to the same tip (UI).
export interface DragonflyPresentation {
  id: string;
  presence: 'hovering' | 'perched';
  perch: 'left_tip' | 'right_tip' | 'crown_tip' | 'left_top' | 'on_sloth'; // on_sloth: resting on the sloth (drawn with it)
  wingTempo: number; // ~0.6 cool … 1.4 hot
  // Its route through the visit (decided by behaviour): the avatar flies it on the clock. perch is its home.
  route: { at: number; perch: DragonflyPresentation['perch']; mode: 'perched' | 'hovering' }[];
  flightMs: number; // how long one flight between stops takes
}

// The sloth (from behaviour.habitat.sloth): hanging under a branch, inching along it, or asleep curled up.
// Everything it does is slow (`tempo`, warmer air a little livelier). A stroke gets a slow look and blink.
export interface SlothPresentation {
  id: string;
  pose: 'hanging' | 'climbing' | 'sleeping';
  branch: 'left_branch' | 'right_branch';
  grip: 'four' | 'arms' | 'legs' | 'one_arm' | 'two_legs_one_arm'; // how it holds on (from its comfort)
  tempo: number; // ~0.4 … 0.7
  lookAt?: 'squirrel' | null; // encounter: it slowly turns its head toward the squirrel
  rider?: boolean; // encounter: a dragonfly rests on it (slow blinks)
}

// Lucy (from behaviour.habitat.lucy): the household dog on the floor around the pot. The avatar plays her
// route on its own clock: walking in at `startedAt`, sniffing along the floor, sitting in different places,
// looking at you, up at the tree or around, settling down, dozing, and walking out at `endsAt`. She breathes
// at `breath` (ms per breath): ~10 s (six a minute) when down or asleep, a calm pace to breathe along with. A
// stroke gets a tilt, a wag or (asleep) an ear twitch. Her pillow is always there.
export type LucySpotLook = 'pillow' | 'floor_left' | 'by_pot' | 'pot_front' | 'pot_right' | 'floor_right';
// The tree's dream while it sleeps (from behaviour.dream): a faint image drifting beside the crown in the
// dreaming phases, nothing in deep sleep. Art only.
export interface DreamPresentation {
  key: string; // the night and the phase: a new phase is a new image
  phase: 'deep' | 'dreaming';
  motif: DreamMotif | null; // dreaming: what it is made of
  with: DreamMotif | null; // a combined scene: the motif before, lingering in this one
  restless: boolean; // asleep under a stress: the image breaks off
  endsAt: number | null; // when this phase gives way
}

export interface LucyPresentation {
  id: string;
  pose: 'walking' | 'sitting' | 'down' | 'sleeping'; // at the last evaluation (the route has the rest)
  // Asleep by the tree, her dream twitches keep time with its dream: more while it dreams, most when she
  // (or the squirrel she chases) is in it; few in its deep sleep
  dreamSync?: 'running' | 'with_tree' | 'deep' | null;
  spot: LucySpotLook;
  rest: LucySpotLook;
  route: { at: number; spot: LucySpotLook; act: 'sniff' | 'stand' | 'sit' | 'down' | 'sleep'; look: 'user' | 'tree' | 'around' }[];
  cue: 'shake_off' | 'panting' | 'concern' | 'tired' | 'storm' | null;
  breath: { up: number; down: number; asleep: number };
  night: boolean; // her night by the pot: sleepy eyes when she lies looking at you
  startedAt: number;
  endsAt: number;
  // A visitor in the tree, and how much it interests her: a glance now and then, watching it, curious (she
  // walks under it and sits looking up), excited (the same, wagging, a little bounce). Asleep she ignores it.
  interest?: { who: 'squirrel' | 'dragonfly' | 'sloth'; level: 'glance' | 'watch' | 'curious' | 'excited' } | null;
}

// The drey (nest) in the crown: weeks of a welcoming tree made visible. Drawn even when nobody is home.
export type DreyLook = 'none' | 'started' | 'built';

// Petting while the squirrel visits: it plays around the tree. Decided by the Expression Engine from the
// tree's state (a stressed tree doesn't play); the avatar only animates it. Attention, never stored.
export interface VisitorPlay {
  kind: 'playful' | 'gentle' | 'shy' | 'asleep'; // thriving / comfortable / hiding through a stress / asleep in the drey (only a tail twitch)
  hopEveryMs: number; // 0 = doesn't hop (shy: ducks and re-peeks)
  hideChance: number; // 0-1 per hop: dives behind a pad instead
  returnMs: number; // back out after hiding
  lingerMs: number; // play ends this long after the last stroke
  // The tail wags in the tree's own rhythm: tempo from its sway speed, amount from its sway amplitude
  wag: { tempo: number; amount: number };
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
  touch: TouchResponse; // how a stroke registers right now
  visitor: VisitorPresentation | null;
  squirrelTraces: 'nibbled_leaf' | 'tail_at_pot' | null; // signs of a squirrel that isn't here yet (its first days)
  dragonfly: DragonflyPresentation | null;
  sloth: SlothPresentation | null;
  lucy?: LucyPresentation | null; // optional: a page left open across a deploy may read an older server
  dream?: DreamPresentation | null; // asleep: the dream (optional: older servers)
  encounters: ('squirrel_sloth' | 'squirrel_dragonfly' | 'dragonfly_sloth' | 'lucy_squirrel')[]; // visitors meeting right now (art)
  drey: DreyLook;
  // The week's hike (from behaviour.hike): the plan Home announces, and on the day two pairs of hiking
  // boots by the pot (theirs). Absent without a forecast.
  hike?: { boots: boolean; plan: HikePlan };
  atmosphere: {
    theme: 'day' | 'night';
    phase: string;
    scene: SceneId;
    season: Season;
    seasonStage: 'early' | 'mid' | 'late';
    intensity: number; // 0-1: how strongly the scene shows (follows the state's intensity)
    weather: WeatherLook | null; // outside weather layer (null = unknown or stale)
    // Today's sunrise and sunset (ms): the twilight layer follows them to the minute
    sun: { sunrise: number | null; sunset: number | null; timesFrom: 'open-meteo' | 'solar' | 'none' };
    // The twilight now (from behaviour): which moment, minutes from it at `at`, and whether clouds mute it
    twilight: { event: 'sunrise' | 'sunset' | null; minutes: number | null; at: number; muted: boolean };
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

import { CONDITION_LABELS } from '../health/labels';
import type { HealthModifier, StressSummary } from '../health/healthTypes';
import type { Season } from '../perception/season';
import type { CareLine, Concern, DayLine, IntensityTier, MessageIntent, MusingId, ObservationId, RecoveryStage, SeasonalCare } from './behaviourTypes';

// The tree's words. Gentle and plant-centred, never blaming.
// Only wording lives here: behaviour works with intents/tiers/ids, so any sentence can be rewritten freely.

type Lines = string[];

// Variants per intent, optionally per tier ("thirst:strong") or recovery stage ("recovery:perking").
// Lookup: "intent:stage" → "intent:tier" → "intent".
export const MESSAGE_CATALOG: Record<string, Lines> = {
  joy: ["I'm thriving. Everything feels just right. 🌿", 'Bright, steady, happy. 🌿', 'This is a good day to grow. 🌱'],
  content: ['I feel comfortable and content. 🍃', 'All calm here. 🍃', "I'm doing well. 🍃", 'A quiet, comfortable moment. 🍃'],
  afterglow: ['Feeling more like myself again. 🍃', 'Back to calm. That feels good. 🍃', 'Settled again, finally. 🍃'],
  watchful: ["I'm okay for now, but {concern}. 🍃", 'Mostly fine, though {concern}. 🍃', 'Nothing serious yet, but {concern}. 🍃'],

  'thirst:mild': ["I'm starting to get a little thirsty. 💧", 'My soil is getting a bit dry. 💧', 'I could use some water soon. 💧'],
  'thirst:moderate': ["I'm getting thirsty now. 💧", 'My soil has been dry for a while. 💧', 'A drink would be lovely. 💧'],
  'thirst:strong': ["I'm really thirsty. 💧", "It's been dry for a long time now. 💧", 'I could really use some water. 💧'],
  'very_dry:moderate': ['My soil is very dry. Please give me water. 💧', "I'm parched. Water, please. 💧", 'This is too dry for me. 💧'],
  'very_dry:strong': ["I've been far too dry for too long. 💧", "I'm struggling. Please water me deeply. 💧", 'Please, water. I am wilting. 💧'],
  'overwatered:mild': ['My roots feel soggy. 🌧', "I'm a bit too wet down there. 🌧", 'The soil is staying very wet. 🌧'],
  'overwatered:moderate': ['My roots have been soggy for a while. 🌧', 'I need to dry out a little. 🌧', 'Too much water, for too long. 🌧'],
  'overwatered:strong': ['My roots have been wet for so long. 🌧', 'I really need this soil to dry out. 🌧', 'Soggy roots for days is hard on me. 🌧'],
  'heat:mild': ["It's getting warm out here. ☀️", 'Warm. I can feel it in my leaves. ☀️', 'A little hot for my taste. ☀️'],
  'heat:moderate': ["It's hot. I'm feeling the heat. ☀️", 'This heat is wearing on me. ☀️', 'Some shade would be nice. ☀️'],
  'heat:strong': ['This heat has gone on too long. 🔥', "It's been hot for hours. I'm tired. 🔥", 'Please, some shade. 🔥'],
  heat_and_drought: ["It's hot and my soil is drying fast. 🔥💧", 'Heat and dry soil together. Water and shade, please. 🔥💧', "I'm baking and thirsty. 🔥💧"],
  'cold:mild': ["Brrr, it's a bit chilly. ❄️", 'A little cold out here. ❄️', 'I prefer it warmer than this. ❄️'],
  'cold:moderate': ["It's cold. I'm pulling in. ❄️", 'This chill is lasting. ❄️', 'A warmer spot would help. ❄️'],
  'cold:strong': ["It's been cold for a long time. ❄️", 'Cold for hours. Please bring me somewhere warmer. ❄️', "I'm getting really chilled. ❄️"],
  freezing: ["It's dangerously cold! Please bring me inside. 🥶", 'Freezing. I could get hurt. 🥶', 'Too cold for me. Please move me somewhere warm. 🥶'],
  needs_light: ["It's been dim all day. 🌥", 'I could use a brighter spot. 🌥', 'Not much light for me today. 🌥'],
  dazzled: ["Whoa, that's bright! 😎", 'Very bright light. Squinting a little. 😎', 'So much light! 😎'],
  dry_air: ['The air feels dry around my leaves. 🍂', 'Dry air today. 🍂', 'My leaves would like a bit more moisture in the air. 🍂'],
  humid_air: ["It's very humid around me. 💨", 'Damp, still air. 💨', 'So humid. A breeze would be nice. 💨'],

  'recovery:relief': ['That feels better. Thank you. 🌱', 'Ahh, relief. 🌱', "I'm feeling better already. 🌱"],
  'recovery:perking': ["I'm slowly perking back up. 🌱", 'Getting back to myself. 🌱', 'A little stronger every hour. 🌱'],
  'recovery:settling': ['Almost myself again. 🌱', 'Nearly recovered. 🌱', 'Settling back into calm. 🌱'],

  sleep: ['Resting for the night. 🌙', 'Goodnight. 🌙', 'Sleeping. 🌙'],
  overwhelmed: ['Several things are bothering me at once. 😟', "It's a lot right now. 😟", 'Too many things at once. 😟'],
  sensor_confused: ["I can't quite feel my roots right now. 🤔", 'My senses have gone quiet. 🤔', "I don't know how I'm doing right now. 🤔"],

  watering_relief: ['Ahhh. That was refreshing. Thank you. 💧', 'Oh, thank you. I needed that. 💧', 'Water! That feels so good. 💧'],
  watering_enough: ["I think I've had enough water for now. 🌧", "Thank you, but I'm already quite wet. 🌧", "That's more than I need right now. 🌧"],
  watering_gentle_ack: ['Thank you, that helps me settle. 🌱', 'Gentle care. Just right. 🌱', 'Thank you. I am getting there. 🌱'],
  watering_thanks: ["Thank you. I'm nicely watered now. 🍃", 'Fresh water. Thank you. 🍃', 'Thanks. That will last me a while. 🍃'],
  care_pruning: ['A little lighter now. Thank you for shaping me. ✂️', 'Neatly trimmed. ✂️', 'Thank you. I will grow back fuller. ✂️'],
  care_fertilizing: ['Mm, a little nourishment. Thank you. 🌱', 'Food for growing. Thank you. 🌱'],
  care_repotting: ['A new home… I need a few days to settle in. 🪴', 'New soil around my roots. Give me time. 🪴'],
  care_moved: ['New surroundings. I am taking it all in. 👀', 'A new spot. Let me get used to it. 👀'],
};

const TIPS: Partial<Record<MessageIntent, string>> = {
  joy: 'All measured conditions have been in the comfort zone for a while.',
  content: 'Conditions are steady and within a healthy range.',
  afterglow: 'Conditions are good again; the tree is still settling after the last stress.',
  watchful: "Not a problem yet; I'll say so if it lasts.",
  thirst: 'Check the top 2 cm of soil and water thoroughly if dry.',
  very_dry: 'Water slowly and deeply; a very dry pot can shed water at first.',
  overwatered: 'Hold off watering and check the pot drains freely.',
  heat: 'Some shade or air flow in the afternoon helps.',
  heat_and_drought: 'Heat speeds up drying. Water now and give some shade.',
  cold: 'Ficus can drop leaves in cold drafts. Keep it sheltered.',
  freezing: 'Near-freezing temperatures damage a ficus quickly.',
  needs_light: 'Ficus likes bright, filtered daylight for several hours a day.',
  dazzled: 'Very strong light. Fine for now; light needs will be calibrated later.',
  dry_air: 'Low humidity dries leaves; grouping plants helps.',
  humid_air: 'Good air circulation helps prevent fungal problems.',
  recovery: 'Conditions are back in range; recovery takes a few hours.',
  sleep: 'Darkness at night is normal; the tree barely drinks while it sleeps.',
  overwhelmed: 'Fix the most serious issue first; see the details.',
  sensor_confused: 'Check that the ESP32 is powered and on Wi-Fi.',
  watering_relief: 'Fresh water is soaking into the roots.',
  watering_enough: 'Let it dry out a little before the next watering.',
  watering_gentle_ack: 'Steady care while recovering is just right.',
  watering_thanks: 'It was not thirsty yet, so no need to water again soon.',
  care_pruning: 'New shoots usually appear near the cuts in a few weeks.',
  care_fertilizing: 'Feed lightly during the growing season only.',
  care_repotting: 'Keep it out of strong sun and wind for a week or two.',
  care_moved: 'A ficus may drop a few leaves after a move; that is normal.',
};

export const OBSERVATION_LINES: Record<ObservationId, Lines> = {
  thirsty_since_yesterday: ["I've been thirsty since yesterday.", 'This dryness started yesterday.'],
  lots_of_water_today: ["I've already had quite a lot of water today.", 'That is a lot of water for one day.'],
  usually_notices_thirst: ['You usually notice when I start getting dry.', 'You tend to notice when I get dry.'],
  typical_recovery: ['I usually feel like myself again after about {hours}h.', 'Recovery usually takes me about {hours}h.'],
};

export const DAY_LINES: Record<DayLine, Lines> = {
  morning_calm: ['A calm night.', 'Good morning. A quiet night.', 'Rested.'],
  morning_after_stress: ["I'm feeling a little better this morning.", 'That was a long night.', 'Morning. The night was not easy.'],
  evening_after_heat: ['That was a warm day.', 'What a hot day it was.', 'The heat is finally easing.'],
  evening_after_stress: ['That was a long day.', 'Glad this day is ending.', 'A tiring day.'],
  // The sun's real moments (sunrise / sunset at the tree's location)
  sunrise_greeting: ['The sun is up. Good morning. 🌅', 'Here comes the sun. 🌅', 'First sunlight. Waking up. 🌅'],
  sunset_line: ['The sun is going down. 🌇', 'Sunset soon. Winding down. 🌇', 'The light is getting golden. 🌇'],
  season_spring: ['Spring! I can feel new leaves coming.', 'The days are longer. Time to grow.', 'Spring is here. Waking up properly now.'],
  season_summer: ['Summer. Long bright days ahead.', 'Summer is here. I will be thirstier now.', 'Long days, warm nights. Summer.'],
  season_autumn: ['Autumn. The days are getting shorter.', 'I can feel autumn coming in.', 'Shorter days now. I will slow down a little.'],
  season_winter: ['Winter. Time to rest.', 'Short days. I am slowing right down.', 'Winter is here. I will drink much less now.'],
  // Outside weather: context only. Never claims the tree is wet or cold: the sensors inside say how it is.
  weather_rain: ['Rain outside. Dry and calm in here.', 'I can hear the rain out there.', 'Wet out there today. Sheltered in here.'],
  weather_storm: ['A storm outside. Quiet in here.', 'Thunder out there. I am fine in here.', 'Stormy outside today.'],
  weather_fog: ['Foggy outside this morning.', 'The world is grey with fog out there.', 'Fog outside. Soft light today.'],
  weather_snow: ['Snow outside!', 'It is snowing out there.', 'Snow falling outside. Warm enough in here.'],
  weather_cold_outside: ['Cold out there. Sheltered in here.', 'It is cold outside today.', 'Freezing out there. Glad to be inside.'],
};

// About recent care. Context, never health claims the sensors can't prove.
export const CARE_LINES: Record<CareLine, Lines> = {
  settling_in: ['Still settling into my new pot.', 'My roots are getting used to the new soil.', 'Settling in, slowly.'],
  new_spot: ['Still getting to know this new spot.', 'New place, new light. Learning it.', 'This spot is new to me.'],
  new_shape: ['Getting used to my new shape.', 'A little lighter since the pruning.', 'Growing into my new shape.'],
};

// What the time of year adds to a care reaction (diffraction). Appended to the reaction line and its tip.
export const SEASONAL_CARE_LINES: Record<SeasonalCare, Lines> = {
  resting_drink: ["I'll drink it slowly; I'm resting for the winter.", 'In winter I take my time with water.'],
  growing_drink: ['Summer days dry me out fast.', 'Growing season: I go through water quickly.'],
  resting_wet: ['Wet soil stays wet a long time while I grow slowly.', 'I barely drink at this time of year.'],
  growing_prune: ["Good timing. I'm growing fast, new shoots will come soon.", 'I will fill this in quickly while I am growing.'],
  resting_prune: ["I'll be slow to fill in until spring.", 'New shoots will wait for longer days.'],
  in_season_feed: ['Just when I am growing.', 'Good timing for it.'],
  off_season_feed: ["I'm not really growing right now, though.", 'I will not use much of it until spring.'],
  growing_repot: ['My roots will settle quickly while I am growing.', 'Good season for new roots.'],
  resting_repot: ['My roots will take a while to settle at this time of year.', 'Settling in will be slow until spring.'],
};
const SEASONAL_CARE_TIPS: Record<SeasonalCare, string> = {
  resting_drink: 'In winter a ficus uses little water: let the top of the soil dry before the next watering.',
  growing_drink: 'In summer the pot can dry within days; check it more often.',
  resting_wet: 'Soil dries slowly in the cool months; wait longer between waterings.',
  growing_prune: 'Spring and summer are the best time to prune: regrowth is fast.',
  resting_prune: 'Outside the growing season, keep pruning light; regrowth waits for spring.',
  in_season_feed: 'Feeding every few weeks in the growing season is fine.',
  off_season_feed: 'Outside the growing season, feeding is best paused until spring.',
  growing_repot: 'Repotting in the growing season lets roots recover fastest.',
  resting_repot: 'Roots recover slowly in the cool months; keep it sheltered and water sparingly.',
};

// Thoughts of a calm day. Each one is a fact the sensors (or the history) can back; {placeholders} are facts.
// Lines are what the tree says; tips are the plain detail under it.
export const MUSING_LINES: Record<MusingId, Lines> = {
  soil_steady: ['My soil is still comfortable. 🍃', 'Soil at {soil}%: just right. 🍃', 'My roots are happy with this soil. 🍃'],
  days_since_water: ["It's been {days} days since my last drink. Still fine. 💧", '{days} days on one watering, and still comfortable. 💧', 'No water for {days} days, and I am fine. 💧'],
  brightest_hour: ['That was my brightest hour today. ☀️', 'The best light of the day has passed. ☀️', 'I soaked up the brightest part of the day. ☀️'],
  good_light_day: ['Plenty of light today. ☀️', 'A good light day. ☀️', 'Lots of useful light today. ☀️'],
  days_shorter: ['The days are getting shorter. 🍂', 'A little less daylight every day now. 🍂', 'Shorter days. I can feel it. 🍂'],
  days_longer: ['The days are getting longer. 🌱', 'A little more daylight every day. 🌱', 'Longer days. Growing time is coming. 🌱'],
  humid_morning: ['Humid in here this morning. 💧', 'A damp, still morning. 💧', 'Moist air around my leaves this morning. 💧'],
  warmest_hour: ['This is the warmest part of the day. 🌤', 'Nicely warm right now. 🌤', 'Warmest hour so far. 🌤'],
  warmer_than_outside: ['Much warmer in here than outside. 🏡', 'Sheltered and warm in here. 🏡', 'Cool out there, comfortable in here. 🏡'],
  squirrel_came: ['A squirrel came by today. 🐿️', 'I had a visitor today. 🐿️', 'The squirrel visited me today. 🐿️'],
  sloth_came: ['A sloth spent a slow while in my branches. 🦥', 'I had a very slow visitor today. 🦥', 'A sloth hung around for a while. 🦥'],
  dragonfly_came: ['A dragonfly hovered by today. ✨', 'I had a dragonfly on my leaves today. ✨', 'Warm, bright air: a dragonfly came. ✨'],
  visitors_met: ['The {pair} are sharing my branches. 🌿', 'Company in my branches: the {pair}. 🌿', 'The {pair}, both in my branches at once. 🌿'],
  new_tips: ['New leaf tips are coming in. 🌱', 'I am filling out again. 🌱', 'Fresh leaves, one by one. 🌱'],
  drey_growing: ['Someone is building a nest in my crown. 🪺', 'More twigs in my crown today. 🪺', 'A little home is taking shape up top. 🪺'],
};
const fmtHours = (h: number) => (h >= 36 ? `${Math.round(h / 24)} days` : h >= 2 ? `${Math.round(h)} hours` : 'a couple of hours');
const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
export const MUSING_TIPS: Record<MusingId, (f: Record<string, number>) => string> = {
  soil_steady: (f) => (f.hoursToThirsty > 0 ? `Soil at ${f.soil}%. At this pace I'd get thirsty in about ${fmtHours(f.hoursToThirsty)}.` : `Soil at ${f.soil}%, barely drying right now.`),
  days_since_water: (f) => `Last watered ${f.days} days ago; the soil is still in range, so no need to water yet.`,
  brightest_hour: (f) => `Light peaked at ${f.peak}% (relative LDR) today.`,
  good_light_day: (f) => `About ${f.usefulHours}h of useful light so far today.`,
  days_shorter: (f) => `About ${f.minPerDay} min less daylight each day (${f.daylight}h today). Growth slows as days shorten.`,
  days_longer: (f) => `About ${f.minPerDay} min more daylight each day (${f.daylight}h today). Growth picks up as days lengthen.`,
  humid_morning: (f) => `Humidity ${f.rh}% inside.${f.fog ? ' The glass may fog; airing the balcony for a while helps.' : ' Some air flow later in the day helps.'}`,
  warmest_hour: (f) => `${f.temp}°C now, the warmest reading of the day so far.`,
  warmer_than_outside: (f) => `${f.inside}°C in here, ${f.outside}°C outside.`,
  squirrel_came: (f) => `${f.count} visit${f.count > 1 ? 's' : ''} today, the first around ${clock(f.firstAt)}. They come when the tree has been a good place to be.`,
  sloth_came: (f) => `${f.count} visit${f.count > 1 ? 's' : ''} today, about ${f.minutes >= 90 ? `${Math.round((f.minutes / 60) * 10) / 10} h` : `${f.minutes} min`} in all. Sloths like warm, humid, still air.`,
  dragonfly_came: (f) => `${f.count} dragonfly visit${f.count > 1 ? 's' : ''} today, the first around ${clock(f.firstAt)}. They come with warm, bright, calm air.`,
  visitors_met: (f) =>
    [
      'The squirrel keeps to another branch and peeks at the sloth; the sloth turns its head, very slowly.',
      "The squirrel's eyes follow the dragonfly; it never lands right next to the squirrel.",
      'The dragonfly rests on the sloth, which blinks, very slowly.',
    ][f.pair] ?? 'Two visitors in the tree at once.',
  new_tips: (f) => `The canopy is refilling (${f.fullness}% full) after a harder stretch.`,
  drey_growing: () => 'A squirrel has started a drey in the crown: weeks of a welcoming tree.',
};

// Seasonal care, added to the calm tips (ficus is evergreen; growth follows day length).
const SEASON_TIPS: Record<Season, string> = {
  spring: 'Spring: new growth starts. Water a little more as it warms; light feeding is fine.',
  summer: 'Summer: the growing season. The pot dries fastest now; feeding every few weeks is fine.',
  autumn: 'Autumn: growth slows as days shorten. Water a bit less, stop feeding. A few yellow leaves are normal.',
  winter: 'Winter: resting. Water sparingly, no feeding, and keep it away from frost and cold drafts.',
};
const SEASON_TIP_INTENTS: MessageIntent[] = ['joy', 'content', 'afterglow', 'sleep'];

const CONCERN_PHRASE: Record<string, string> = {
  'soil:Waterlogged': 'my soil feels very wet',
  'soil:Wet': 'my soil feels quite wet',
  'soil:Thirsty': 'my soil is drying out',
  'soil:Very Dry': 'my soil is very dry',
  'temperature:Cold': "it's a bit cold",
  'temperature:Freezing risk': "it's getting very cold",
  'temperature:Hot': "it's getting warm",
  'temperature:Too hot': "it's really hot",
  'humidity:Dry air': 'the air feels dry',
  'humidity:Very dry air': 'the air feels very dry',
  'humidity:Very humid': 'the air is very humid',
  'humidity:Saturated': 'the air is soaking wet',
  'light:Low': "it's a little dim",
  'light:Very Dark': "it's very dark for daytime",
};

const MODIFIER_HINT: Partial<Record<HealthModifier, string>> = {
  hot: 'It is also hot.',
  cold: 'It is also cold.',
  freezing_risk: 'It is near freezing.',
  thirsty: 'The soil is drying out.',
  very_dry: 'The soil is very dry.',
  too_wet: 'The soil has been wet for a long time.',
  dry_air: 'The air is dry.',
  high_humidity: 'The air is very humid.',
  too_dark: 'Light has been low.',
  very_bright: 'Light is very strong.',
};

const hrs = (h: number) => (h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : `${Math.round(h)}h`);

// Which catalog entry an intent/tier/stage uses (also what the speech policy treats as "the same thing").
export function messageKey(intent: MessageIntent, tier: IntensityTier, stage: RecoveryStage | null): string {
  if (stage && MESSAGE_CATALOG[`${intent}:${stage}`]) return `${intent}:${stage}`;
  if (MESSAGE_CATALOG[`${intent}:${tier}`]) return `${intent}:${tier}`;
  if (MESSAGE_CATALOG[intent]) return intent;
  // Fall back to the nearest tier that has lines
  for (const t of ['moderate', 'mild', 'strong']) if (MESSAGE_CATALOG[`${intent}:${t}`]) return `${intent}:${t}`;
  return 'content';
}

export const variantCount = (key: string) => MESSAGE_CATALOG[key]?.length ?? 1;

export interface RenderInput {
  key: string;
  intent: MessageIntent;
  variant: number; // chosen by the speech policy; wraps around
  concern: Concern | null;
  observation: { id: ObservationId; hours?: number } | null; // include only when it should be said
  dayLine: DayLine | null; // include only when it should be said
  careLine?: CareLine | null; // include only when it should be said
  modifiers: HealthModifier[];
  stress: StressSummary;
  isEstimate: boolean;
  reactionWhy: string | null;
  season?: Season;
  seasonalCare?: SeasonalCare | null; // how the time of year changes the meaning of a care reaction
  musing?: { id: MusingId; facts: Record<string, number>; variant: number } | null; // a thought of the day, while shown
}

// Facts that stand for words (an index into these lists)
const FACT_WORDS: Record<string, string[]> = {
  pair: ['squirrel and the sloth', 'squirrel and a dragonfly', 'dragonfly and the sloth'], // ENCOUNTER_PAIRS order
};

export function renderMessage(r: RenderInput): { text: string; tip: string } {
  if (r.musing) {
    // A thought of the day: its own line and its own grounded detail
    const ls = MUSING_LINES[r.musing.id];
    const line = ls[((r.musing.variant % ls.length) + ls.length) % ls.length];
    const text = line.replace(/\{(\w+)\}/g, (_, k) => FACT_WORDS[k]?.[r.musing!.facts[k]] ?? String(r.musing!.facts[k] ?? ''));
    return { text, tip: MUSING_TIPS[r.musing.id](r.musing.facts) };
  }
  const lines = MESSAGE_CATALOG[r.key] ?? MESSAGE_CATALOG.content;
  const pick = <T,>(xs: T[]) => xs[((r.variant % xs.length) + xs.length) % xs.length];
  let text = pick(lines);
  text = text.replace('{concern}', (r.concern && CONCERN_PHRASE[`${r.concern.metric}:${r.concern.status}`]) ?? 'something feels a little off');
  if (r.isEstimate && r.intent === 'thirst') text = `I think ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
  if (r.dayLine) text = `${pick(DAY_LINES[r.dayLine])} ${text}`;
  if (r.careLine) text = `${text} ${pick(CARE_LINES[r.careLine])}`;
  if (r.observation) text = `${text} ${pick(OBSERVATION_LINES[r.observation.id]).replace('{hours}', String(r.observation.hours ?? ''))}`;
  if (r.seasonalCare) text = `${text} ${pick(SEASONAL_CARE_LINES[r.seasonalCare])}`;

  let tip = TIPS[r.intent] ?? '';
  const s = r.stress;
  if ((r.intent === 'thirst' || r.intent === 'very_dry' || r.intent === 'heat_and_drought') && s.dryHours >= 1) tip = `Dry for about ${hrs(s.dryHours)}. ${tip}`;
  if (r.intent === 'overwatered' && s.wetHours >= 1) tip = `Wet for about ${hrs(s.wetHours)}. ${tip}`;
  if (r.intent === 'recovery' && s.recoveringFrom) {
    const left = s.recoveryRemainingHours;
    tip = `Recovering from ${CONDITION_LABELS[s.recoveringFrom].toLowerCase()}${left ? `; about ${hrs(left)} to go` : ''}. ${tip}`;
  }
  if (r.seasonalCare) tip = `${tip} ${SEASONAL_CARE_TIPS[r.seasonalCare]}`;
  if (r.reactionWhy) tip = `${r.reactionWhy[0].toUpperCase()}${r.reactionWhy.slice(1)}. ${tip}`;
  const hints = r.modifiers.map((m) => MODIFIER_HINT[m]).filter(Boolean);
  if (hints.length > 0 && !r.intent.startsWith('watering') && !r.intent.startsWith('care')) tip = `${hints.slice(0, 2).join(' ')} ${tip}`;
  if (r.season && SEASON_TIP_INTENTS.includes(r.intent)) tip = `${tip} ${SEASON_TIPS[r.season]}`;
  return { text, tip: tip.trim() };
}

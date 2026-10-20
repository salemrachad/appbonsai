import type { DreamState, PlantBehaviourState } from '../behaviour/behaviourTypes';
import { dreamScene } from '../behaviour/messages';
import type { ExpressionState } from '../expression/expressionTypes';
import type { HealthCondition, LatchDebug, PlantHealthState } from '../health/healthTypes';
import { CONDITION_LABELS } from '../health/labels';
import { STRESS_CONDITIONS } from '../health/statePriority';
import type { PerceptionState } from '../perception/perceptionTypes';
import type { SpeciesProfile } from '../species';
import type { LatchId, LatchRule } from '../species/types';
import { HOUR, MIN, hhmm } from '../lib/time';

// "Why": the tree explained to the people who care for it, by a gentle narrator (third person, plain words),
// from the state the engines already concluded. It never decides anything: it reads health, behaviour,
// expression and perception and says what they mean, with the exact figures kept for a tap. Only true things,
// and nothing when there is nothing to say. Separate from the tree's own words (messages.ts): the tree speaks
// rarely and in its voice; this explains, whenever someone wants to know.

export type WhyIcon = 'leaf' | 'eye' | 'heart' | 'smile' | 'wind' | 'clock' | 'globe' | 'moon' | 'signal';
export interface WhyCard {
  id: 'now' | 'watching' | 'vitality' | 'mood' | 'body' | 'before' | 'around' | 'night' | 'trust';
  icon: WhyIcon;
  title: string;
  body: string;
  details: string[]; // the exact figures, shown on tap
}

export interface WhyInput {
  perception: PerceptionState;
  health: PlantHealthState;
  behaviour: PlantBehaviourState;
  expression: ExpressionState;
  species: SpeciesProfile;
  now: number;
}

// ---- words ----

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const sentence = (s: string) => (s && !/[.!?]$/.test(s) ? `${s}.` : s);

// A duration as a person says it
export function inWords(ms: number): string {
  const m = Math.max(0, Math.round(ms / MIN));
  if (m < 2) return 'a moment';
  if (m < 55) return `${m} minutes`;
  const h = ms / HOUR;
  if (h < 1.25) return 'about an hour';
  if (h < 1.75) return 'an hour and a half';
  if (h < 36) return `about ${Math.round(h)} hours`;
  const d = h / 24;
  return d < 1.75 ? 'about a day and a half' : `about ${Math.round(d)} days`;
}

// What each latch looks at, and what it means, in the narrator's words
const LATCH: Record<LatchId, { metric: string; unit: string; noun: string }> = {
  thirsty: { metric: 'the soil', unit: ' %', noun: 'thirsty' },
  very_dry: { metric: 'the soil', unit: ' %', noun: 'very dry' },
  too_wet: { metric: 'the soil', unit: ' %', noun: 'waterlogged' },
  hot: { metric: 'the air', unit: ' °C', noun: 'too hot' },
  cold: { metric: 'the air', unit: ' °C', noun: 'too cold' },
  freezing_risk: { metric: 'the air', unit: ' °C', noun: 'at risk of frost' },
  dry_air: { metric: 'the humidity', unit: ' %', noun: 'in air that is too dry' },
  high_humidity: { metric: 'the humidity', unit: ' %', noun: 'in heavy, humid air' },
  low_daily_light: { metric: "today's share of good light", unit: ' %', noun: 'short of light today' },
  very_bright: { metric: 'the light', unit: ' %', noun: 'dazzled' },
  night_rest: { metric: 'the light', unit: ' %', noun: 'asleep' },
  thriving: { metric: 'its vitality', unit: '', noun: 'thriving' },
};
// The condition a latch makes (and back)
const LATCH_OF: Partial<Record<HealthCondition, LatchId>> = {
  thirsty: 'thirsty',
  very_dry: 'very_dry',
  too_wet: 'too_wet',
  hot: 'hot',
  cold: 'cold',
  freezing_risk: 'freezing_risk',
  dry_air: 'dry_air',
  high_humidity: 'high_humidity',
  too_dark: 'low_daily_light',
  very_bright: 'very_bright',
  sleeping: 'night_rest',
  thriving: 'thriving',
};

const num = (n: number) => String(Math.round(n * 10) / 10);
const ruleOf = (id: LatchId, species: SpeciesProfile, night: boolean): LatchRule | null => {
  const r = (species.latches as Partial<Record<LatchId, LatchRule>>)[id];
  return r ? { ...r, ...(night && r.night ? r.night : {}) } : null;
};
// Latch durations are in minutes in the species profile (ficus.ts keeps its own MIN)
const minutes = (m: number) => m * MIN;
// "When the soil stays below 35 % for 30 minutes, it counts as thirsty; it lets go once it is back above 40 %
// for 5 minutes."
function ruleWords(id: LatchId, species: SpeciesProfile, night: boolean): string | null {
  const r = ruleOf(id, species, night);
  const w = LATCH[id];
  if (!r || id === 'thriving') return null;
  const [into, outOf] = r.direction === 'below' ? ['below', 'above'] : ['above', 'below'];
  return `When ${w.metric} stays ${into} ${num(r.enter)}${w.unit} for ${inWords(minutes(r.enterAfterMin))}, it counts as ${w.noun}; it lets go once ${w.metric === 'the soil' ? 'the soil is' : 'it is'} back ${outOf} ${num(r.exit)}${w.unit} for ${inWords(minutes(r.exitAfterMin))}.`;
}
const valueWords = (l: LatchDebug | undefined) => {
  if (!l || l.value === null || l.id === 'data_uncertain' || l.id === 'thriving') return null;
  const w = LATCH[l.id as LatchId];
  return `${cap(w.metric)} is at ${num(l.value)}${w.unit}.`;
};

const MOOD_WORDS: Record<string, string> = {
  joyful: 'joyful', content: 'content', tired: 'tired', watchful: 'watchful', relieved: 'relieved', grateful: 'grateful',
  patient: 'patient', uneasy: 'uneasy', uncomfortable: 'uncomfortable', distressed: 'distressed', overwhelmed: 'overwhelmed',
  sleepy: 'sleepy', confused: 'unsure', concerned: 'concerned', dazzled: 'dazzled',
};
const FOLIAGE_WORDS: Partial<Record<string, string>> = {
  vivid: 'glossy and vivid', tender: 'a fresh, light green', deep: 'a deep, quiet green', thirsty: 'a dull grey-green', parched: 'yellow-brown and crisp',
  scorched: 'sun-bleached at the edges', soaked: 'dark and heavy', frosted: 'white at the edges', frozen: 'iced and blue-grey', curled: 'pale, their edges rolled',
  dewy: 'beaded with moisture', dim: 'pale and stretched', washed: 'washed out',
};
const GESTURE_WORDS: Record<string, string> = {
  wiggle: 'wiggles', sigh: 'sighs', shiver_burst: 'shivers', yawn: 'yawns', shake_off: 'shakes drops off its leaves', fan: 'fans itself with a branch',
  stretch_up: 'reaches up toward the light', look_around: 'looks around', nod_off: 'nods off', shield: 'shields its eyes with a pad', tremble: 'trembles', tilt: 'tilts',
};
const SKY_WORDS: Record<string, string> = {
  clear: 'clear', partly_cloudy: 'partly cloudy', overcast: 'grey and overcast', fog: 'foggy', drizzle: 'drizzly', rain: 'raining', heavy_rain: 'pouring',
  snow: 'snowing', thunderstorm: 'stormy',
};
const GREY_SKIES = ['overcast', 'fog', 'drizzle', 'rain', 'heavy_rain', 'snow', 'thunderstorm'];

// ---- the cards ----

function nowCard(i: WhyInput): WhyCard {
  const { health: h, behaviour: b, species, perception: p, now } = i;
  const c = h.condition;
  const night = !p.sun.isDay;
  const since = h.activeSince[c] ?? b.episode.startedAt;
  const latchById = new Map(h.hysteresis.map((l) => [l.id, l]));
  const details: string[] = [];
  const explain = (id: LatchId) => {
    const l = latchById.get(id);
    if (l) details.push(`${id.replace(/_/g, ' ')}: ${l.rule}${l.value !== null ? ` · now ${num(l.value)}` : ''}${l.observedMinutes !== null ? ` · ${l.observedMinutes} min observed` : ''}`);
    return [valueWords(l), ruleWords(id, species, night)].filter(Boolean).join(' ');
  };
  let title = `${CONDITION_LABELS[c]} since ${hhmm(since)}`;
  let body: string;
  if (c === 'sensor_uncertain') {
    title = 'Not sure right now';
    body = `It can't trust its readings at the moment${h.dataIssues[0] ? ` (${h.dataIssues[0].toLowerCase()})` : ''}. Rather than guess, it keeps the last state it was sure of until the readings make sense again.`;
  } else if (c === 'comfortable') {
    title = `Comfortable since ${hhmm(since)}`;
    body = 'Its soil, air and light are all within what a ficus likes.';
    if (b.afterglow && b.previousState) body += ` It came out of being ${CONDITION_LABELS[b.previousState].toLowerCase()} not long ago, so it is still a little subdued.`;
  } else if (c === 'thriving') {
    body = 'No stress at all, and its vitality has stayed above 90 for two hours or more: that is when it counts as thriving.';
  } else if (c === 'recovering') {
    const from = h.stress.recoveringFrom;
    const left = h.stress.recoveryRemainingHours;
    const stage = b.recoveryStage === 'relief' ? 'It is in the first relief' : b.recoveryStage === 'perking' ? 'It is perking up' : 'It is settling back';
    body = `${from ? `It went through being ${CONDITION_LABELS[from].toLowerCase()}. ` : ''}Conditions are healthy again, but a plant doesn't bounce back at once. ${stage}${left ? `, with about ${inWords(left * HOUR)} of calm still to go` : ''}.`;
  } else if (c === 'sleeping') {
    title = `Asleep since ${hhmm(since)}`;
    body = `${p.sun.sunset ? `The sun set at ${hhmm(p.sun.sunset)} and its` : 'Its'} light sensor reads dark, so it rests. Darkness at night never counts against it.`;
  } else if (c === 'hot_and_dry') {
    body = `Two stresses at once, heat and dry soil, which weigh more together than apart. ${explain('hot')} ${explain('thirsty')}`;
  } else if (c === 'multiple_stress') {
    const active = h.hysteresis.filter((l) => l.active && l.id !== 'night_rest' && l.id !== 'thriving' && l.id !== 'data_uncertain').map((l) => LATCH[l.id as LatchId].noun);
    body = `Several things are wrong at once: it is ${list(active)}. Together they weigh more than each alone.`;
    h.hysteresis.filter((l) => l.active).forEach((l) => details.push(`${l.id.replace(/_/g, ' ')}: ${l.rule}`));
  } else {
    const id = LATCH_OF[c];
    body = id ? explain(id) : `${CONDITION_LABELS[c]}.`;
  }
  // A stress is felt more the longer it lasts (observed time only)
  if (STRESS_CONDITIONS.includes(c) || c === 'multiple_stress') {
    body += ` It feels it more the longer it lasts: ${b.intensityTier === 'strong' ? 'strongly by now' : b.intensityTier === 'moderate' ? 'clearly by now' : 'only a little so far'}.`;
    details.push(`intensity ${b.intensityTier} · severity ${h.severity} · dry ${num(h.stress.dryHours)} h · wet ${num(h.stress.wetHours)} h`);
  }
  const extras = h.modifiers.filter((m) => m !== 'sensor_uncertain' && m !== c).map((m) => (m === 'sleeping' ? 'asleep' : CONDITION_LABELS[m].toLowerCase()));
  if (extras.length) body += c === 'sensor_uncertain' ? ` Its last known state: ${list(extras)}.` : ` Also ${list(extras)}.`;
  details.push(`episode since ${hhmm(since)} (${b.episode.minutes} min)`);
  return { id: 'now', icon: 'leaf', title, body, details };
}

function watchingCard(i: WhyInput): WhyCard | null {
  const { health: h, behaviour: b, species, perception: p, now } = i;
  const night = !p.sun.isDay;
  const lines: string[] = [];
  const details: string[] = [];
  for (const l of h.hysteresis) {
    if (l.pendingSince === null || l.gated || l.id === 'data_uncertain') continue;
    const id = l.id as LatchId;
    const r = ruleOf(id, species, night);
    const w = LATCH[id];
    if (!r) continue;
    const forMs = now - l.pendingSince;
    const needMs = minutes(l.active ? r.exitAfterMin : r.enterAfterMin) - forMs;
    if (needMs <= 0) continue;
    if (id === 'thriving') lines.push(l.active ? `Its vitality has dipped below 90; if that lasts ${inWords(needMs)} more, it will no longer count as thriving.` : `Its vitality has been above 90 with no stress for ${inWords(forMs)}. ${inWords(needMs)} more and it will count as thriving.`);
    else if (l.active) lines.push(`${cap(w.metric)} has been back ${r.direction === 'below' ? 'above' : 'below'} ${num(r.exit)}${w.unit} for ${inWords(forMs)}. If it holds ${inWords(needMs)} more, it stops being ${w.noun}.`);
    else lines.push(`${cap(w.metric)} has been ${r.direction} ${num(r.enter)}${w.unit} for ${inWords(forMs)}. If it stays there ${inWords(needMs)} more, it will count as ${w.noun}.`);
    details.push(`${id.replace(/_/g, ' ')}: ${l.rule} · crossing since ${hhmm(l.pendingSince)}`);
  }
  if (b.concern) {
    lines.push(`Its ${b.concern.metric} reads "${b.concern.status.toLowerCase()}", not for long enough to change how it is.`);
    details.push(`concern: ${b.concern.metric} ${b.concern.status}`);
  }
  if (!lines.length) return null;
  return { id: 'watching', icon: 'eye', title: 'What it is watching', body: `${lines.join(' ')} Crossing a line for a few minutes never changes it on its own.`, details };
}

function vitalityCard(i: WhyInput): WhyCard {
  const { health: h } = i;
  const bd = h.breakdown;
  const v = Math.round(h.vitality);
  const t = Math.round(bd.target);
  const title = bd.frozen ? `Vitality ${v}, paused` : `Vitality ${v}${t > v + 1 ? `, rising toward ${t}` : t < v - 1 ? `, sliding toward ${t}` : ', steady'}`;
  const scored = bd.components.filter((c) => c.score !== null);
  const low = scored.filter((c) => c.score! < 60).sort((a, b) => a.score! - b.score!).map((c) => c.label.toLowerCase());
  const good = scored.filter((c) => c.score! >= 85).sort((a, b) => b.weight - a.weight).map((c) => c.label.toLowerCase());
  const cost = bd.durationPenalties.reduce((a, p) => a + p.points, 0);
  const parts = ['It is its wellbeing built up over hours, not a single reading: it moves slowly, faster down than up.'];
  if (bd.frozen) parts.push('With no fresh reading, it is held where it was rather than guessed.');
  else {
    if (low.length) parts.push(`${cap(list(low))} ${low.length > 1 ? 'are' : 'is'} holding it back.`);
    if (good.length) parts.push(`${cap(list(good))} ${good.length > 1 ? 'are' : 'is'} in good shape.`);
    if (cost >= 1) parts.push(`Lasting stress costs it about ${Math.round(cost)} points right now.`);
  }
  return {
    id: 'vitality',
    icon: 'heart',
    title,
    body: parts.join(' '),
    details: [
      ...bd.components.map((c) => `${c.label}: ${c.score ?? '–'} × ${c.weight} · ${c.note}`),
      ...bd.durationPenalties.map((p) => `−${num(p.points)} ${p.label} (${p.detail})`),
      `base ${num(bd.weightedBase)} → target ${num(bd.target)} → now ${num(bd.final)}`,
    ],
  };
}

function moodCard(i: WhyInput): WhyCard | null {
  const m = i.behaviour.moodState;
  if (!m) return null;
  const nudges = m.influences.filter((x) => x.source !== 'health');
  const phrases = (up: boolean) =>
    nudges
      .filter((x) => (up ? x.v > 0.005 : x.v < -0.005))
      .flatMap((x) => x.why.split(', ').map((w) => w.split(':')[0].trim()))
      .filter(Boolean);
  const up = phrases(true);
  const down = phrases(false);
  const stressed = i.health.severity !== 'none';
  if (i.health.condition === 'sensor_uncertain')
    return { id: 'mood', icon: 'smile', title: 'Unsure', body: 'It cannot tell how it is right now, so its mood stays neutral: not worried, not pleased, waiting for readings it can trust.', details: m.influences.map((x) => `${x.source}: ${x.why}`) };
  const lively = m.arousal >= 0.6 ? ', and lively' : m.arousal <= 0.25 ? ', and still' : '';
  const parts = [
    stressed
      ? 'Its health sets how good it can feel: under stress it can be comforted, never truly happy.'
      : 'Its health is calm, so the small things of the day can colour its mood.',
  ];
  if (up.length) parts.push(`Lifted by ${list(up)}.`);
  if (down.length) parts.push(`Weighed a little by ${list(down)}.`);
  if (!up.length && !down.length) parts.push('Nothing around it is nudging it either way.');
  return {
    id: 'mood',
    icon: 'smile',
    title: `${cap(MOOD_WORDS[m.label] ?? m.label)}${lively}`,
    body: parts.join(' '),
    details: [`valence ${num(m.valence)} (ceiling ${num(m.ceiling)}) · arousal ${num(m.arousal)}`, ...m.influences.map((x) => `${x.source}: ${x.why} (${x.v >= 0 ? '+' : ''}${num(x.v)})`)],
  };
}

function bodyCard(i: WhyInput): WhyCard | null {
  const { expression: x, behaviour: b, health: h } = i;
  const a = x.avatar;
  const d = x.leafDroop;
  const leaves = d >= 0.7 ? 'its leaves are wilting' : d >= 0.35 ? 'its leaves hang low' : d >= 0.12 ? 'its leaves droop a little' : d < 0 ? 'its leaves are lifted and perky' : 'its leaves are relaxed';
  const sway = x.motion.swayAmount < 0.4 ? 'it is almost still' : x.motion.swaySpeed < 0.8 ? 'it sways slowly' : x.motion.swaySpeed > 1.05 ? 'it sways in a lively way' : 'it sways calmly';
  const tone = FOLIAGE_WORDS[a.foliage];
  const why: string[] = [];
  if (h.condition === 'sleeping' || h.modifiers.includes('sleeping')) why.push('it is asleep');
  else if (b.timeOfDay === 'night') why.push('it is night');
  if (STRESS_CONDITIONS.includes(h.condition) || h.condition === 'multiple_stress') why.push(`being ${CONDITION_LABELS[h.condition].toLowerCase()} takes its energy`);
  if (b.recoveryStage) why.push('it is still recovering');
  if (b.season.energy < 0.95) why.push(`${b.season.id} slows it down`);
  if (b.care.settling > 0.3) why.push('it is settling into a new pot');
  const parts = [`${cap(leaves)}, and ${sway}${why.length ? ` because ${list(why)}` : ''}.`];
  if (tone) parts.push(h.condition === 'sensor_uncertain' ? `Its leaves look ${tone}: that is how it shows it cannot trust its readings.` : `Its leaves look ${tone}: that is how a ficus shows being ${CONDITION_LABELS[h.condition].toLowerCase()}${a.foliageBlend ? `, turning toward the next season` : ''}.`);
  if (a.gesture) parts.push(`Now and then it ${GESTURE_WORDS[a.gesture.kind] ?? a.gesture.kind.replace(/_/g, ' ')}.`);
  parts.push('Its movement follows its energy, never a timer of its own.');
  return { id: 'body', icon: 'wind', title: 'What you see on it', body: parts.join(' '), details: [...x.layers.epidermal, `energy ${b.energy} · droop ${d}`] };
}

function beforeCard(i: WhyInput): WhyCard | null {
  const { behaviour: b, now } = i;
  const parts: string[] = [];
  const details: string[] = [];
  const r = b.reaction;
  if (r) {
    const ago = inWords(now - r.at);
    const said: Record<string, string> = {
      watering_relief: `It was watered ${ago} ago while it was dry, so this drink is a relief; it will perk up over the next hours, not all at once.`,
      watering_enough: `It was watered ${ago} ago while its soil was already wet. More water now only waits in the pot, so there is nothing to celebrate.`,
      watering_gentle_ack: `It was watered ${ago} ago while still recovering: a gentle help.`,
      watering_thanks: `It was watered ${ago} ago while comfortable: a plain thank-you.`,
      care_pruning: `It was pruned ${ago} ago. It moves more gently for a few days${r.seasonal === 'growing_prune' ? ', and in the growing season new shoots will follow' : r.seasonal === 'resting_prune' ? ', and with growth slow now it will be patient about regrowing' : ''}.`,
      care_fertilizing: `It was fed ${ago} ago${r.seasonal === 'off_season_feed' ? ', outside the growing season, so it can do little with it now: patient' : ', in the growing season'}.`,
      care_repotting: `It was repotted ${ago} ago and is getting used to the new soil.`,
      care_moved: `It was moved ${ago} ago and is still learning the new spot's light.`,
    };
    parts.push(said[r.kind] ?? '');
    details.push(`care: ${r.why}`);
  }
  if (b.care.relearningLight && !r) parts.push('It was moved recently, so its light is not judged as too dark while it learns the new spot.');
  if (b.care.settling > 0.3 && !r) parts.push('It was repotted recently, so minor stress is shown more gently.');
  if (b.afterglow && b.previousState) parts.push(`It was ${CONDITION_LABELS[b.previousState].toLowerCase()} until recently: that still colours it for a while.`);
  const obs = b.relationship.observation;
  if (obs) {
    const words: Record<string, string> = {
      thirsty_since_yesterday: 'This dryness started yesterday.',
      lots_of_water_today: 'It has had quite a lot of water today already.',
      usually_notices_thirst: 'You usually notice when it starts getting dry.',
      typical_recovery: 'It usually takes it a few hours to feel itself again after a stress like this.',
    };
    parts.push(words[obs.id] ?? '');
  }
  const cn = b.canopy;
  if (cn.fullness < 0.985) parts.push(`Its canopy is about ${Math.round(cn.fullness * 100)} % full after a hard stretch in the last weeks${cn.trend === 'refilling' ? ', and it is refilling with fresh tips' : cn.trend === 'thinning' ? ', and still thinning' : ''}.`);
  details.push(...b.care.effects, ...cn.reasons);
  const text = parts.filter(Boolean);
  if (!text.length) return null;
  return { id: 'before', icon: 'clock', title: 'Because of what came before', body: `${text.join(' ')} The same moment can mean different things depending on what led to it.`, details };
}

function aroundCard(i: WhyInput): WhyCard | null {
  const { perception: p, behaviour: b, expression: x } = i;
  const parts: string[] = [];
  const details: string[] = [];
  const o = p.outside;
  if (o) {
    const inside = p.readings.temperature;
    parts.push(`Outside it is ${SKY_WORDS[o.sky] ?? o.sky.replace(/_/g, ' ')}${o.temperature !== null ? ` and ${Math.round(o.temperature)}°` : ''}${inside !== null ? `; inside the greenhouse it is ${Math.round(inside)}°` : ''}. The weather is context: only the sensors inside say how the tree is.`);
    if (GREY_SKIES.includes(o.sky) && p.sun.isDay) parts.push('A grey sky means less light inside, so a dim day under it does not count against the tree.');
    if (o.weatherComing) parts.push('The barometer is falling fast: weather is on its way.');
  }
  const tw = x.atmosphere.twilight;
  if (tw.event && tw.minutes !== null) parts.push(tw.minutes < 0 ? `The sun ${tw.event === 'sunrise' ? 'rises' : 'sets'} in ${inWords(-tw.minutes * MIN)}.` : `The sun ${tw.event === 'sunrise' ? 'rose' : 'set'} ${inWords(tw.minutes * MIN)} ago.`);
  const s = b.season;
  const growth = s.growth === 'flush' ? 'it is in a growth spurt' : s.growth === 'active' ? 'it is growing' : s.growth === 'slowing' ? 'its growth is slowing' : 'it is resting';
  parts.push(`${cap(s.stage)} ${s.id}: ${growth}${p.season.daylightHours ? ` with ${num(p.season.daylightHours)} hours of daylight, ${s.daylightTrend === 'lengthening' ? 'getting longer' : 'getting shorter'}` : ''}.`);
  const h = b.habitat;
  if (h.presence === 'visiting' || h.presence === 'peeking') parts.push('The squirrel is visiting: it comes to a tree that has been calm for days.');
  else if (h.presence === 'hiding') parts.push('The squirrel is tucked into the leaves until things settle.');
  else if (h.presence === 'sleeping') parts.push('The squirrel is asleep in its drey in the crown.');
  if (h.sloth && h.sloth.presence !== 'none') parts.push('The sloth is here: warm, humid, still air brings it.');
  if (h.dragonfly && h.dragonfly.presence !== 'none') parts.push('A dragonfly is here: warm, bright, calm air brings it.');
  if (h.lucy && h.lucy.presence !== 'none' && h.lucy.presence !== 'away_hiking') parts.push('Lucy is here; her company calms the tree a little.');
  if (h.lucy?.presence === 'away_hiking') parts.push('Lucy is out on the hike with you.');
  if (b.hike?.today) parts.push('It is hike day: the boots are out. The tree picked the best day of the week for you.');
  if (b.yoga?.today) parts.push('It is a yoga day: the tree picked today as one of the two greyest days of the week, for you and for it.');
  details.push(...(o ? [`outside: ${o.sky}, ${o.temperature ?? '–'}°, humidity ${o.humidity ?? '–'} %`] : []), `season energy ×${s.energy}`, `habitat ${h.value}${h.welcoming ? ' (welcoming)' : ''}`);
  return parts.length ? { id: 'around', icon: 'globe', title: 'Around it', body: parts.join(' '), details } : null;
}

function nightCard(i: WhyInput): WhyCard | null {
  const d: DreamState | undefined = i.behaviour.dream;
  if (!d) return null;
  const shown = i.expression.dream;
  if (d.night || shown?.key.startsWith('preview')) {
    if (shown?.key.startsWith('preview') && shown.motif)
      return { id: 'night', icon: 'moon', title: 'Tonight', body: `It is dreaming of ${dreamScene(shown.motif, shown.with)}${shown.restless ? ', restlessly' : ''}. Dreams are its day being digested: only what it really lived.`, details: ['preview'] };
    const tonight = d.tonight?.motifs ?? [];
    const made = tonight.length ? ` Tonight is made of ${list(tonight.map((m) => `${dreamScene(m.motif)} (${m.why})`))}.` : '';
    const body =
      d.phase === 'dreaming' && d.motif
        ? `It is dreaming of ${dreamScene(d.motif, d.with)}${d.restless ? ', restlessly' : ''}. Dreams are its day being digested: only what it really lived.${made}`
        : d.phase === 'deep'
        ? `Deep sleep between dreams${d.phaseEndsAt ? `; the next one comes around ${hhmm(d.phaseEndsAt)}` : ''}.${made}`
        : !d.asleep
        ? 'It is not asleep, so there is no dream right now.'
        : 'Without trustworthy readings it cannot dream of what it did not perceive.';
    return { id: 'night', icon: 'moon', title: 'Tonight', body, details: (d.tonight?.phases ?? []).map((p) => `${hhmm(p.from)}–${hhmm(p.to)} ${p.motif.replace(/_/g, ' ')}`) };
  }
  if (d.lastNight && i.behaviour.timeOfDay === 'morning') {
    const ln = d.lastNight;
    const body = ln.dreamt.length
      ? `Last night it dreamt of ${ln.told ? dreamScene(ln.told, ln.toldWith) : list(ln.dreamt.map((m) => m.replace(/_/g, ' ')))}${ln.again > 1 ? `, again (${ln.again} nights in a row)` : ''}${ln.restless ? ', restlessly' : ''}.`
      : 'Last night was deep and dreamless.';
    return { id: 'night', icon: 'moon', title: 'Last night', body, details: [`dreamt: ${ln.dreamt.join(', ') || '–'}`] };
  }
  return null;
}

function trustCard(i: WhyInput): WhyCard {
  const { health: h, perception: p, now } = i;
  const o = h.observation;
  const q = p.quality;
  const parts: string[] = [];
  if (p.source === 'weather_estimate') parts.push('Right now its "sensors" are an estimate from the outside weather, not the tree itself, so read this as a guess.');
  if (o.status === 'live') parts.push(`Its readings are fresh${o.lastLiveAt ? ` (the last one ${inWords(now - o.lastLiveAt)} ago)` : ''}, so what you read here is current.`);
  else parts.push(`No trustworthy reading for ${inWords(o.unobservedMinutes * MIN)}. What you read is how it was at ${o.lastLiveAt ? hhmm(o.lastLiveAt) : 'its last reading'}, held, not guessed.`);
  const suspect = (['soil', 'light', 'air'] as const).filter((k) => q.suspect[k]);
  if (suspect.length) parts.push(`Its ${list(suspect.map((k) => (k === 'soil' ? 'soil probe' : k === 'light' ? 'light sensor' : 'air sensor')))} ${suspect.length > 1 ? 'look' : 'looks'} wrong, so the tree is not judged by ${suspect.length > 1 ? 'them' : 'it'}.`);
  if (q.insufficientHistory) parts.push('It has little history yet, so it stays cautious.');
  return { id: 'trust', icon: 'signal', title: o.status === 'live' && !suspect.length ? 'How sure this is' : 'How sure this is: less than usual', body: parts.join(' '), details: [`confidence ${q.confidence} (${num(q.score)})`, ...q.issues] };
}

// Every card worth showing, most important first (the data's trust first when it is in doubt)
export function explainTree(i: WhyInput): WhyCard[] {
  const trust = trustCard(i);
  const doubtful = i.health.observation.status !== 'live' || i.health.condition === 'sensor_uncertain' || Object.values(i.perception.quality.suspect).some(Boolean);
  const cards = [nowCard(i), watchingCard(i), vitalityCard(i), moodCard(i), bodyCard(i), beforeCard(i), nightCard(i), aroundCard(i)].filter((c): c is WhyCard => !!c);
  const tidy = (c: WhyCard): WhyCard => ({ ...c, title: c.title.replace(/\s+/g, ' ').trim(), body: sentence(c.body.replace(/\s+/g, ' ').trim()) });
  return (doubtful ? [trust, ...cards] : [...cards, trust]).map(tidy);
}

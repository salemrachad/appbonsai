import type { MetricAssessment, MetricTone } from '../health/healthTypes';
import type { SeasonState } from '../perception/season';
import type { SpeciesProfile } from '../species';
import { DAY } from '../lib/time';

// Bonsai basics for the Tree Diagnostics' Learn tab: what this species needs, said simply, each next to how
// the real tree is doing. The numbers come from the species profile (the ranges the health engine judges
// by); the pruning, feeding and repotting rules are general Ficus bonsai care guidance. Display only: no
// engine reads it.

export type LessonIcon = 'water' | 'light' | 'temperature' | 'humidity' | 'roots' | 'prune' | 'feed' | 'repot';

export interface Lesson {
  id: LessonIcon;
  title: string;
  rule: string; // the one thing to remember
  why: string; // why it matters, in a sentence
  yours?: { text: string; tone: MetricTone }; // how the real tree is doing on it
}

export interface SeasonLesson {
  id: SeasonState['id'];
  label: string;
  growth: string; // what the tree does in it
  care: string; // what that means for you
  current: boolean;
}

const SEASON_ORDER: SeasonState['id'][] = ['spring', 'summer', 'autumn', 'winter'];
const SEASON_LABEL: Record<SeasonState['id'], string> = { spring: 'Spring', summer: 'Summer', autumn: 'Autumn', winter: 'Winter' };
const GROWTH: Record<string, string> = {
  flush: 'A flush of new leaves',
  active: 'Steady growth',
  slowing: 'Growth slows, a few old leaves may yellow',
  resting: 'Near rest',
};

const ago = (t: number, now: number) => {
  const d = Math.floor((now - t) / DAY);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
};

export function bonsaiBasics(opts: {
  species: SpeciesProfile;
  metrics: MetricAssessment[];
  season: SeasonState | null;
  lastWateringAt: number | null;
  now: number;
}): { lessons: Lesson[]; seasons: SeasonLesson[] } {
  const { species: s, metrics, season, lastWateringAt, now } = opts;
  const m = (id: MetricAssessment['id']) => {
    const x = metrics.find((k) => k.id === id);
    return x && x.tone !== 'off' ? x : null;
  };
  const yours = (x: MetricAssessment | null, extra = '') => (x ? { text: `${x.display} · ${x.status}${extra}`, tone: x.tone } : undefined);
  const soil = m('soil');
  const growing = season ? s.seasons[season.id].feeding : null;
  const when = (good: boolean | null, yes: string, no: string) => (good === null ? undefined : { text: good ? yes : no, tone: (good ? 'good' : 'off') as MetricTone });

  const lessons: Lesson[] = [
    {
      id: 'water',
      title: 'Water',
      rule: `Water deeply once the soil reaches ${s.soilMoisture.minOptimal}–${s.soilCycle.readyBelow}%, then let it dry again.`,
      why: 'Roots need air as well as water: soil that never dries rots them, soil that dries out kills the fine roots.',
      yours: yours(soil, lastWateringAt !== null ? ` · last drink ${ago(lastWateringAt, now)}` : ''),
    },
    {
      id: 'light',
      title: 'Light',
      rule: 'Bright light for most of the day; some soft sun is welcome.',
      why: 'Leaves are its kitchen. With too little light a ficus drops leaves and grows long, weak shoots.',
      yours: yours(m('light')),
    },
    {
      id: 'temperature',
      title: 'Warmth',
      rule: `Happiest at ${s.temperature.minOptimal}–${s.temperature.maxOptimal}°C; keep it above ${s.temperature.minWarning}°C.`,
      why: 'A tropical tree: cold slows it down and can make it shed leaves, and frost kills it.',
      yours: yours(m('temperature')),
    },
    {
      id: 'humidity',
      title: 'Air',
      rule: `Likes ${s.humidity.minOptimal}–${s.humidity.maxOptimal}% humidity.`,
      why: 'Dry air pulls water out of the leaves faster. A greenhouse keeps it gentle.',
      yours: yours(m('humidity')),
    },
  ];
  const r = s.rootTemperature;
  if (r) {
    const roots = soil?.detail?.startsWith('Roots') ? { text: `${soil.detail.replace('Roots ', '')}${soil.detailStatus ? ` · ${soil.detailStatus}` : ''}`, tone: soil.detailTone ?? 'info' } : undefined;
    lessons.push({
      id: 'roots',
      title: 'Roots',
      rule: `Roots like ${r.minOptimal}–${r.maxOptimal}°C soil.`,
      why: 'Cool soil drinks slowly and stays wet longer, so water less often when the pot is cold.',
      yours: roots,
    });
  }
  lessons.push(
    {
      id: 'prune',
      title: 'Pruning',
      rule: 'Let a shoot grow 6–8 leaves, then cut it back to 2–3.',
      why: 'Cutting keeps it small and makes it branch, so the crown grows dense. Best while it grows.',
      yours: when(growing, 'A good time now', 'Wait for spring'),
    },
    {
      id: 'feed',
      title: 'Feeding',
      rule: 'Feed every 2–4 weeks while it grows; none in its rest.',
      why: 'A small pot holds little food. Feeding a resting tree only burns its roots.',
      yours: when(growing, 'Feeding season', 'Resting: no feeding'),
    },
    {
      id: 'repot',
      title: 'Repotting',
      rule: 'Every 2–3 years in spring: fresh soil, roots trimmed by about a third.',
      why: 'Old soil packs down and drains badly; new soil lets the roots breathe.',
      yours: when(season ? season.id === 'spring' : null, 'Spring: the right season', 'Next spring'),
    }
  );

  const seasons = SEASON_ORDER.map((id) => {
    const x = s.seasons[id];
    const water = x.waterNeed >= 0.95 ? 'water as usual' : x.waterNeed >= 0.7 ? 'water a little less' : 'water much less';
    return {
      id,
      label: SEASON_LABEL[id],
      growth: GROWTH[x.growth] ?? x.growth,
      care: `${water[0].toUpperCase()}${water.slice(1)}${x.feeding ? ', feed' : ', no feeding'}.`,
      current: season?.id === id,
    };
  });
  return { lessons, seasons };
}

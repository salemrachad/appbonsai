import React, { useState } from 'react';
import { Droplet, Thermometer, AlertTriangle, Scissors, Sprout, Package, MapPin, StickyNote, Moon, Sun, Leaf, HelpCircle, X, CloudRain, CloudLightning, CloudSnow, CloudFog, Snowflake } from 'lucide-react';
import type { HealthCondition } from '../health/healthTypes';
import type { DailySummary, DiaryItem, PlantEventType, WeatherSpellKind } from '../history/historyTypes';

interface HistoryViewProps {
  days: DailySummary[];
  diary: DiaryItem[];
  treeName: string;
  loading: boolean;
  onLogCare: (type: PlantEventType, note: string) => Promise<void>;
}

const dash = (v: number | null, unit = '') => (v === null ? '–' : `${v}${unit}`);

const CARE: { type: PlantEventType; label: string; Icon: typeof Droplet }[] = [
  { type: 'watering', label: 'Watered', Icon: Droplet },
  { type: 'pruning', label: 'Pruned', Icon: Scissors },
  { type: 'fertilizing', label: 'Fertilized', Icon: Sprout },
  { type: 'repotting', label: 'Repotted', Icon: Package },
  { type: 'moved_location', label: 'Moved', Icon: MapPin },
  { type: 'manual_note', label: 'Note', Icon: StickyNote },
];

const EVENT_ICON: Record<PlantEventType, { Icon: typeof Droplet; color: string }> = {
  watering: { Icon: Droplet, color: '#356077' },
  pruning: { Icon: Scissors, color: '#4A6741' },
  fertilizing: { Icon: Sprout, color: '#4A6741' },
  repotting: { Icon: Package, color: '#8F5E24' },
  moved_location: { Icon: MapPin, color: '#8F5E24' },
  manual_note: { Icon: StickyNote, color: '#6B7A8F' },
};

const CALM: HealthCondition[] = ['thriving', 'comfortable', 'recovering', 'very_bright'];

// Outside weather lines: muted blue-grey, they are the world around the tree, not the tree
const WEATHER_ICON: Record<WeatherSpellKind, typeof Droplet> = { rain: CloudRain, storm: CloudLightning, snow: CloudSnow, fog: CloudFog, frost: Snowflake };

function conditionIcon(c: HealthCondition | undefined) {
  if (c === 'sleeping') return { Icon: Moon, color: '#6B7A8F' };
  if (c === 'sensor_uncertain') return { Icon: HelpCircle, color: '#90A4AE' };
  if (c && CALM.includes(c)) return { Icon: c === 'very_bright' ? Sun : Leaf, color: '#4A6741' };
  if (c === 'hot' || c === 'cold' || c === 'freezing_risk') return { Icon: Thermometer, color: '#D97757' };
  return { Icon: AlertTriangle, color: '#B87D33' };
}

function dayHeading(t: number): string {
  const d = new Date(t);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

// A calm plant diary: what happened to the tree, in its own story order.
export const HistoryView: React.FC<HistoryViewProps> = ({ days, diary, treeName, loading, onLogCare }) => {
  const [careType, setCareType] = useState<PlantEventType | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const groups: { heading: string; items: DiaryItem[] }[] = [];
  for (const item of diary) {
    const heading = dayHeading(item.at);
    const g = groups[groups.length - 1];
    if (g && g.heading === heading) g.items.push(item);
    else groups.push({ heading, items: [item] });
  }

  const submit = async () => {
    if (!careType) return;
    setSaving(true);
    try {
      await onLogCare(careType, note);
      setCareType(null);
      setNote('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div id="history-view" className="space-y-6 pb-12">
      <div className="flex flex-col gap-1">
        <h2 className="serif text-3xl font-medium text-[#2D332A] tracking-tight">{treeName || 'Bonsai'}'s Diary</h2>
        <p className="sans text-xs text-[#2D332A]/60">What the tree lived through, recorded while the Appbonsai server was running.</p>
      </div>

      {/* Care log */}
      <div className="p-4 rounded-2xl glass space-y-3">
        <h3 className="sans text-[10px] font-bold uppercase tracking-widest text-[#2D332A]/50">Log care</h3>
        <div className="grid grid-cols-3 gap-1.5">
          {CARE.map(({ type, label, Icon }) => (
            <button
              key={type}
              onClick={() => setCareType(careType === type ? null : type)}
              className={`py-2 px-2 rounded-xl border sans text-[11px] font-medium flex items-center gap-1.5 cursor-pointer ${
                careType === type ? 'bg-[#4A6741] text-white border-[#334A2C]' : 'bg-white text-[#2D332A] border-[#D8D2C9] hover:border-[#4A6741]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
        {careType && (
          <div className="flex gap-2">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder={careType === 'manual_note' ? 'What did you notice?' : 'Optional note'}
              className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-white border border-[#EAE6E1] sans text-xs focus:outline-none focus:border-[#4A6741]"
              autoFocus
            />
            <button
              onClick={submit}
              disabled={saving || (careType === 'manual_note' && !note.trim())}
              className="px-4 py-2 rounded-xl bg-[#4A6741] text-white sans text-xs font-semibold disabled:opacity-50 cursor-pointer"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
        <p className="sans text-[10.5px] text-[#2D332A]/50">
          Waterings are also detected by the soil sensor. Logging one the sensor already saw just adds your note.
        </p>
      </div>

      {/* Diary */}
      <div className="space-y-4">
        {loading && diary.length === 0 && <p className="sans text-xs text-[#2D332A]/50">Loading…</p>}
        {!loading && diary.length === 0 && (
          <div className="p-6 rounded-2xl glass text-center sans text-xs text-[#2D332A]/50">
            Nothing recorded yet. The diary fills in as the Appbonsai server observes the tree.
          </div>
        )}
        {groups.map((g) => (
          <div key={g.heading} className="space-y-1">
            <h3 className="sans text-[10px] font-bold uppercase tracking-widest text-[#2D332A]/50 pb-1">{g.heading}</h3>
            {g.items.map((item, i) => {
              const { Icon, color } =
                item.kind === 'event' && item.eventType
                  ? EVENT_ICON[item.eventType]
                  : item.kind === 'weather' && item.weather
                  ? { Icon: WEATHER_ICON[item.weather], color: '#7C8FA3' }
                  : conditionIcon(item.condition);
              return (
                <div key={`${item.at}-${i}`} className={`flex items-start gap-3 py-1.5 ${item.kind === 'episode_gap' ? 'opacity-50' : ''}`}>
                  <span className="sans text-[11px] font-mono text-[#2D332A]/50 w-16 shrink-0 pt-0.5 whitespace-nowrap">
                    {new Date(item.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {item.kind === 'episode_gap' ? <X className="w-3.5 h-3.5 mt-0.5 text-[#2D332A]/40 shrink-0" /> : <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color }} />}
                  <div className="flex flex-col min-w-0">
                    <span className={`sans text-xs ${item.kind === 'event' ? 'font-bold' : 'font-semibold'} text-[#2D332A]`}>{item.title}</span>
                    {item.detail && <span className="sans text-[11px] text-[#2D332A]/55">{item.detail}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Past 7 days, compact */}
      <div className="space-y-2">
        <h3 className="sans text-[10px] font-bold uppercase tracking-widest text-[#2D332A]/50">Past 7 days</h3>
        <div className="rounded-2xl glass divide-y divide-[#EAE6E1]">
          {[...days].reverse().map((d) => (
            <div key={d.date} className={`grid grid-cols-[3rem_1fr_1fr_1fr_1fr] items-center gap-2 px-4 py-2 sans text-[11px] text-[#2D332A]/70 ${d.samples === 0 ? 'opacity-45' : ''}`}>
              <span className="font-bold text-[#2D332A]">{d.dayLabel}</span>
              <span className="flex items-center gap-1" title="Average soil moisture">
                <Droplet className="w-3.5 h-3.5 text-[#356077]" />
                {dash(d.avgSoil, '%')}
              </span>
              <span className="flex items-center gap-1" title="Average temperature">
                <Thermometer className="w-3.5 h-3.5 text-[#D97757]" />
                {dash(d.avgTemp, '°')}
              </span>
              <span className="flex items-center gap-1" title="Hours under stress">
                <AlertTriangle className="w-3.5 h-3.5 text-[#A64F34]" />
                {d.samples ? `${d.stressHours}h` : '–'}
              </span>
              <span className="text-right">{d.waterings ? `💧 ${d.waterings}` : d.samples ? '' : 'no data'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

import React from 'react';
import { RotateCcw, Wrench } from 'lucide-react';
import { DEV_PRESETS } from '../../health/developerOverrides';
import type { DevPreviews, SetPreview } from '../../hooks/useDevPreviews';
import { DREAM_WORDS } from '../../behaviour/messages';
import type { DreamMotif } from '../../behaviour/behaviourTypes';
import type { CanopyPreview, DragonflyPreview, DreamPreview, YogaPreview, HikePreview, LucyPreview, SlothPreview, DreyPreview, TwilightPreview, VisitorPreview, WeatherPreview } from '../../hooks/usePlantBehaviour';
import { SEASONS, type Season } from '../../perception/season';

interface StateTesterProps {
  previews: DevPreviews;
  onPreview: SetPreview;
  onClearPreviews: () => void;
}

const WEATHER_PREVIEWS: { id: WeatherPreview; label: string }[] = [
  { id: 'rain', label: '🌧️ Rain' },
  { id: 'heavy_rain', label: 'Downpour' },
  { id: 'fog', label: '🌫️ Fog' },
  { id: 'thunderstorm', label: '⛈️ Storm' },
  { id: 'snow', label: '🌨️ Snow' },
  { id: 'overcast', label: '☁️ Overcast' },
  { id: 'windy', label: '💨 Windy' },
  { id: 'hazy', label: '🌫️ Hazy air' },
];

const HIKE_PREVIEWS: { id: HikePreview | null; label: string }[] = [
  { id: null, label: 'Live' },
  { id: 'announced', label: '📣 Picked' },
  { id: 'moved', label: '🔀 Moved' },
  { id: 'today', label: '🥾 Hike day' },
];

const SPOT_LABEL: Record<VisitorPreview['spot'], string> = { left_branch: 'Left', right_branch: 'Right', crown: 'Crown', trunk: 'Trunk', pot_rim: 'Pot' };
const chip = (active: boolean) =>
  `py-1 px-2 rounded-lg border text-[11px] font-medium sans cursor-pointer ${
    active ? 'bg-[#4A6741] text-white border-[#334A2C]' : 'bg-white text-[#2D332A] border-[#D8D2C9] hover:border-[#4A6741]'
  }`;

const SEASON_EMOJI: Record<Season, string> = { spring: '🌸', summer: '☀️', autumn: '🍂', winter: '❄️' };

// The health presets, sorted by what they are about. Any preset not listed here lands in "Other", so a new
// preset never disappears from the panel.
const PRESET_GROUPS: { label: string; ids: string[] }[] = [
  { label: 'Calm', ids: ['thriving', 'comfortable', 'recovering', 'sleeping'] },
  { label: 'Water', ids: ['thirsty', 'very_dry', 'too_wet'] },
  { label: 'Air & heat', ids: ['hot', 'hot_and_dry', 'cold', 'freezing_risk', 'dry_air', 'high_humidity'] },
  { label: 'Light', ids: ['too_dark', 'very_bright'] },
  { label: 'Combined', ids: ['multiple_stress', 'thirsty_hot_dryair', 'sleeping_thirsty', 'sleeping_humid'] },
  { label: 'Data', ids: ['sensor_uncertain'] },
];
const listed = new Set(PRESET_GROUPS.flatMap((g) => g.ids));
const PRESET_SETS = [...PRESET_GROUPS, { label: 'Other', ids: DEV_PRESETS.map((p) => p.id).filter((id) => !listed.has(id)) }].filter((g) => g.ids.length > 0);

// Sunrise / sunset simulation: the perceived sun times are shifted so that "now" sits `minutes` from the
// moment. Behaviour and expression respond (the tree stretches at sunrise, yawns at sunset), not only the
// sky. Play runs the whole twilight window (−45 … +40 min) in about 20 s; close the panel to watch it.
const SUN_JUMPS: { label: string; t: TwilightPreview }[] = [
  { label: '🌅 −20', t: { event: 'sunrise', minutes: -20 } },
  { label: 'Sunrise', t: { event: 'sunrise', minutes: 0 } },
  { label: '+15', t: { event: 'sunrise', minutes: 15 } },
  { label: '🌇 −15', t: { event: 'sunset', minutes: -15 } },
  { label: 'Sunset', t: { event: 'sunset', minutes: 0 } },
  { label: '+20', t: { event: 'sunset', minutes: 20 } },
];
const PLAY_FROM = -45;
const PLAY_TO = 40;
const PLAY_STEP_MS = 240;

const SunPreviewChips: React.FC<{ active: TwilightPreview | null; onSelect: (t: TwilightPreview | null) => void }> = ({ active, onSelect }) => {
  const [playing, setPlaying] = React.useState<'sunrise' | 'sunset' | null>(null);
  const timer = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setPlaying(null);
  };
  // No stop on unmount: closing the panel lets the twilight play on (it ends by itself after ~20 s)
  const play = (event: 'sunrise' | 'sunset') => {
    stop();
    let minutes = PLAY_FROM;
    setPlaying(event);
    onSelect({ event, minutes });
    timer.current = setInterval(() => {
      minutes += 1;
      if (minutes > PLAY_TO) {
        stop();
        return;
      }
      onSelect({ event, minutes });
    }, PLAY_STEP_MS);
  };
  const same = (t: TwilightPreview) => !playing && active?.event === t.event && active.minutes === t.minutes;
  return (
    <>
      <button
        onClick={() => {
          stop();
          onSelect(null);
        }}
        className={chip(!active)}
      >
        Live
      </button>
      {SUN_JUMPS.map(({ label, t }) => (
        <button
          key={label}
          onClick={() => {
            stop();
            onSelect(t);
          }}
          className={chip(same(t))}
        >
          {label}
        </button>
      ))}
      {(['sunrise', 'sunset'] as const).map((event) => (
        <button key={event} onClick={() => (playing === event ? stop() : play(event))} className={chip(playing === event)}>
          {playing === event ? `■ ${active ? `${active.minutes >= 0 ? '+' : ''}${active.minutes} min` : 'Stop'}` : `▶ ${event === 'sunrise' ? 'Sunrise' : 'Sunset'}`}
        </button>
      ))}
    </>
  );
};

// A titled, collapsible group of preview rows. A dot on the header shows a preview in it is on.
const Group: React.FC<{ title: string; icon: string; active: boolean; defaultOpen?: boolean; children: React.ReactNode }> = ({ title, icon, active, defaultOpen = false, children }) => {
  const [open, setOpen] = React.useState(defaultOpen || active);
  return (
    <div className="rounded-xl border border-[#E6E0D7] bg-white/60">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-2.5 py-1.5 cursor-pointer select-none" aria-expanded={open}>
        <span className="flex items-center gap-1.5 sans text-[11px] font-bold uppercase tracking-wider text-[#2D332A]/75">
          <span className="text-xs">{icon}</span>
          {title}
          {active && <span className="w-1.5 h-1.5 rounded-full bg-[#D97757]" title="A preview is on in this group" />}
        </span>
        <span className="sans text-[11px] text-[#2D332A]/40">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="px-2.5 pb-2.5 space-y-2">{children}</div>}
    </div>
  );
};

// One preview row: a fixed-width label, then its chips (so rows line up)
const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-start gap-2">
    <span className="sans text-[10px] font-bold uppercase tracking-wider text-[#2D332A]/50 w-[4.5rem] shrink-0 pt-1.5">{label}</span>
    <div className="flex flex-wrap items-center gap-1.5 min-w-0">{children}</div>
  </div>
);

// Preview any health state, time, weather and visitor. Presentation only: telemetry, the database, care
// events and episodes are untouched. Grouped: tree health · time & season · outside · the tree over time · visitors.
export const StateTester: React.FC<StateTesterProps> = ({ previews, onPreview, onClearPreviews }) => {
  const { preset: activePresetId, season: activeSeason, visitor: activeVisitor, drey: activeDrey, canopy: activeCanopy, twilight: activeTwilight, dragonfly: activeDragonfly, sloth: activeSloth, lucy: activeLucy, weather: activeWeather, hike: activeHike, dream: activeDream, yoga: activeYoga } = previews;
  const onSelectPreset = (v: string | null) => onPreview('preset', v);
  const onSelectSeason = (v: Season | null) => onPreview('season', v);
  const onSelectVisitor = (v: VisitorPreview | null) => onPreview('visitor', v);
  const onSelectDrey = (v: DreyPreview | null) => onPreview('drey', v);
  const onSelectCanopy = (v: CanopyPreview | null) => onPreview('canopy', v);
  const onSelectTwilight = (v: TwilightPreview | null) => onPreview('twilight', v);
  const onSelectDragonfly = (v: DragonflyPreview | null) => onPreview('dragonfly', v);
  const onSelectSloth = (v: SlothPreview | null) => onPreview('sloth', v);
  const onSelectLucy = (v: LucyPreview | null) => onPreview('lucy', v);
  const onSelectWeather = (v: WeatherPreview | null) => onPreview('weather', v);
  const onSelectHike = (v: HikePreview | null) => {
    onPreview('hike', v);
    onPreview('hikeChoice', null); // a fresh sample week: nothing chosen yet
  };
  // A dream belongs to a sleeping tree: picking one puts the tree to sleep unless a state is previewed
  const onSelectDream = (v: DreamPreview | null) => {
    onPreview('dream', v);
    if (v && !activePresetId) onPreview('preset', 'sleeping');
  };
  const anyActive = !!(activeYoga || activeDream || activePresetId || activeSeason || activeVisitor || activeDrey || activeCanopy || activeTwilight || activeDragonfly || activeSloth || activeLucy || activeWeather || activeHike);
  const resetAll = onClearPreviews;
  return (
    <div id="developer-test-mode" className="w-full bg-[#FAF8F5]/95 p-3.5 rounded-2xl border-2 border-[#D8D2C9] shadow-md space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-md bg-[#4A6741]/10 text-[#4A6741]">
            <Wrench className="w-3.5 h-3.5" />
          </div>
          <span className="sans text-xs font-bold uppercase tracking-wider text-[#2D332A]">Test Tree State</span>
        </div>
        {anyActive ? (
          <button
            id="return-to-live-header-btn"
            onClick={resetAll}
            className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#D97757]/15 text-[#9E3E20] border border-[#D97757]/30 hover:bg-[#D97757] hover:text-white text-[11px] font-semibold cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reset all previews</span>
          </button>
        ) : (
          <span className="sans text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#4A6741]/15 text-[#334D2E] border border-[#4A6741]/30 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#4A6741] animate-ping" />
            <span>Live Data</span>
          </span>
        )}
      </div>

      {/* 1. The tree's health: what the engines would make of each condition */}
      <Group title="Tree health" icon="🩺" active={!!activePresetId} defaultOpen>
        {PRESET_SETS.map((set) => (
          <Row key={set.label} label={set.label}>
            {set.ids.flatMap((pid) => {
              const p = DEV_PRESETS.find((x) => x.id === pid);
              if (!p) return [];
              const active = activePresetId === p.id;
              return [
                <button
                  key={p.id}
                  id={`test-state-btn-${p.id}`}
                  onClick={() => onSelectPreset(active ? null : p.id)}
                  className={chip(active)}
                  title={p.modifiers.length ? `${p.condition} + ${p.modifiers.join(', ')}` : p.condition}
                >
                  {p.emoji} {p.label}
                </button>,
              ];
            })}
          </Row>
        ))}
      </Group>

      {/* 2. Time: the season and the sun's moments */}
      <Group title="Time & season" icon="🕰️" active={!!activeSeason || !!activeTwilight}>
        <Row label="Season">
          {[null, ...SEASONS].map((sn) => (
            <button key={sn ?? 'live'} onClick={() => onSelectSeason(sn)} className={chip(activeSeason === sn)}>
              {sn ? `${SEASON_EMOJI[sn]} ${sn[0].toUpperCase()}${sn.slice(1)}` : 'Live'}
            </button>
          ))}
        </Row>
        <Row label="Sun">
          <SunPreviewChips active={activeTwilight} onSelect={onSelectTwilight} />
        </Row>
      </Group>

      {/* 3. Outside the greenhouse: only the background changes, never the tree */}
      <Group title="Outside" icon="🌦️" active={!!activeWeather}>
        <Row label="Weather">
          <button onClick={() => onSelectWeather(null)} className={chip(!activeWeather)}>
            Live
          </button>
          {WEATHER_PREVIEWS.map((w) => (
            <button key={w.id} onClick={() => onSelectWeather(w.id)} className={chip(activeWeather === w.id)}>
              {w.label}
            </button>
          ))}
        </Row>
      </Group>

      {/* The week's hike: the real planner on a sample forecast (the announcement, a moved pick, the boots) */}
      <Group title="Hike & yoga" icon="🥾" active={!!activeHike || !!activeYoga}>
        <Row label="Plan">
          {HIKE_PREVIEWS.map((h) => (
            <button key={h.id ?? 'live'} id={`test-hike-btn-${h.id ?? 'live'}`} onClick={() => onSelectHike(h.id)} className={chip(activeHike === h.id)}>
              {h.label}
            </button>
          ))}
        </Row>
        <Row label="Yoga">
          {([null, 'picked', 'today'] as (YogaPreview | null)[]).map((y) => (
            <button key={y ?? 'live'} onClick={() => onPreview('yoga', y)} className={chip(activeYoga === y)}>
              {y === null ? 'Live' : y === 'today' ? '🧘 Yoga day' : 'Days announced'}
            </button>
          ))}
        </Row>
      </Group>

      {/* The night: what the tree dreams (real dreams are made of the day before) */}
      <Group title="Night" icon="🌙" active={!!activeDream}>
        <Row label="Dream">
          <button onClick={() => onSelectDream(null)} className={chip(!activeDream)}>
            Live
          </button>
          {(Object.keys(DREAM_WORDS) as DreamMotif[]).map((motif) => (
            <button key={motif} onClick={() => onSelectDream({ motif, with: activeDream?.with ?? null, restless: activeDream?.restless ?? false })} className={chip(activeDream?.motif === motif)}>
              {DREAM_WORDS[motif]}
            </button>
          ))}
          <button onClick={() => activeDream && onSelectDream({ ...activeDream, restless: !activeDream.restless })} className={chip(!!activeDream?.restless)} disabled={!activeDream}>
            Restless
          </button>
        </Row>
        <Row label="With">
          <button onClick={() => activeDream && onSelectDream({ ...activeDream, with: null })} className={chip(!activeDream?.with)} disabled={!activeDream}>
            Alone
          </button>
          {(Object.keys(DREAM_WORDS) as DreamMotif[]).map((motif) => (
            <button key={motif} onClick={() => activeDream && onSelectDream({ ...activeDream, with: motif })} className={chip(activeDream?.with === motif)} disabled={!activeDream || activeDream.motif === motif}>
              {DREAM_WORDS[motif]}
            </button>
          ))}
        </Row>
      </Group>

      {/* 4. The tree over the last weeks */}
      <Group title="The tree over time" icon="🌿" active={!!activeCanopy}>
        <Row label="Canopy">
          <button onClick={() => onSelectCanopy(null)} className={chip(!activeCanopy)}>
            Live
          </button>
          {[
            { label: 'Full', c: { fullness: 1, refilling: 0 } },
            { label: 'A little thin', c: { fullness: 0.82, refilling: 0 } },
            { label: 'Thin', c: { fullness: 0.64, refilling: 0 } },
            { label: '🌱 Refilling', c: { fullness: 0.72, refilling: 0.8 } },
          ].map(({ label, c }) => (
            <button key={label} onClick={() => onSelectCanopy(c)} className={chip(activeCanopy?.fullness === c.fullness && activeCanopy.refilling === c.refilling)}>
              {label}
            </button>
          ))}
        </Row>
      </Group>

      {/* 5. The habitat's visitors (real visits need their own conditions; these show them now) */}
      <Group title="Visitors" icon="🐾" active={!!activeVisitor || !!activeDrey || !!activeDragonfly || !!activeSloth || !!activeLucy}>
        <Row label="Squirrel">
          <button onClick={() => onSelectVisitor(null)} className={chip(!activeVisitor)}>
            Live
          </button>
          <button onClick={() => onSelectVisitor({ mode: 'traces', spot: 'left_branch', traces: 'nibbled_leaf' })} className={chip(activeVisitor?.mode === 'traces' && activeVisitor.traces === 'nibbled_leaf')}>
            🍂 Nibbled leaf
          </button>
          <button onClick={() => onSelectVisitor({ mode: 'traces', spot: 'left_branch', traces: 'tail_at_pot' })} className={chip(activeVisitor?.mode === 'traces' && activeVisitor.traces === 'tail_at_pot')}>
            🪴 Tail by the pot
          </button>
          {(['peek', 'visiting', 'hiding'] as const).map((mode) => (
            <button key={mode} onClick={() => onSelectVisitor({ mode, spot: activeVisitor?.spot ?? 'left_branch' })} className={chip(activeVisitor?.mode === mode && !activeVisitor.action)}>
              {mode === 'peek' ? '👀 Peeking (new)' : mode === 'visiting' ? '🐿️ Visiting' : '🍃 Hiding'}
            </button>
          ))}
          <button onClick={() => onSelectVisitor({ mode: 'visiting', spot: 'pot_rim', action: 'drinking' })} className={chip(activeVisitor?.action === 'drinking')}>
            💧 Drinking
          </button>
          <button onClick={() => onSelectVisitor({ mode: 'visiting', spot: 'left_branch', action: 'inspecting' })} className={chip(activeVisitor?.action === 'inspecting')}>
            ✂️ Inspecting
          </button>
          <button onClick={() => onSelectVisitor({ mode: 'visiting', spot: activeVisitor?.spot ?? 'right_branch', action: 'shake_off' })} className={chip(activeVisitor?.action === 'shake_off')}>
            🌦️ Shaking off
          </button>
          <button onClick={() => onSelectVisitor({ mode: 'sleeping', spot: 'crown' })} className={chip(activeVisitor?.mode === 'sleeping')}>
            🌙 Asleep
          </button>
        </Row>
        {activeVisitor && activeVisitor.mode !== 'sleeping' && activeVisitor.mode !== 'traces' && !activeVisitor.action && (
          <Row label="· spot">
            {(Object.keys(SPOT_LABEL) as VisitorPreview['spot'][]).map((spot) => (
              <button key={spot} onClick={() => onSelectVisitor({ ...activeVisitor, spot })} className={chip(activeVisitor.spot === spot)}>
                {SPOT_LABEL[spot]}
              </button>
            ))}
          </Row>
        )}
        <Row label="· Drey">
          <button onClick={() => onSelectDrey(null)} className={chip(!activeDrey)}>
            Live
          </button>
          {(['none', 'started', 'built'] as const).map((d) => (
            <button key={d} onClick={() => onSelectDrey(d)} className={chip(activeDrey === d)}>
              {d === 'none' ? 'None' : d === 'started' ? 'A few twigs' : 'Built'}
            </button>
          ))}
        </Row>
        <Row label="Dragonfly">
          <button onClick={() => onSelectDragonfly(null)} className={chip(!activeDragonfly)}>
            Live
          </button>
          {(['perched', 'hovering'] as const).map((presence) => (
            <button key={presence} onClick={() => onSelectDragonfly({ presence, perch: activeDragonfly?.perch ?? 'right_tip' })} className={chip(activeDragonfly?.presence === presence)}>
              {presence === 'perched' ? '✨ Perched' : '🪽 Hovering'}
            </button>
          ))}
        </Row>
        {activeDragonfly && (
          <Row label="· perch">
            {(['left_tip', 'left_top', 'crown_tip', 'right_tip'] as const).map((perch) => (
              <button key={perch} onClick={() => onSelectDragonfly({ ...activeDragonfly, perch })} className={chip(activeDragonfly.perch === perch)}>
                {perch.replace('_', ' ')}
              </button>
            ))}
          </Row>
        )}
        <Row label="Sloth">
          <button onClick={() => onSelectSloth(null)} className={chip(!activeSloth)}>
            Live
          </button>
          {(['hanging', 'climbing', 'sleeping'] as const).map((pose) => (
            <button key={pose} onClick={() => onSelectSloth({ pose, branch: activeSloth?.branch ?? 'left_branch' })} className={chip(activeSloth?.pose === pose)}>
              {pose === 'hanging' ? '🦥 Hanging' : pose === 'climbing' ? 'Climbing' : '🌙 Asleep'}
            </button>
          ))}
        </Row>
        {activeSloth && (
          <Row label="· branch">
            {(['left_branch', 'right_branch'] as const).map((branch) => (
              <button key={branch} onClick={() => onSelectSloth({ ...activeSloth, branch })} className={chip(activeSloth.branch === branch)}>
                {branch === 'left_branch' ? 'Left' : 'Right'}
              </button>
            ))}
          </Row>
        )}
        {activeSloth?.pose === 'hanging' && (
          <Row label="· grip">
            {([
              ['four', 'All four'],
              ['arms', 'Arms'],
              ['legs', 'Legs'],
              ['one_arm', 'One arm'],
              ['two_legs_one_arm', 'Legs + arm'],
            ] as const).map(([grip, label]) => (
              <button key={grip} onClick={() => onSelectSloth({ ...activeSloth, grip })} className={chip((activeSloth.grip ?? 'arms') === grip)}>
                {label}
              </button>
            ))}
          </Row>
        )}
        <Row label="Lucy">
          <button onClick={() => onSelectLucy(null)} className={chip(!activeLucy)}>
            Live
          </button>
          {([
            ['walking', '🐾 Walking'],
            ['sitting', 'Sitting'],
            ['down', 'Down'],
            ['sleeping', '🌙 Asleep'],
          ] as const).map(([pose, label]) => (
            <button key={pose} onClick={() => onSelectLucy({ pose, spot: activeLucy?.spot ?? (pose === 'sleeping' ? 'pillow' : 'floor_left'), cue: activeLucy?.cue })} className={chip(activeLucy?.pose === pose)}>
              {label}
            </button>
          ))}
        </Row>
        {activeLucy && (
          <Row label="· spot">
            {([
              ['pillow', 'Pillow'],
              ['floor_left', 'Floor'],
              ['by_pot', 'By the stand'],
              ['pot_front', 'Pot front'],
              ['pot_right', 'Pot right'],
              ['floor_right', 'Right'],
            ] as const).map(([spot, label]) => (
              <button key={spot} onClick={() => onSelectLucy({ ...activeLucy, spot })} className={chip(activeLucy.spot === spot)}>
                {label}
              </button>
            ))}
          </Row>
        )}
        {activeLucy && (
          <Row label="· cue">
            {([
              [undefined, 'None'],
              ['concern', 'Watching over'],
              ['storm', 'Storm'],
              ['panting', 'Heat'],
              ['shake_off', 'Shake off'],
              ['tired', 'Tired'],
            ] as const).map(([cue, label]) => (
              <button key={label} onClick={() => onSelectLucy({ ...activeLucy, cue })} className={chip(activeLucy.cue === cue)}>
                {label}
              </button>
            ))}
          </Row>
        )}
      </Group>

      <p className="text-[11px] sans text-[#2D332A]/55 px-1">
        Changes only health, behaviour and expression on screen. Sensor values, the database, care events and episodes stay real.
      </p>
    </div>
  );
};

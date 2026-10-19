import { Router } from 'express';
import { APP_CONFIG } from '../../src/config/appConfig';
import { STRESS_CONDITIONS } from '../../src/health/statePriority';
import { dragonflyDiary } from '../../src/behaviour/dragonfly';
import { slothDiary } from '../../src/behaviour/sloth';
import { lucyDayVisits, lucyDiary } from '../../src/behaviour/lucy';
import { recentTelemetry, recentWeather } from '../rowCache';
import { encounterDiary, type Window } from '../../src/behaviour/encounters';
import { habitatDiary, seasonEnergyAt } from '../../src/behaviour/habitat';
import { toSample } from '../../src/perception/PerceptionEngine';
import { fromRecord } from '../collector';
import { buildDiary, saidItems } from '../../src/history/diary';
import { daySummaries } from '../../src/history/daySummary';
import { dayMoments, dayStartOf } from '../../src/history/moments';
import { ACTIVE_SPECIES } from '../../src/species';
import type { DailySummary, DiaryItem } from '../../src/history/historyTypes';
import type { LivingCollector } from '../collector';
import type { AppDatabase } from '../database';
import { DAY, HOUR, addDays, dateKey, setTreeTimeZone, startOfDay, weekdayShort } from '../../src/lib/time';


const localDate = dateKey; // the tree's date (its timezone), not the server's
const clampNum = (v: unknown, lo: number, hi: number, dflt: number) => Math.min(hi, Math.max(lo, Number(v) || dflt));


// GET /api/history?hours=24 (raw rows) · /hourly?hours=24 · /daily?days=7 · /diary?days=3 · /episodes?days=30 · /weather?hours=24
// The plant diary for the last `days` days as of `now`, newest first (GET /api/history/diary; tests pass the
// bench clock). Episodes, care, outside weather, the visitors, what the tree said, the moments of each day and
// the finished days in short.
export function diaryFor(db: AppDatabase, collector: LivingCollector, days: number, now: number): DiaryItem[] {
  const since = now - days * DAY;
  const source = () => (collector.getSettings().settings.dataSource === 'weather_estimate' ? 'weather_estimate' : 'esp32_sensor');
  const { settings } = collector.getSettings();
  setTreeTimeZone(settings.timezone);
  const location = { latitude: settings.latitude ?? null, longitude: settings.longitude ?? null };
  // Rows are read once (episodes, events) or from the in-memory cache of recent readings and weather
  // (rowCache.ts): the diary is opened often, and a Durable Object's SQLite bills every row read
  const slothFrom = now - Math.max(days, APP_CONFIG.habitat.sloth.loyalty.days) * DAY;
  const from = dayStartOf(since);
  const allEpisodes = db.episodesSince(Math.min(now - APP_CONFIG.habitat.replayDays * DAY, slothFrom, from, since));
  const episodesSince = (t: number) => allEpisodes.filter((e) => (e.endedAt ?? e.lastSeenAt) >= t);
  const allEvents = db.eventsSince(Math.min(from, since));
  const eventsSince = (t: number) => allEvents.filter((e) => e.timestamp >= t);
  const telemetrySince = (a: number, b?: number) => recentTelemetry(db, source(), a, b);
  const weatherSince = (t: number) => recentWeather(db, t);
  // The squirrel's story, derived from the same episodes the habitat replays (nothing stored)
  const windows: { squirrel: Window[]; dragonfly: Window[]; sloth: Window[] } = { squirrel: [], dragonfly: [], sloth: [] };
  const visitors = habitatDiary({
    episodes: episodesSince(now - APP_CONFIG.habitat.replayDays * DAY),
    now,
    days,
    location,
    seasonAt: seasonEnergyAt(location.latitude, ACTIVE_SPECIES),
    windowsOut: windows.squirrel,
    // the same others as the live view: what it learns of Lucy, who it knows
    lucyVisitsOn: lucyDayVisits,
    airHistory: collector.airHistory(),
  });
  // The dragonfly's days: the stored readings as samples, through the same replay as the live view
  const cal = collector.getCalibration();
  const toSamples = (rows: ReturnType<typeof db.telemetrySince>) =>
    rows.flatMap((row) => {
      const t = fromRecord(row, cal, false);
      return t ? [toSample(t, ACTIVE_SPECIES, location)] : [];
    });
  const samples = toSamples(telemetrySince(since - 6 * HOUR));
  const cadenceMs = Math.max(APP_CONFIG.dataQuality.minStaleMs, collector.pollMs() * APP_CONFIG.dataQuality.staleAfterPolls);
  const outside = weatherSince(since - 6 * HOUR);
  const dragonflies = dragonflyDiary(samples, outside, episodesSince(since), ACTIVE_SPECIES, cadenceMs, now, days, windows.dragonfly);
  // The sloth remembers its last days (loyalty): its diary replays from that far back, like the live view
  const slothSamples = slothFrom < since ? [...toSamples(telemetrySince(slothFrom - 6 * HOUR, since - 6 * HOUR - 1)), ...samples] : samples;
  const sloths = slothDiary(slothSamples, weatherSince(slothFrom - 6 * HOUR), episodesSince(slothFrom), ACTIVE_SPECIES, cadenceMs, now, days, windows.sloth);
  // Lucy's days: her plan on the household clock, and the storms she kept close through (stored weather)
  const lucy = lucyDiary(outside, now, days);
  // Who shared the tree: where those visits overlapped
  const encounters = encounterDiary(windows, since, now);
  // What the tree said, the moments of each day and the finished days in short. The first day is read from
  // its midnight, so its moments and summary describe all of it (or it is left out: from)
  const said = db.utterancesSince(since);
  const daySamples = toSamples(telemetrySince(from));
  const days_ = [...dayMoments(daySamples, ACTIVE_SPECIES, now, said, from), ...daySummaries(daySamples, episodesSince(from), eventsSince(from), ACTIVE_SPECIES, now, from)].filter((i) => i.at >= since);
  return [...buildDiary(episodesSince(since), eventsSince(since), APP_CONFIG.history.episodeGapMs, weatherSince(since)), ...saidItems(said), ...days_, ...visitors, ...dragonflies, ...sloths, ...lucy, ...encounters].sort((a, b) => b.at - a.at);
}

export function historyRoutes(db: AppDatabase, collector: LivingCollector): Router {
  const r = Router();
  const source = () => (collector.getSettings().settings.dataSource === 'weather_estimate' ? 'weather_estimate' : 'esp32_sensor');

  r.get('/', (req, res) => {
    const hours = clampNum(req.query.hours, 1, 24 * 90, 24);
    res.json(db.telemetrySince(req.query.source === 'all' ? null : source(), Date.now() - hours * HOUR));
  });

  r.get('/hourly', (req, res) => {
    const hours = clampNum(req.query.hours, 1, 24 * 90, 24);
    res.json(db.hourlyBuckets(source(), Date.now() - hours * HOUR));
  });

  r.get('/daily', (req, res) => {
    const days = clampNum(req.query.days, 1, 90, 7);
    const now = Date.now();
    const start = addDays(startOfDay(now), -(days - 1));
    const buckets = db.hourlyBuckets(source(), start);
    const episodes = db.episodesSince(start);
    const events = db.eventsSince(start);

    const out: DailySummary[] = [];
    for (let i = 0; i < days; i++) {
      const dayStart = addDays(start, i);
      const dayEnd = addDays(dayStart, 1);
      const date = localDate(dayStart);
      const b = buckets.filter((x) => localDate(x.hourStart) === date);
      const n = b.reduce((a, x) => a + x.samples, 0);
      const wavg = (pick: (x: (typeof b)[number]) => number | null) => {
        const xs = b.filter((x) => pick(x) !== null);
        const w = xs.reduce((a, x) => a + x.samples, 0);
        return w ? Math.round((xs.reduce((a, x) => a + pick(x)! * x.samples, 0) / w) * 10) / 10 : null;
      };
      const stressMs = episodes
        .filter((e) => STRESS_CONDITIONS.includes(e.condition))
        .reduce((a, e) => {
          const s = Math.max(e.startedAt, dayStart);
          const en = Math.min(e.endedAt ?? e.lastSeenAt, dayEnd);
          return a + Math.max(0, en - s);
        }, 0);
      const mins = b.flatMap((x) => (x.minSoil !== null ? [x.minSoil] : []));
      out.push({
        date,
        dayLabel: weekdayShort(dayStart),
        samples: n,
        avgSoil: wavg((x) => x.avgSoil),
        minSoil: mins.length ? Math.min(...mins) : null,
        avgTemp: wavg((x) => x.avgTemp),
        avgHumidity: wavg((x) => x.avgHumidity),
        avgLight: wavg((x) => x.avgLight),
        stressHours: Math.round((stressMs / HOUR) * 10) / 10,
        waterings: events.filter((e) => e.type === 'watering' && localDate(e.timestamp) === date).length,
      });
    }
    res.json(out);
  });

  r.get('/diary', (req, res) => res.json(diaryFor(db, collector, clampNum(req.query.days, 1, 365, 3), Date.now())));

  // Outside weather observations (context only; the tree's own readings are /api/history)
  r.get('/weather', (req, res) => {
    const hours = clampNum(req.query.hours, 1, 24 * 90, 24);
    res.json(db.outsideWeatherSince(Date.now() - hours * HOUR));
  });

  r.get('/episodes', (req, res) => {
    const days = clampNum(req.query.days, 1, 3650, 30);
    res.json(db.episodesSince(Date.now() - days * DAY));
  });

  return r;
}

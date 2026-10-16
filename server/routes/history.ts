import { Router } from 'express';
import { APP_CONFIG } from '../../src/config/appConfig';
import { STRESS_CONDITIONS } from '../../src/health/statePriority';
import { habitatDiary } from '../../src/behaviour/habitat';
import { buildDiary } from '../../src/history/diary';
import { seasonState } from '../../src/perception/season';
import { ACTIVE_SPECIES } from '../../src/species';
import type { DailySummary } from '../../src/history/historyTypes';
import type { LivingCollector } from '../collector';
import type { AppDatabase } from '../database';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

const localDate = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const clampNum = (v: unknown, lo: number, hi: number, dflt: number) => Math.min(hi, Math.max(lo, Number(v) || dflt));

// The same blended seasonal energy the behaviour engine uses (fewer visits at winter rest)
const seasonEnergyAt = (latitude: number | null) => (t: number) => {
  const s = seasonState(t, latitude);
  const rule = ACTIVE_SPECIES.seasons[s.id];
  const other = s.blend ? ACTIVE_SPECIES.seasons[s.blend.with] : null;
  const energy = other ? rule.energy + (other.energy - rule.energy) * s.blend!.amount : rule.energy;
  return { id: s.id, energy: Math.round(energy * 100) / 100 };
};

// GET /api/history?hours=24 (raw rows) · /hourly?hours=24 · /daily?days=7 · /diary?days=3 · /episodes?days=30 · /weather?hours=24
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
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));
    const buckets = db.hourlyBuckets(source(), start.getTime());
    const episodes = db.episodesSince(start.getTime());
    const events = db.eventsSince(start.getTime());

    const out: DailySummary[] = [];
    for (let i = 0; i < days; i++) {
      const dayStart = new Date(start);
      dayStart.setDate(start.getDate() + i);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayStart.getDate() + 1);
      const date = localDate(dayStart.getTime());
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
          const s = Math.max(e.startedAt, dayStart.getTime());
          const en = Math.min(e.endedAt ?? e.lastSeenAt, dayEnd.getTime());
          return a + Math.max(0, en - s);
        }, 0);
      const mins = b.flatMap((x) => (x.minSoil !== null ? [x.minSoil] : []));
      out.push({
        date,
        dayLabel: dayStart.toLocaleDateString([], { weekday: 'short' }),
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

  r.get('/diary', (req, res) => {
    const days = clampNum(req.query.days, 1, 365, 3);
    const since = Date.now() - days * DAY;
    const now = Date.now();
    const { settings } = collector.getSettings();
    const location = { latitude: settings.latitude ?? null, longitude: settings.longitude ?? null };
    // The squirrel's story, derived from the same episodes the habitat replays (nothing stored)
    const visitors = habitatDiary({ episodes: db.episodesSince(now - APP_CONFIG.habitat.replayDays * DAY), now, days, location, seasonAt: seasonEnergyAt(location.latitude) });
    res.json([...buildDiary(db.episodesSince(since), db.eventsSince(since), APP_CONFIG.history.episodeGapMs, db.outsideWeatherSince(since)), ...visitors].sort((a, b) => b.at - a.at));
  });

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

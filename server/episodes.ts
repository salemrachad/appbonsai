import { APP_CONFIG } from '../src/config/appConfig';
import type { HealthCondition, PlantHealthState, Severity } from '../src/health/healthTypes';
import { SEVERITY_RANK } from '../src/health/statePriority';
import type { AppDatabase } from './database';

// Turns the stream of health evaluations into the tree's biography: a new episode only when the
// primary condition changes (hysteresis already keeps that rare), closed when it transitions.
//
// Gap policy:
//   - no trustworthy data, but the biological state is held (overlay): the episode continues and the
//     time is added to unobserved_ms. "sensor_uncertain" never enters an episode's modifiers.
//   - server/sensor away up to history.episodeGapMs: the episode continues, gap counted as unobserved
//   - away longer: the episode is closed where it was last seen (the diary shows "Not observed")
// Episodes shorter than ~1.5 polls are artifacts: they are deleted, and A → (blip) → A is stitched back together.
export function trackEpisode(db: AppDatabase, health: PlantHealthState, now: number, opts: { pollMs: number; gapMs: number }): void {
  let open = db.openEpisode();

  if (open && now - open.lastSeenAt > APP_CONFIG.history.episodeGapMs) {
    db.closeEpisode(open.id, open.lastSeenAt);
    open = null;
  }

  const live = health.observation.status === 'live';
  const modifiers = health.modifiers.filter((m) => m !== 'sensor_uncertain');

  if (open && open.condition === health.condition) {
    // Health knows how much of the time since its last evaluation was really observed
    const unobserved = Math.min(now - open.lastSeenAt, health.observation.unobservedDeltaMs);
    const merged = [...new Set([...open.modifiers, ...modifiers])];
    const peak: Severity = live && SEVERITY_RANK[health.severity] > SEVERITY_RANK[open.peakSeverity] ? health.severity : open.peakSeverity;
    db.touchEpisode(open.id, now, merged, peak, unobserved);
    return;
  }

  // An episode starts when the condition becomes the tree's primary state. (Not back-dated to when its
  // latch first switched on: a condition can be latched underneath another for hours, e.g. thriving
  // while asleep, and back-dating would rewrite the previous episode.)
  const startedAt = now;

  if (open) {
    db.closeEpisode(open.id, startedAt);
    if (startedAt - open.startedAt < opts.pollMs * 1.5) {
      // A blip shorter than one reading cycle isn't part of the tree's life story
      db.deleteEpisode(open.id);
      const before = db.lastClosedEpisode();
      if (before && before.condition === health.condition && open.startedAt - (before.endedAt ?? 0) <= opts.gapMs) {
        db.reopenEpisode(before.id);
        db.touchEpisode(before.id, now, [...new Set([...before.modifiers, ...modifiers])], before.peakSeverity);
        return;
      }
    }
  }

  db.insertEpisode({
    startedAt,
    condition: health.condition as HealthCondition,
    modifiers,
    peakSeverity: live ? health.severity : 'none',
    engineVersion: APP_CONFIG.engineVersion,
  });
}

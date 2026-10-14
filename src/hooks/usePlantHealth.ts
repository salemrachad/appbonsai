import { useMemo } from 'react';
import { applyDeveloperOverride, DEV_PRESETS } from '../health/developerOverrides';
import { PlantHealthState } from '../health/healthTypes';
import { ACTIVE_SPECIES } from '../species';

// `live` is what the server's health engine concluded from real data; `display` is what the UI
// shows (live, or a developer preview layered on top without changing any data).
export function usePlantHealth(live: PlantHealthState | null, devPresetId: string | null) {
  const display = useMemo<PlantHealthState | null>(() => {
    const preset = devPresetId ? DEV_PRESETS.find((p) => p.id === devPresetId) : null;
    return preset && live ? applyDeveloperOverride(live, preset, ACTIVE_SPECIES) : live;
  }, [live, devPresetId]);
  return { live, display };
}

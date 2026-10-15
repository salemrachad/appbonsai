import React from 'react';
import { Flower2, Leaf, Snowflake, Sun } from 'lucide-react';
import type { SeasonState } from '../../perception/season';

const ICON = { spring: Flower2, summer: Sun, autumn: Leaf, winter: Snowflake } as const;
const NAME = { spring: 'Spring', summer: 'Summer', autumn: 'Autumn', winter: 'Winter' } as const;

const hm = (h: number) => `${Math.floor(h)}h ${String(Math.round((h % 1) * 60)).padStart(2, '0')}m`;

// The season as perceived (date + the tree's latitude). Shows facts only; what it means for the tree is decided upstream.
export const SeasonChip: React.FC<{ season: SeasonState }> = ({ season }) => {
  const Icon = ICON[season.id];
  const change = season.daylightChangeMinPerWeek;
  const title = [
    `${season.stage[0].toUpperCase()}${season.stage.slice(1)} ${NAME[season.id].toLowerCase()}: day ${season.daysIn + 1}, ${season.daysLeft} days until ${NAME[season.next].toLowerCase()}`,
    season.daylightHours !== null ? `${hm(season.daylightHours)} of daylight, ${season.daylightTrend}${change ? ` by ${Math.abs(change)} min a week` : ''}` : 'Set the tree’s location for day length',
    season.method === 'assumed_north' ? 'No location set: northern hemisphere assumed' : null,
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <span className="sans text-xs text-[var(--ink)]/55 flex items-center gap-1.5 shrink-0" title={title}>
      <Icon className="w-3 h-3 text-[#4A6741]" />
      <span className="font-medium">
        {season.stage === 'mid' ? '' : season.stage === 'early' ? 'Early ' : 'Late '}
        {season.stage === 'mid' ? NAME[season.id] : NAME[season.id].toLowerCase()}
      </span>
      {season.daylightHours !== null && (
        <span className="tabular-nums text-[var(--ink)]/40">
          · {hm(season.daylightHours)} {season.daylightTrend === 'lengthening' ? '↑' : '↓'}
        </span>
      )}
    </span>
  );
};

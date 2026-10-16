import React, { useEffect, useState } from 'react';

// Sunrise and sunset, at their real times. Behaviour knows where the day is relative to the sun's moments
// (behaviour.twilight, from perception.sun: Open-Meteo's published times, else computed from the tree's
// location); the Expression Engine passes it on with `muted` when clouds, fog or rain dim the sky. This
// layer only draws it, advancing the minutes with the clock between server updates.
// A warm glow builds along the horizon before the moment, the sun's disk crosses the horizon exactly at it
// (east in the morning, west in the evening), and the colours fade after.

interface TwilightSkyProps {
  twilight: { event: 'sunrise' | 'sunset' | null; minutes: number | null; at: number; muted: boolean } | null;
}

const BEFORE_MIN = 45; // the glow starts this long before the moment (the same window behaviour uses)…
const AFTER_MIN = 40; // …and fades this long after
const RISE_MIN = 25; // the disk travels from below the horizon to clear of it over this window either side

export const TwilightSky: React.FC<TwilightSkyProps> = ({ twilight }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(t);
  }, []);

  const event = twilight?.event ?? null;
  if (!twilight || !event || twilight.minutes === null) return null;
  // Minutes from the moment, advanced by the clock since the evaluation (between polls)
  const min = twilight.minutes + Math.max(0, now - twilight.at) / 60000;
  if (min < -BEFORE_MIN || min > AFTER_MIN) return null;

  // Glow: builds toward the moment, peaks just after sunrise / just before sunset, then fades
  const peakAt = event === 'sunrise' ? 8 : -8;
  const width = min < peakAt ? BEFORE_MIN + peakAt : AFTER_MIN - peakAt;
  const glow = Math.max(0, 1 - Math.abs(min - peakAt) / width);
  // The disk: y from below the horizon to above it, crossing the horizon line exactly at the moment.
  // Rising in the morning (min increasing → higher), setting in the evening (min increasing → lower).
  const t = Math.max(-1, Math.min(1, min / RISE_MIN));
  const height = event === 'sunrise' ? t : -t; // +1 = clear above the horizon, −1 = below
  // Within the sky above the horizon (clipped there): 100 % = on the horizon line
  const sunTop = 100 - 22 * height;
  const morning = event === 'sunrise';
  const label = `${morning ? 'Sunrise' : 'Sunset'} ${min < 0 ? `in ${Math.round(-min)} min` : min < 1 ? 'now' : `${Math.round(min)} min ago`}`;

  return (
    <div className={`twilight-sky twilight-${event}${twilight.muted ? ' twilight-muted' : ''}`} style={{ '--glow': glow.toFixed(3) } as React.CSSProperties} aria-label={label}>
      <div className="twilight-wash" />
      <div className="twilight-horizon" />
      <div className="twilight-above">
        <div className="twilight-sun" style={{ left: morning ? '14%' : '93%', top: `${sunTop}%`, opacity: Math.min(1, 0.45 + glow) }} />
      </div>
      <div className="twilight-ground" />
    </div>
  );
};

import type { StormLevel } from '../lib/tankEnv';
import { useLinger } from './useTankEnv';

// Matches the chop's 8s fade-in.
const CHOP_FADE_MS = 8000;

// Storm ladder layers (spec §6); reduced motion freezes rain and chop in CSS and drops lightning and debris here.
export function TankWeather({ level, vars, reduced, surfaceY, fullscreen }: {
  level: StormLevel;
  vars: Record<string, string>;
  reduced: boolean;
  surfaceY: number;
  fullscreen: boolean;
}) {
  // The chop fades out when the storm passes rather than vanishing.
  const chop = useLinger(level > 0 && Number(vars['--reef-chop']) > 0, CHOP_FADE_MS, reduced);
  const chopEl = chop !== 'off' && <div className={chop === 'leaving' ? 'reef-chop reef-chop-out' : 'reef-chop'} />;
  if (level === 0) return chopEl || null;
  const rain = Number(vars['--reef-rain']) > 0;
  const heavy = level >= 5 ? ' reef-rain-heavy' : '';
  const above = { height: surfaceY + 10 };
  const under = { top: surfaceY, height: fullscreen ? 60 : 25 };
  return (
    <>
      {chopEl}
      {rain && <div className={`reef-rain${heavy}`} style={above} />}
      {rain && <div className={`reef-rain reef-rain-under${heavy}`} style={under} />}
      {rain && <div className={`reef-dimples${heavy ? ' reef-dimples-heavy' : ''}`} style={{ top: surfaceY - 3 }} />}
      {vars['--reef-lightning'] === '1' && !reduced && <div className="reef-lightning" />}
      {level >= 5 && !reduced && debrisFor(fullscreen).map((d, i) => (
        <span
          key={`d${i}`}
          className="reef-debris"
          style={{
            top: `${d.top}%`, width: d.w, height: d.h, background: d.fill, borderRadius: d.radius,
            animationDuration: `${d.duration}s`, animationDelay: `${d.delay}s`,
          }}
        />
      ))}
    </>
  );
}

const DEBRIS_FILLS = ['rgb(92 74 42 / 0.85)', 'rgb(79 107 46 / 0.8)', 'rgb(118 92 52 / 0.8)', 'rgb(60 50 34 / 0.85)'];

// Leaves, twigs and grit in the upper half; deterministic so a re-render never reshuffles it.
function debrisFor(fullscreen: boolean) {
  return Array.from({ length: fullscreen ? 14 : 8 }, (_, i) => {
    const kind = i % 3;
    const s = fullscreen ? 1.4 : 1;
    return {
      top: 6 + ((i * 23) % 42),
      w: (kind === 0 ? 11 + ((i * 5) % 6) : kind === 1 ? 16 + ((i * 7) % 8) : 4 + (i % 3)) * s,
      h: (kind === 0 ? 6 + (i % 3) : kind === 1 ? 2 : 4 + (i % 3)) * s,
      radius: kind === 0 ? '0 70% 0 70%' : kind === 1 ? '2px' : '40% 60% 30% 70%',
      fill: DEBRIS_FILLS[i % DEBRIS_FILLS.length]!,
      duration: 11 + ((i * 11) % 9),
      delay: -((i * 3.1) % 18),
    };
  });
}

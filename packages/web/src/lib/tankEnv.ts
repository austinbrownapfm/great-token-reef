export type Phase = 'dawn' | 'day' | 'dusk' | 'night';
export type StormLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface TankEnv {
  phase: Phase;
  night: number;
  current: number;
  weather: StormLevel;
  vars: Record<string, string>;
}

const DAY_WATER = ['#0ea5b7', '#0b7a99', '#085b7a', '#073b52'];
const NIGHT_WATER = ['#0b2f6b', '#081f4d', '#061538', '#030a20'];
const STORM_WATER = '#04121c';
const CALM_FOG = '#1e3c48';
const STORM_FOG = '#16222e';
const DAY_SAND = '#d8c48f';
const NIGHT_SAND = '#3a465f';

// By storm level 0–6; fog peaks at 0.5 (+0.05 at night) so fish stay readable under the 0.6 cap.
const LADDER = {
  darken: [0, 0.08, 0.2, 0.32, 0.44, 0.55, 0.64],
  tint: [0, 0.06, 0.12, 0.18, 0.24, 0.3, 0.34],
  fog: [0.04, 0.1, 0.16, 0.26, 0.34, 0.44, 0.5],
  rays: [1, 0.8, 0.6, 0.42, 0.28, 0.18, 0.12],
  caustics: [1, 0.85, 0.68, 0.52, 0.38, 0.28, 0.2],
  rain: [0, 0, 0.4, 0.55, 0.7, 1, 1],
  chop: [0, 0.3, 0.5, 0.75, 0.85, 1, 1],
  sway: [1, 1, 1, 1.4, 1.6, 1.9, 2],
} as const;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};
const round = (n: number, d = 3) => String(Number(n.toFixed(d)));

function mix(a: string, b: string, t: number): string {
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const out = [0, 1, 2].map((i) => Math.round(lerp(ch(a, i), ch(b, i), t)));
  return `#${out.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export function burnRatio(tokensPerMin: number, baseline: number): number {
  if (!Number.isFinite(tokensPerMin) || !Number.isFinite(baseline) || baseline <= 0) return 0;
  return tokensPerMin / baseline;
}

export function currentLevel(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0.25) return 0;
  if (ratio >= 3) return 1;
  if (ratio <= 1) return lerp(0, 0.4, (ratio - 0.25) / 0.75);
  return lerp(0.4, 1, (ratio - 1) / 2);
}

// Integer per-mille avoids float drift: (0.6 - 0.4) * 10 is 1.9999…, which would floor a level short.
export function weatherFor(quotaPct: number): StormLevel {
  if (!Number.isFinite(quotaPct) || quotaPct < 0.5) return 0;
  const level = Math.floor(Math.round(quotaPct * 1000) / 100) - 4;
  return Math.min(6, Math.max(0, level)) as StormLevel;
}

// Dev-only ?reefStorm=<0-6> pins the level, like ?reefTime pins the hour.
export function parseStormLevel(v: unknown): StormLevel | undefined {
  const n = v === '' || v === null || v === undefined ? NaN : Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 6 ? (n as StormLevel) : undefined;
}

function nightAt(h: number): number {
  if (h >= 6 && h < 8) return 1 - smooth((h - 6) / 2);
  if (h >= 8 && h < 18) return 0;
  if (h >= 18 && h < 20) return smooth((h - 18) / 2);
  return 1;
}

function phaseAt(h: number): Phase {
  if (h >= 6 && h < 8) return 'dawn';
  if (h >= 8 && h < 18) return 'day';
  if (h >= 18 && h < 20) return 'dusk';
  return 'night';
}

export function tankEnv(input: { hour: number; burnRatio: number; quotaPct: number; storm?: StormLevel }): TankEnv {
  const h = ((((Number.isFinite(input.hour) ? input.hour : 12) % 24) + 24) % 24);
  const night = nightAt(h);
  const current = currentLevel(input.burnRatio);
  const weather = input.storm ?? weatherFor(input.quotaPct);

  const darken = LADDER.darken[weather];
  const water = DAY_WATER.map((d, i) => mix(mix(d, NIGHT_WATER[i] ?? d, night), STORM_WATER, darken));

  const tint = weather === 0 ? 'rgba(0, 0, 0, 0)' : `rgba(15, 25, 40, ${LADDER.tint[weather]})`;
  const fog = LADDER.fog[weather] + night * 0.05;
  const rays = lerp(0.35, 0, night) * LADDER.rays[weather];

  const vars: Record<string, string> = {
    '--reef-ray-opacity': round(rays),
    '--reef-caustic-opacity': round(lerp(0.25, 0.06, night) * LADDER.caustics[weather]),
    '--reef-caustic-speed': round(2 - 1.5 * current),
    '--reef-sand': mix(mix(DAY_SAND, NIGHT_SAND, night), STORM_WATER, darken * 0.6),
    '--reef-fog': round(fog),
    '--reef-tint': tint,
    '--reef-sway-amp': round(2 + 6 * current),
    '--reef-glow': round(night),
    '--reef-bubble-rate': round(0.4 + 1.6 * current),
    '--reef-fog-color': mix(CALM_FOG, STORM_FOG, weather / 6),
    '--reef-rain': round(LADDER.rain[weather]),
    '--reef-chop': round(LADDER.chop[weather]),
    '--reef-lightning': weather >= 4 ? '1' : '0',
    '--reef-storm-sway': round(LADDER.sway[weather]),
  };
  water.forEach((c, i) => {
    vars[`--reef-water-${i}`] = c;
  });

  return { phase: phaseAt(h), night, current, weather, vars };
}

const RATE_STEP = 0.25;

/** Bubble rate snapped to quarter steps, holding `prev` until the raw rate is more than 0.6 of a step from it, so a rate near an edge never flaps. */
export function snapBubbleRate(raw: number, prev: number | null): number {
  const rate = Number.isFinite(raw) ? raw : 1;
  const snapped = Math.min(2, Math.max(0.3, Math.round(rate / RATE_STEP) * RATE_STEP));
  return prev !== null && Math.abs(Math.min(2, Math.max(0.3, rate)) - prev) <= RATE_STEP * 0.6 ? prev : snapped;
}

/** Ambient bubble columns; the rate is snapped to quarter steps so small drifts in the burn rate between recomputes never add or drop one. */
export function bubbleCount(width: number, rate: number): number {
  const base = Math.min(20, Math.max(9, Math.round(Math.max(width, 600) / 90)));
  const snapped = Math.min(2, Math.max(0.3, Math.round((Number.isFinite(rate) ? rate : 1) * 4) / 4));
  return Math.round(base * snapped);
}

import { describe, expect, it } from 'vitest';
import { bubbleCount, snapBubbleRate, burnRatio, currentLevel, parseStormLevel, tankEnv, weatherFor } from './tankEnv';

describe('burnRatio', () => {
  it('guards bad input', () => {
    expect(burnRatio(500, 0)).toBe(0);
    expect(burnRatio(NaN, 10)).toBe(0);
    expect(burnRatio(30, 10)).toBe(3);
  });
});

describe('currentLevel', () => {
  it('is piecewise linear and clamped', () => {
    expect(currentLevel(0.1)).toBe(0);
    expect(currentLevel(1)).toBeCloseTo(0.4);
    expect(currentLevel(10)).toBe(1);
  });
});

describe('weatherFor', () => {
  it('climbs one level per 10% from 50%', () => {
    const table: [number, number][] = [
      [0.499, 0], [0.5, 1], [0.6, 2], [0.7, 3], [0.8, 4], [0.899, 4], [0.9, 5], [1, 6], [1.4, 6], [NaN, 0],
    ];
    for (const [pct, level] of table) expect(weatherFor(pct), `pct ${pct}`).toBe(level);
  });

  it('?reefStorm pins a valid level 0-6 and overrides the quota', () => {
    expect(['0', '6', 3, '7', '-1', '2.5', 'x', '', undefined].map(parseStormLevel)).toEqual([0, 6, 3, undefined, undefined, undefined, undefined, undefined, undefined]);
    expect(tankEnv({ hour: 13, burnRatio: 1, quotaPct: 0, storm: 5 }).weather).toBe(5);
  });

  it('guards non-finite and negative input', () => {
    expect(weatherFor(Infinity)).toBe(0);
    expect(weatherFor(-Infinity)).toBe(0);
    expect(weatherFor(-0.3)).toBe(0);
  });
});

const LEVEL_PCT = [0, 0.5, 0.6, 0.7, 0.8, 0.9, 1];

describe('tankEnv', () => {
  const base = { burnRatio: 1, quotaPct: 0 };

  it('day and night', () => {
    const day = tankEnv({ ...base, hour: 13 });
    expect(day.phase).toBe('day');
    expect(day.night).toBe(0);
    expect(day.vars['--reef-water-0']).toBe('#0ea5b7');
    const night = tankEnv({ ...base, hour: 2 });
    expect(night.phase).toBe('night');
    expect(night.night).toBe(1);
    expect(Number(night.vars['--reef-ray-opacity'])).toBe(0);
  });

  it('names dawn and dusk', () => {
    expect(tankEnv({ ...base, hour: 7 }).phase).toBe('dawn');
    expect(tankEnv({ ...base, hour: 19 }).phase).toBe('dusk');
  });

  it('night is continuous', () => {
    const n = (hour: number) => tankEnv({ ...base, hour }).night;
    expect(Math.abs(n(17.99) - n(18.01))).toBeLessThan(0.02);
    expect(Math.abs(n(23.99) - n(0))).toBeLessThan(0.02);
    expect(Math.abs(n(5.99) - n(6.01))).toBeLessThan(0.02);
    expect(Math.abs(n(7.99) - n(8.01))).toBeLessThan(0.02);
  });

  it('weather and current feed through', () => {
    const e = tankEnv({ hour: 13, burnRatio: 3, quotaPct: 0.95 });
    expect(e.weather).toBe(5);
    expect(e.current).toBe(1);
    const clear = tankEnv({ hour: 13, burnRatio: 3, quotaPct: 0 });
    expect(Number(e.vars['--reef-ray-opacity'])).toBeLessThan(Number(clear.vars['--reef-ray-opacity']));
  });

  it('storm stays readable', () => {
    for (const quotaPct of LEVEL_PCT) {
      for (let h = 0; h < 24; h += 0.25) {
        const env = tankEnv({ hour: h, burnRatio: 2, quotaPct });
        expect(Number(env.vars['--reef-fog'])).toBeLessThanOrEqual(0.6);
      }
    }
  });

  it('the storm never changes the current', () => {
    const calm = tankEnv({ hour: 13, burnRatio: 1.7, quotaPct: 0 });
    const maxed = tankEnv({ hour: 13, burnRatio: 1.7, quotaPct: 1 });
    expect(calm.weather).toBe(0);
    expect(maxed.weather).toBe(6);
    expect(maxed.current).toBe(calm.current);
    expect(maxed.vars['--reef-sway-amp']).toBe(calm.vars['--reef-sway-amp']);
    expect(maxed.vars['--reef-caustic-speed']).toBe(calm.vars['--reef-caustic-speed']);
  });

  it('rain starts at level 2, lightning at 4', () => {
    const at = LEVEL_PCT.map((quotaPct) => tankEnv({ hour: 13, burnRatio: 1, quotaPct }).vars);
    expect(at.map((v) => Number(v['--reef-rain']) > 0)).toEqual([false, false, true, true, true, true, true]);
    expect(at.map((v) => v['--reef-lightning'])).toEqual(['0', '0', '0', '0', '1', '1', '1']);
    expect(at.map((v) => Number(v['--reef-chop']) > 0)).toEqual([false, true, true, true, true, true, true]);
    expect(at.slice(0, 3).every((v) => Number(v['--reef-storm-sway']) === 1)).toBe(true);
    expect(Number(at[3]!['--reef-storm-sway'])).toBeGreaterThan(1);
  });

  it('every step is at least as stormy as the last', () => {
    const at = LEVEL_PCT.map((quotaPct) => tankEnv({ hour: 13, burnRatio: 1, quotaPct }).vars);
    const n = (v: Record<string, string>, k: string) => Number(v[k]);
    for (let i = 1; i < at.length; i++) {
      for (const k of ['--reef-fog', '--reef-rain', '--reef-chop', '--reef-storm-sway']) {
        expect(n(at[i]!, k), `${k} at ${i}`).toBeGreaterThanOrEqual(n(at[i - 1]!, k));
      }
      expect(n(at[i]!, '--reef-ray-opacity')).toBeLessThanOrEqual(n(at[i - 1]!, '--reef-ray-opacity'));
    }
    expect(at[0]!['--reef-water-0']).toBe('#0ea5b7');
    expect(at[5]!['--reef-water-0']).not.toBe(at[4]!['--reef-water-0']);
  });

  it('each level from 2 up is visibly darker than the last', () => {
    const lum = (hex: string) => [1, 3, 5].reduce((s, i) => s + parseInt(hex.slice(i, i + 2), 16), 0) / 3;
    const at = LEVEL_PCT.map((quotaPct) => tankEnv({ hour: 13, burnRatio: 1, quotaPct }).vars);
    for (let i = 2; i < at.length; i++) {
      for (const k of ['--reef-water-0', '--reef-water-1']) {
        expect(lum(at[i]![k]!), `${k} at ${i}`).toBeLessThan(lum(at[i - 1]![k]!) * 0.9);
      }
      expect(Number(at[i]!['--reef-caustic-opacity'])).toBeLessThan(Number(at[i - 1]!['--reef-caustic-opacity']));
    }
  });
});

describe('bubbleCount', () => {
  it('keeps the original count at rate 1 and scales with the current', () => {
    expect(bubbleCount(1200, 1)).toBe(13);
    expect(bubbleCount(1200, 2)).toBe(26);
    expect(bubbleCount(1200, 0.1)).toBe(bubbleCount(1200, 0.3));
  });

  it('does not churn as the rate wobbles a little between recomputes', () => {
    const counts = new Set([0.97, 1, 1.03, 1.08, 1.1].map((r) => bubbleCount(1200, r)));
    expect(counts.size).toBe(1);
  });
});

describe('snapBubbleRate', () => {
  it('holds the current step until the rate moves well past its edge', () => {
    expect(snapBubbleRate(1.12, null)).toBe(1);
    expect(snapBubbleRate(1.14, 1)).toBe(1);
    expect(snapBubbleRate(1.16, 1)).toBe(1.25);
    // Back near the edge: stays on 1.25 rather than flapping.
    expect(snapBubbleRate(1.12, 1.25)).toBe(1.25);
    expect(snapBubbleRate(1.09, 1.25)).toBe(1);
    expect(snapBubbleRate(5, 1)).toBe(2);
    expect(snapBubbleRate(0, 1)).toBe(0.3);
    expect(snapBubbleRate(NaN, null)).toBe(1);
  });
});

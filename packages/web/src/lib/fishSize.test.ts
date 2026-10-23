import { describe, expect, it } from 'vitest';
import { ENTRIES, SPECIES_DEFS } from '@gtr/shared';
import { growthFactor, tankWidth } from './fishSize';

const speciesIndex = (name: string) => {
  const i = SPECIES_DEFS.findIndex((d) => d.name === name);
  if (i < 0) throw new Error(`no species ${name}`);
  return i;
};
const entryOf = (name: string, b?: 's' | 'L') => {
  const s = speciesIndex(name);
  const i = ENTRIES.findIndex((e) => e.s === s && e.b === b);
  if (i < 0) throw new Error(`no ${b ?? 'adult'} entry for ${name}`);
  return i;
};
const speciesWithAllBiases = () => {
  const s = SPECIES_DEFS.findIndex((_, si) => ['s', undefined, 'L'].every((b) => ENTRIES.some((e) => e.s === si && e.b === b)));
  if (s < 0) throw new Error('no species with juvenile, adult and trophy entries');
  return SPECIES_DEFS[s]!.name;
};

describe('tankWidth', () => {
  it('keeps the smallest and largest species inside the band in both modes', () => {
    for (const name of ['Lined Seahorse', 'Giant Manta Ray']) {
      const e = entryOf(name);
      for (const best of [0, 14, 50, 500]) {
        const full = tankWidth(e, best, true);
        const strip = tankWidth(e, best, false);
        expect(full).toBeGreaterThanOrEqual(50);
        expect(full).toBeLessThanOrEqual(280);
        expect(strip).toBeGreaterThanOrEqual(34);
        expect(strip).toBeLessThanOrEqual(190);
      }
    }
  });

  it('draws a sturgeon more than three times a bluegill at equal growth', () => {
    const sturgeon = entryOf('Lake Sturgeon');
    const bluegill = entryOf('Bluegill');
    for (const fullscreen of [true, false]) {
      expect(tankWidth(sturgeon, 45, fullscreen)).toBeGreaterThan(3 * tankWidth(bluegill, 45, fullscreen));
    }
  });

  it('draws a juvenile smaller than an adult smaller than a trophy', () => {
    const name = speciesWithAllBiases();
    // Each entry at its own neutral growth (1.0×), so only the bias differs.
    const neutral = (b?: 's' | 'L') => 44.857 * (b === 's' ? 0.5 : b === 'L' ? 1.6 : 1);
    const w = (b?: 's' | 'L') => tankWidth(entryOf(name, b), neutral(b), true);
    expect(w('s')).toBeLessThan(w());
    expect(w()).toBeLessThan(w('L'));
  });

  it('grows with the personal best', () => {
    const bass = entryOf('Largemouth Bass');
    expect(tankWidth(bass, 80, true)).toBeGreaterThan(tankWidth(bass, 20, true));
  });
});

describe('growthFactor', () => {
  it('runs 0.85 at 14 cm × bias to 1.2 at 86 cm × bias', () => {
    const adult = entryOf('Largemouth Bass');
    expect(growthFactor(adult, 14)).toBeCloseTo(0.85);
    expect(growthFactor(adult, 86)).toBeCloseTo(1.2);
    expect(growthFactor(adult, 5)).toBeCloseTo(0.85);
    expect(growthFactor(adult, 300)).toBeCloseTo(1.2);
    const name = speciesWithAllBiases();
    expect(growthFactor(entryOf(name, 's'), 7)).toBeCloseTo(0.85);
    expect(growthFactor(entryOf(name, 's'), 43)).toBeCloseTo(1.2);
    expect(growthFactor(entryOf(name, 'L'), 14 * 1.6)).toBeCloseTo(0.85);
    expect(growthFactor(entryOf(name, 'L'), 86 * 1.6)).toBeCloseTo(1.2);
  });

  it('is monotonic in the best size', () => {
    const e = entryOf('Bluegill');
    let prev = 0;
    for (let cm = 0; cm <= 120; cm += 0.5) {
      const g = growthFactor(e, cm);
      expect(g).toBeGreaterThanOrEqual(prev);
      prev = g;
    }
  });
});

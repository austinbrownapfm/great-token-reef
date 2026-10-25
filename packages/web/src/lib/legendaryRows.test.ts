import { describe, expect, it } from 'vitest';
import { LEGENDARY_DEFS, LEGENDARY_ID_BASE } from '@gtr/shared';
import type { ReefCollection } from './api';
import { searchFish } from './reefFishPicker';
import { maskCollection } from './tankRelease';
import { allSpecies, legendaryProgress, legendaryRows, legendarySlot, previewLegendary } from './legendaryRows';

const l = (species: number, shiny: number, caught_at: number, project = '/p/a'): ReefCollection['legendary'][number] =>
  ({ species, name: `L${species}`, shiny, size: 0, caught_at, depth_tokens: 1, project });

describe('legendaryRows', () => {
  it('folds regular and shiny catches of one legendary into one species row', () => {
    const rows = legendaryRows([l(1000, 0, 10, '/p/a'), l(1000, 1, 20, '/p/b'), l(1001, 0, 15)]);
    expect(rows).toEqual([
      expect.objectContaining({ species: 1000, rarity: 'legendary', count: 2, shiny_count: 1, first_caught: 10, last_caught: 20, first_project: '/p/a' }),
      expect.objectContaining({ species: 1001, rarity: 'legendary', count: 1, shiny_count: 0 }),
    ]);
  });
});

describe('allSpecies and previewLegendary', () => {
  const col = { species: [], legendary: [l(1000, 0, 10)], recent: [] } as ReefCollection;

  it('appends the legendary rows after the catalog species', () => {
    expect(allSpecies(col, false).map((s) => s.species)).toEqual([1000]);
  });

  it('preview replaces them with every legendary, regular and shiny', () => {
    const p = previewLegendary();
    expect(p).toHaveLength(LEGENDARY_DEFS.length * 2);
    expect(allSpecies(col, true).map((s) => s.species)).toEqual(LEGENDARY_DEFS.map((_, i) => LEGENDARY_ID_BASE + i));
  });
});

describe('Inventory picker rows', () => {
  const col = { species: [], legendary: [l(1003, 1, 10)], recent: [] } as ReefCollection;

  it('a caught legendary is searchable and resolves a row for an existing pick entry', () => {
    const released = maskCollection(allSpecies(col, false), []);
    expect(searchFish(released, 'l1003', 'legendary', new Set()).map((r) => r.species)).toEqual([1003]);
    const rows = new Map(released.map((r) => [r.species, r]));
    expect(rows.get(1003)).toMatchObject({ name: 'L1003', rarity: 'legendary', shiny_count: 1 });
  });
});

describe('legendarySlot', () => {
  const row = (i: number, shiny: boolean, at: number): ReefCollection['legendary'][number] => ({
    species: LEGENDARY_ID_BASE + i, name: LEGENDARY_DEFS[i]!.name, shiny: shiny ? 1 : 0, size: 400, caught_at: at,
    depth_tokens: 0, project: '', id: at, seed: `s${at}`, session_id: 'lifetime', catch_index: i, rarity: 'legendary', agent: null,
  } as ReefCollection['legendary'][number]);

  it('shows the regular silhouette and its threshold when nothing is caught', () => {
    expect(legendarySlot([], 0)).toEqual({ shiny: false, caught: undefined, next: 100_000_000 });
  });

  it('shows the regular catch and points at the shiny threshold', () => {
    const reg = row(0, false, 1);
    expect(legendarySlot([reg], 0)).toEqual({ shiny: false, caught: reg, next: 200_000_000 });
  });

  it('shows only the shiny once it is caught', () => {
    const reg = row(1, false, 1);
    const shiny = row(1, true, 2);
    expect(legendarySlot([reg, shiny], 1)).toEqual({ shiny: true, caught: shiny, next: null });
  });
});

describe('legendaryProgress', () => {
  it('runs from zero to the Tiger Shark before any legendary', () => {
    expect(legendaryProgress(25_000_000)).toMatchObject({ from: 0, next: { index: 0, shiny: false, threshold: 100_000_000 }, pct: 25 });
  });

  it('runs from the last threshold passed to the next one', () => {
    // 100M passed; next is 200M (regular Leatherback before shiny Tiger Shark)
    expect(legendaryProgress(150_000_000)).toMatchObject({ from: 100_000_000, next: { index: 1, shiny: false, threshold: 200_000_000 }, pct: 50 });
  });

  it('is complete after the shiny Giant Squid', () => {
    expect(legendaryProgress(500_000_000_000)).toEqual({ from: 409_600_000_000, next: null, pct: 100 });
  });
});

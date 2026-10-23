import { describe, expect, it } from 'vitest';
import { LEGENDARY_DEFS, LEGENDARY_ID_BASE } from '@gtr/shared';
import type { ReefCollection } from './api';
import { searchFish } from './reefFishPicker';
import { maskCollection } from './tankRelease';
import { allSpecies, legendaryRows, previewLegendary } from './legendaryRows';

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

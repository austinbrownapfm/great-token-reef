import { describe, expect, it } from 'vitest';
import type { ReefSpeciesRow } from './api';
import { addFish, dropIndex, moveItem, removeFish, searchFish, startingPick } from './reefFishPicker';

function row(species: number, name: string, rarity: ReefSpeciesRow['rarity'] = 'common', last_caught = 2000): ReefSpeciesRow {
  return {
    species, name, rarity, count: 1, shiny_count: 0,
    best_size: 30, first_caught: 1000, last_caught, first_project: '/p/my-app', released_best_size: 30,
  };
}

const ids = (rows: { species: number }[]) => rows.map((r) => r.species);

describe('searchFish', () => {
  const rows = [row(1, 'Albino Gar'), row(2, 'Clownfish', 'rare'), row(3, 'Puffer', 'epic'), row(4, 'Garibaldi', 'uncommon'), row(5, 'Kraken', 'legendary')];

  it('matches a name substring case-insensitively, sorted by name', () => {
    expect(ids(searchFish(rows, 'GAR', null, new Set()))).toEqual([1, 4]);
    expect(ids(searchFish(rows, '  gar ', null, new Set()))).toEqual([1, 4]);
  });

  it('an empty query lists every pickable fish, legendaries included', () => {
    expect(ids(searchFish(rows, '', null, new Set()))).toEqual([1, 2, 4, 5, 3]);
    expect(ids(searchFish(rows, 'kraken', null, new Set()))).toEqual([5]);
  });

  it('filters by rarity', () => {
    expect(ids(searchFish(rows, '', 'rare', new Set()))).toEqual([2]);
    expect(ids(searchFish(rows, 'gar', 'uncommon', new Set()))).toEqual([4]);
  });

  it('leaves out fish already in the list', () => {
    expect(ids(searchFish(rows, '', null, new Set([1, 3])))).toEqual([2, 4, 5]);
  });
});

describe('addFish', () => {
  it('appends to the end', () => {
    expect(addFish([3, 1], 7, 10)).toEqual([3, 1, 7]);
  });

  it('never adds a duplicate', () => {
    const list = [3, 1];
    expect(addFish(list, 1, 10)).toBe(list);
  });

  it('respects the cap', () => {
    const list = [1, 2, 3];
    expect(addFish(list, 4, 3)).toBe(list);
  });
});

describe('removeFish', () => {
  it('drops the fish and keeps the order of the rest', () => {
    expect(removeFish([3, 1, 7], 1)).toEqual([3, 7]);
  });

  it('is a no-op for a fish not in the list', () => {
    const list = [3, 1];
    expect(removeFish(list, 9)).toBe(list);
  });
});

describe('moveItem', () => {
  it('moves down and up, keeping every member once', () => {
    expect(moveItem([1, 2, 3, 4], 0, 2)).toEqual([2, 3, 1, 4]);
    expect(moveItem([1, 2, 3, 4], 3, 1)).toEqual([1, 4, 2, 3]);
  });

  it('does not mutate the input', () => {
    const list = [1, 2, 3];
    moveItem(list, 0, 2);
    expect(list).toEqual([1, 2, 3]);
  });

  it('clamps an out-of-range target and ignores an out-of-range source', () => {
    expect(moveItem([1, 2, 3], 0, 9)).toEqual([2, 3, 1]);
    expect(moveItem([1, 2, 3], 2, -4)).toEqual([3, 1, 2]);
    const list = [1, 2, 3];
    expect(moveItem(list, 5, 0)).toBe(list);
    expect(moveItem(list, 1, 1)).toBe(list);
  });
});

describe('startingPick', () => {
  const rows = Array.from({ length: 40 }, (_, i) => row(i + 1, `Fish ${i + 1}`, i < 5 ? 'epic' : 'common', 1000 + i));

  it('keeps a saved pick as is', () => {
    expect(startingPick([4, 2], rows, 'strip')).toEqual([4, 2]);
    expect(startingPick([], rows, 'full')).toEqual([]);
  });

  it('an unset strip starts with the automatic roster at 8; fullscreen at 28', () => {
    const strip = startingPick(null, rows, 'strip');
    expect(strip).toHaveLength(8);
    expect(strip.slice(0, 5).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect(startingPick(null, rows, 'full')).toHaveLength(28);
  });
});

describe('dropIndex', () => {
  // Four 20px rows from y=0; their midpoints sit at 10, 30, 50, 70.
  const rows = [0, 20, 40, 60].map((top) => ({ top, height: 20 }));

  it('counts the other rows whose midpoint is above the pointer', () => {
    expect(dropIndex(5, rows, 0, 4)).toBe(0);
    expect(dropIndex(45, rows, 0, 4)).toBe(1);
    expect(dropIndex(75, rows, 0, 4)).toBe(3);
    expect(dropIndex(35, rows, 3, 4)).toBe(2);
  });

  it('skips the dragged row, unmounted rows and stale rows past the list', () => {
    expect(dropIndex(75, rows, 1, 4)).toBe(3);
    expect(dropIndex(75, [rows[0]!, null, rows[2]!, rows[3]!], 0, 4)).toBe(2);
    expect(dropIndex(75, rows, 0, 3)).toBe(2);
  });
});

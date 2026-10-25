import { describe, expect, it } from 'vitest';
import type { ReefCatch, ReefSpeciesRow } from './api';
import { FISH_CAPS, guestsAfterStep, overflowGuests, picksSettled, pickRoster, rosterFromPick, seedPick, seedReady } from './tankPicks';

function row(species: number, rarity: ReefSpeciesRow['rarity'] = 'common', last_caught = 2000, shiny_count = 0): ReefSpeciesRow {
  return {
    species, name: `Fish ${species}`, rarity, count: 1, shiny_count,
    best_size: 30, first_caught: 1000, last_caught, first_project: '/p/my-app', released_best_size: 30,
  };
}

const ids = (fish: { species: number }[]) => fish.map((f) => f.species);

describe('rosterFromPick', () => {
  const rows = [row(1), row(2, 'rare'), row(3, 'epic'), row(4), row(5, 'common', 2000, 2)];

  it('keeps the pick order, not rarity order', () => {
    expect(ids(rosterFromPick(rows, [4, 1, 3], [], 10))).toEqual([4, 1, 3]);
  });

  it('appends guests not already picked, each once', () => {
    expect(ids(rosterFromPick(rows, [4, 1], [1, 2, 2, 5], 10))).toEqual([4, 1, 2, 5]);
  });

  it('caps the pick but not the guests', () => {
    expect(ids(rosterFromPick(rows, [1, 2, 3], [4, 5], 2))).toEqual([1, 2, 4, 5]);
  });

  it('skips ids missing from the collection', () => {
    expect(ids(rosterFromPick(rows, [9, 1, 8], [7, 2], 2))).toEqual([1, 2]);
  });

  it('draws a fish shiny when any shiny of it was caught', () => {
    const [plain, shiny] = rosterFromPick(rows, [1, 5], [], 10);
    expect(plain).toMatchObject({ species: 1, shiny: false, name: 'Fish 1', bestSize: 30 });
    expect(shiny).toMatchObject({ species: 5, shiny: true });
  });
});

describe('legendaries in picks', () => {
  const rows = [row(1), row(1003, 'legendary'), row(2, 'epic')];

  it('a caught legendary is pickable for both views and counts toward the cap', () => {
    for (const view of ['full', 'strip'] as const) {
      expect(ids(rosterFromPick(rows, [1003, 1], [], FISH_CAPS[view]))).toEqual([1003, 1]);
      expect(ids(rosterFromPick(rows, [1003, 1, 2], [], 2))).toEqual([1003, 1]);
    }
  });
});

describe('seedPick', () => {
  it('is today\'s automatic roster, as species', () => {
    const rows = [row(1, 'common', 3000), row(2, 'rare'), row(3, 'epic'), row(4, 'common', 4000)];
    expect(seedPick(rows, 3, FISH_CAPS.full)).toEqual(ids(pickRoster(rows, 3)));
    expect(seedPick(rows, 3, FISH_CAPS.full)).toEqual([3, 2, 4]);
  });

  it('clamps to the view cap', () => {
    const rows = Array.from({ length: 14 }, (_, i) => row(i + 1));
    expect(seedPick(rows, 13, FISH_CAPS.strip)).toHaveLength(10);
    expect(seedPick(rows, 13, FISH_CAPS.strip)).toEqual(ids(pickRoster(rows, 13)).slice(0, 10));
  });

  it('seeds a caught legendary, ahead of everything else', () => {
    expect(seedPick([row(1, 'legendary'), row(2)], 6, 10)).toEqual([1, 2]);
  });
});

describe('overflowGuests', () => {
  const held = (id: number, species: number, rarity: ReefSpeciesRow['rarity'] = 'common') => ({ id, species, shiny: 0, rarity });

  it('adds first-ever species among the unshown catches, each once, after the current guests', () => {
    const all = [held(1, 5), held(2, 6), held(3, 7), held(4, 7), held(5, 8)];
    // 1 was shown as its own step; 6 was known; 8 is already a guest.
    expect(overflowGuests(all, new Set([1]), new Set([6]), [8])).toEqual([8, 7]);
  });

  it('adds a first-ever legendary like any other species', () => {
    expect(overflowGuests([held(1, 1003, 'legendary')], new Set(), new Set(), [])).toEqual([1003]);
  });

  it('returns the same guests when nothing is new', () => {
    const guests = [4];
    expect(overflowGuests([held(1, 4), held(2, 6)], new Set([2]), new Set(), guests)).toBe(guests);
  });
});

describe('guestsAfterStep', () => {
  const held = (id: number, species: number, rarity: ReefSpeciesRow['rarity'] = 'common') => ({ id, species, shiny: 0, rarity });
  const caught = (id: number, species: number): ReefCatch => ({
    agent: 'claude', id, seed: `s#${id}`, session_id: 's', catch_index: id, caught_at: 1000, project: '/p/my-app',
    depth_tokens: 2_000_000, species, name: `Fish ${species}`, rarity: 'common', shiny: 0, size: 30,
  });

  it('a drop step adds its species as a guest once', () => {
    const after = guestsAfterStep({ kind: 'drop', catch: caught(1, 5) }, [2], [held(1, 5)], new Set([1]), new Set());
    expect(after).toEqual([2, 5]);
    expect(guestsAfterStep({ kind: 'drop', catch: caught(2, 5) }, after, [held(2, 5)], new Set([2]), new Set())).toBe(after);
  });

  it('the overflow step adds first-ever species among the catches that got no step', () => {
    const all = [held(1, 5), held(2, 6), held(3, 7)];
    expect(guestsAfterStep({ kind: 'more', count: 2 }, [5], all, new Set([1]), new Set([6]))).toEqual([5, 7]);
  });

  it('banner, upgrade and visitor steps leave the guests alone', () => {
    const guests = [3];
    expect(guestsAfterStep({ kind: 'banner', catch: caught(1, 5) }, guests, [held(1, 5)], new Set([1]), new Set())).toBe(guests);
    expect(guestsAfterStep({ kind: 'upgrade', catch: caught(1, 5) }, guests, [held(1, 5)], new Set([1]), new Set())).toBe(guests);
  });
});

describe('picksSettled', () => {
  it('waits while the picks load or a view has no pick yet', () => {
    expect(picksSettled({ data: undefined, isError: false }, null, false)).toBe(false);
    expect(picksSettled({ data: { strip: null, full: null }, isError: false }, null, false)).toBe(false);
  });

  it('settles on a pick, or on a visible failure', () => {
    expect(picksSettled({ data: { strip: [1], full: null }, isError: false }, [1], false)).toBe(true);
    expect(picksSettled({ data: undefined, isError: true }, null, true)).toBe(true);
    expect(picksSettled({ data: { strip: null, full: null }, isError: false }, null, true)).toBe(true);
  });
});

describe('seedReady', () => {
  const ok = {
    unset: true, alreadySeeded: false, picksError: false, picksFresh: true, dataReady: true, queueError: false, releasing: false,
  };

  it('seeds an unset view once everything is fresh and healthy', () => {
    expect(seedReady(ok)).toBe(true);
  });

  it('never seeds while the release queue (pending) failed, so unreleased catches cannot be saved into a pick', () => {
    expect(seedReady({ ...ok, queueError: true })).toBe(false);
  });

  it('waits on a set view, a seeded view, a failed or stale picks query, missing data, or a running release', () => {
    expect(seedReady({ ...ok, unset: false })).toBe(false);
    expect(seedReady({ ...ok, alreadySeeded: true })).toBe(false);
    expect(seedReady({ ...ok, picksError: true })).toBe(false);
    expect(seedReady({ ...ok, picksFresh: false })).toBe(false);
    expect(seedReady({ ...ok, dataReady: false })).toBe(false);
    expect(seedReady({ ...ok, releasing: true })).toBe(false);
  });
});

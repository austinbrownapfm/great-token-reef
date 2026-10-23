import { describe, expect, it } from 'vitest';
import { BACKDROP_FOR_WATER, DECOR_FOR_FAMILY, FISH_SETS } from '@gtr/shared';
import type { ReefRewards, ReefSpeciesRow } from './api';
import {
  arrangeChanges, arrangeExitDetail, arrangeStage, arrowNudge, clampFrac, inventoryCounts, inventoryModel, pinDecor, releasedInventory,
  toGoLabel, trayDrop,
} from './reefInventory';
import { OPEN_WATER, decorKey, decorSize, layoutDecor } from './tankDecor';
import { maskCollection } from './tankRelease';

const NONE: ReefRewards = { badges: [], decor: [], backdrops: [], activeBackdrop: OPEN_WATER };
const family = (key: string) => FISH_SETS.find((s) => s.id === `family:${key}`)!;
const water = (key: string) => FISH_SETS.find((s) => s.id === `water:${key}`)!;
const speciesSets = FISH_SETS.filter((s) => s.level === 'species');

describe('inventoryModel', () => {
  it('locks every family and water set with nothing caught; open water is always earned', () => {
    const m = inventoryModel(NONE, new Set(), new Set());
    expect(m.decor).toEqual([]);
    expect(m.locked).toHaveLength(21);
    for (const l of m.locked) expect(l.toGo).toBe(l.total);
    expect(m.backdrops.map((b) => b.item)).toEqual([OPEN_WATER, ...Object.values(BACKDROP_FOR_WATER)]);
    expect(m.backdrops[0]).toMatchObject({ item: OPEN_WATER, earned: true, active: true, locked: null });
    for (const b of m.backdrops.slice(1)) {
      expect(b.earned).toBe(false);
      expect(b.locked!.toGo).toBe(b.locked!.total);
    }
    expect(m.badges).toMatchObject({ earned: [], total: 48 });
  });

  it('lists earned decor with labels and drops its family from the locked list', () => {
    const rewards: ReefRewards = {
      ...NONE,
      decor: [{ item: 'rowboat', shown: true, xFrac: 0.3 }, { item: 'anchor', shown: false, xFrac: null }],
    };
    const m = inventoryModel(rewards, new Set(), new Set());
    expect(m.decor).toEqual([
      { item: 'rowboat', label: 'Rowboat', shown: true, xFrac: 0.3 },
      { item: 'anchor', label: 'Anchor', shown: false, xFrac: null },
    ]);
    expect(m.locked.map((l) => l.item)).not.toContain(DECOR_FOR_FAMILY.bass);
    expect(m.locked.map((l) => l.item)).not.toContain(DECOR_FOR_FAMILY.flatfish);
    expect(m.locked).toHaveLength(19);
  });

  it('counts released catches only: a set completed by a pending catch is still locked with 1 to go', () => {
    const set = family('gar');
    const caught = new Set(set.entries);
    const released = new Set(set.entries.slice(1));
    const m = inventoryModel(NONE, caught, released);
    const gar = m.locked.find((l) => l.setId === set.id)!;
    expect(gar).toMatchObject({ item: 'old-boot', have: set.entries.length - 1, toGo: 1, waiting: false });
    expect(m.decor).toEqual([]);
  });

  it('never counts a released entry that is not caught', () => {
    const set = family('gar');
    const m = inventoryModel(NONE, new Set(), new Set(set.entries));
    expect(m.locked.find((l) => l.setId === set.id)!.have).toBe(0);
  });

  it('marks a fully released set whose reward event is still queued as waiting', () => {
    const set = family('gar');
    const all = new Set(set.entries);
    const gar = inventoryModel(NONE, all, all).locked.find((l) => l.setId === set.id)!;
    expect(gar).toMatchObject({ toGo: 0, waiting: true });
  });

  it('orders locked sets closest first', () => {
    const near = family('gar');
    const all = new Set(near.entries.slice(1));
    const m = inventoryModel(NONE, all, all);
    expect(m.locked[0]!.setId).toBe(near.id);
    for (let i = 1; i < m.locked.length; i++) expect(m.locked[i]!.toGo).toBeGreaterThanOrEqual(m.locked[i - 1]!.toGo);
  });

  it('earns and activates backdrops from rewards; water progress uses released catches', () => {
    const fresh = water('fresh');
    const salt = water('salt');
    const caught = new Set([...fresh.entries, ...salt.entries]);
    const released = new Set(salt.entries.slice(0, 3));
    const m = inventoryModel({ ...NONE, backdrops: ['river-rock'], activeBackdrop: 'river-rock' }, caught, released);
    const byItem = new Map(m.backdrops.map((b) => [b.item, b]));
    expect(byItem.get(OPEN_WATER)).toMatchObject({ earned: true, active: false });
    expect(byItem.get('river-rock')).toMatchObject({ earned: true, active: true, locked: null });
    expect(byItem.get('coral-wall')!.locked).toMatchObject({ have: 3, toGo: salt.entries.length - 3 });
  });

  it('summarises species badges with the closest unfinished species first', () => {
    const [a, b] = speciesSets;
    const near = speciesSets.slice(2).find((s) => s.entries.length > 1)!;
    const all = new Set(near.entries.slice(1));
    const m = inventoryModel({ ...NONE, badges: [a!.id, b!.id] }, all, all);
    expect(m.badges.earned).toEqual([a!.id, b!.id]);
    expect(m.badges.next.length).toBeLessThanOrEqual(5);
    expect(m.badges.next.map((n) => n.setId)).not.toContain(a!.id);
    expect(m.badges.next[0]).toMatchObject({ setId: near.id, toGo: 1, item: null });
  });
});

describe('arrange helpers', () => {
  const decor = [
    { item: 'rowboat', shown: true, xFrac: null },
    { item: 'anchor', shown: true, xFrac: 0.5 },
    { item: 'log', shown: true, xFrac: null },
    { item: 'barrel', shown: false, xFrac: null },
  ];

  it('pins every shown auto-placed piece at its current spot and leaves hidden ones alone', () => {
    const rocks = [{ x: 300, w: 80 }];
    const pinned = pinDecor(decor, 1000, rocks);
    const before = new Map(layoutDecor(decor, 1000, rocks).map((p) => [p.item, p.x]));
    expect(pinned.find((d) => d.item === 'anchor')!.xFrac).toBe(0.5);
    expect(pinned.find((d) => d.item === 'rowboat')!.xFrac).toBeCloseTo(before.get('rowboat')! / 1000);
    expect(pinned.find((d) => d.item === 'log')!.xFrac).toBeCloseTo(before.get('log')! / 1000);
    expect(pinned.find((d) => d.item === 'barrel')!.xFrac).toBeNull();
  });

  it('keeps the other pieces still when one is hidden after pinning', () => {
    const pinned = pinDecor(decor, 1000);
    const hidden = pinned.map((d) => (d.item === 'rowboat' ? { ...d, shown: false } : d));
    const at = (list: typeof decor) => new Map(layoutDecor(list, 1000).map((p) => [p.item, p.x]));
    expect(at(hidden).get('log')).toBeCloseTo(at(pinned).get('log')!);
  });

  it('lists only changed items: moves, hides, shows, and newly pinned spots', () => {
    const draft = [
      { item: 'rowboat', shown: true, xFrac: 0.2 },
      { item: 'anchor', shown: true, xFrac: 0.5 },
      { item: 'log', shown: false, xFrac: null },
      { item: 'barrel', shown: true, xFrac: 0.8 },
    ];
    expect(arrangeChanges(decor, draft)).toEqual([
      { item: 'rowboat', patch: { xFrac: 0.2 } },
      { item: 'log', patch: { shown: false } },
      { item: 'barrel', patch: { shown: true, xFrac: 0.8 } },
    ]);
  });

  it('never sends a hidden piece a position it did not have', () => {
    const draft = decor.map((d) => (d.item === 'anchor' ? { ...d, shown: false } : d));
    expect(arrangeChanges(decor, draft)).toEqual([{ item: 'anchor', patch: { shown: false } }]);
  });

  it('clamps a centre so the whole piece stays in the tank', () => {
    expect(clampFrac(-50, 100, 1000)).toBe(0.05);
    expect(clampFrac(990, 100, 1000)).toBe(0.95);
    expect(clampFrac(400, 100, 1000)).toBe(0.4);
    expect(clampFrac(400, 2000, 1000)).toBe(0.5);
  });
});

describe('arrangeExitDetail', () => {
  it('logs a Back-button exit, but not our own cancel or save, nor a tank that was never arranging', () => {
    expect(arrangeExitDetail(true, false)).toBe('back');
    expect(arrangeExitDetail(true, true)).toBeNull();
    expect(arrangeExitDetail(false, false)).toBeNull();
  });
});

describe('releasedInventory (the Inventory call site)', () => {
  const set = family('gar');
  const row = (species: number): ReefSpeciesRow => ({
    species, name: `Gar ${species}`, rarity: 'common', count: 1, shiny_count: 0,
    best_size: 30, first_caught: 1, last_caught: 2, first_project: '', released_best_size: 30,
  });
  const species = set.entries.map(row);

  it('a set finished by a pending catch still shows 1 to go, then waits once that catch is released', () => {
    const last = set.entries.at(-1)!;
    const pending = [{ id: 9, species: last, shiny: 0, rarity: 'common' }];
    expect(releasedInventory(NONE, new Set(), species, maskCollection(species, pending)).locked.find((l) => l.setId === set.id)).toMatchObject({ toGo: 1, waiting: false });
    expect(releasedInventory(NONE, new Set(), species, species).locked.find((l) => l.setId === set.id)).toMatchObject({ toGo: 0, waiting: true });
  });

  it('a reward a running release still holds stays out until its unveil', () => {
    const rewards: ReefRewards = { ...NONE, decor: [{ item: 'old-boot', shown: true, xFrac: null }] };
    expect(releasedInventory(rewards, new Set([decorKey('old-boot')]), species, species).decor).toEqual([]);
    expect(releasedInventory(rewards, new Set(), species, species).decor.map((d) => d.item)).toEqual(['old-boot']);
  });
});

describe('inventory labels', () => {
  it('says a fully released set waits to release, else how many are to go', () => {
    const l = { setId: 'family:gar', label: 'Gar', item: 'old-boot', have: 3, total: 5, toGo: 2, waiting: false };
    expect(toGoLabel(l)).toBe('2 to go');
    expect(toGoLabel({ ...l, have: 5, toGo: 0, waiting: true })).toBe('🏆 waiting to release');
  });

  it('counts decor out of earned plus locked, and backdrops without the free open water', () => {
    const m = inventoryModel({ ...NONE, decor: [{ item: 'rowboat', shown: true, xFrac: null }], backdrops: ['river-rock'] }, new Set(), new Set());
    expect(inventoryCounts(m)).toEqual({ decor: 1, decorTotal: 21, backdrops: 1, backdropTotal: Object.keys(BACKDROP_FOR_WATER).length });
    expect(inventoryCounts(inventoryModel(NONE, new Set(), new Set())).backdrops).toBe(0);
  });
});

describe('arrangeStage', () => {
  it('asks for fullscreen once on entry and waits for it without asking again', () => {
    expect(arrangeStage(null, false)).toEqual({ stage: 'asked', action: 'toggle' });
    expect(arrangeStage('asked', false)).toEqual({ stage: 'asked', action: null });
  });

  it('is in once fullscreen arrives, or when it opens already in fullscreen', () => {
    expect(arrangeStage('asked', true)).toEqual({ stage: 'in', action: null });
    expect(arrangeStage(null, true)).toEqual({ stage: 'in', action: null });
  });

  it('leaving fullscreen after it began cancels arranging', () => {
    expect(arrangeStage('in', false)).toEqual({ stage: 'in', action: 'cancel' });
  });
});

describe('arrowNudge', () => {
  it('steps a piece 2% of the tank per arrow key, kept whole in the tank; other keys do nothing', () => {
    expect(arrowNudge('ArrowLeft', 500, 100, 1000)).toBeCloseTo(0.48);
    expect(arrowNudge('ArrowRight', 500, 100, 1000)).toBeCloseTo(0.52);
    expect(arrowNudge('ArrowRight', 945, 100, 1000)).toBe(0.95);
    expect(arrowNudge('ArrowLeft', 55, 100, 1000)).toBe(0.05);
    expect(arrowNudge('ArrowUp', 500, 100, 1000)).toBeNull();
    expect(arrowNudge('Enter', 500, 100, 1000)).toBeNull();
  });
});

describe('trayDrop', () => {
  const tray = { left: 10, right: 300, top: 50, bottom: 90 };
  const tank = { left: 100, right: 1100, top: 0, bottom: 500, height: 500 };

  it('lands at the pointer, in tank coordinates, kept whole in the tank', () => {
    expect(trayDrop('rowboat', { x: 600, y: 300 }, tray, tank, 1000, true)).toBeCloseTo(0.5);
    const w = decorSize('rowboat', 500, true).w;
    expect(trayDrop('rowboat', { x: 105, y: 300 }, tray, tank, 1000, true)).toBeCloseTo(w / 2 / 1000);
  });

  it('a drop back on the tray, or with no tank, shows nothing', () => {
    expect(trayDrop('rowboat', { x: 200, y: 70 }, tray, tank, 1000, true)).toBeNull();
    expect(trayDrop('rowboat', { x: 600, y: 300 }, tray, undefined, 1000, true)).toBeNull();
    expect(trayDrop('rowboat', { x: 200, y: 120 }, tray, tank, 1000, true)).not.toBeNull();
  });
});

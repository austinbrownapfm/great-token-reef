import { describe, expect, it } from 'vitest';
import { BACKDROP_FOR_WATER, DECOR_FOR_FAMILY, ENTRIES } from '@gtr/shared';
import { BACKDROP_ART, DECOR_ART } from '../components/TankDecor';
import type { ReefEvent } from './api';
import {
  BACKDROP_META, DECOR_GAP, DECOR_META, NO_HELD_REWARDS, OPEN_WATER, backdropLayers, decorKey, decorSize, heldRewardsOf, layoutDecor,
  parseDevDecor, releaseHeldReward, rewardKey, setRewardOf, speciesSetOf, visibleRewards,
} from './tankDecor';

const item = (key: string, shown = true, xFrac: number | null = null) => ({ item: key, shown, xFrac });
const KEYS = Object.values(DECOR_FOR_FAMILY);

describe('decor registry', () => {
  it('has 21 distinct decor keys, each with metadata and a renderer', () => {
    expect(new Set(KEYS).size).toBe(21);
    for (const k of KEYS) {
      expect(DECOR_META[k], k).toBeDefined();
      expect(typeof DECOR_ART[k], k).toBe('function');
    }
    expect(Object.keys(DECOR_META).sort()).toEqual([...KEYS].sort());
  });

  it('has every water backdrop plus open water, and art for each earned one', () => {
    for (const k of Object.values(BACKDROP_FOR_WATER)) {
      expect(BACKDROP_META[k], k).toBeDefined();
      expect(typeof BACKDROP_ART[k], k).toBe('function');
    }
    expect(BACKDROP_META[OPEN_WATER]).toBeDefined();
    expect(BACKDROP_ART[OPEN_WATER]).toBeUndefined();
  });

  it('scales decor up in fullscreen and down in a short strip', () => {
    const strip = decorSize('castle', 224, false);
    const full = decorSize('castle', 900, true);
    expect(full.w).toBeGreaterThan(strip.w);
    expect(strip.h / strip.w).toBeCloseTo(DECOR_META.castle!.h / DECOR_META.castle!.w);
  });
});

describe('layoutDecor', () => {
  it('leaves hidden items out', () => {
    const out = layoutDecor([item('rowboat'), item('log', false), item('anchor')], 1000);
    expect(out.map((o) => o.item)).toEqual(['rowboat', 'anchor']);
  });

  it('honours a saved xFrac', () => {
    const out = layoutDecor([item('rowboat', true, 0.25), item('anchor', true, 0.9)], 1200);
    expect(out).toEqual([{ item: 'rowboat', x: 300 }, { item: 'anchor', x: 1080 }]);
  });

  it('gives unsaved items free spots inside the width, at least 60px from each other and from saved ones', () => {
    const decor = [item('rowboat', true, 0.5), ...['log', 'anchor', 'barrel', 'castle', 'buoy'].map((k) => item(k))];
    const out = layoutDecor(decor, 1000);
    expect(out).toHaveLength(6);
    for (const o of out) {
      expect(o.x).toBeGreaterThan(0);
      expect(o.x).toBeLessThan(1000);
    }
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) expect(Math.abs(out[i]!.x - out[j]!.x)).toBeGreaterThanOrEqual(DECOR_GAP);
    }
  });

  it('keeps auto spots off the rocks', () => {
    const rocks = [{ x: 200, w: 100 }, { x: 760, w: 100 }];
    const out = layoutDecor(['log', 'anchor', 'barrel'].map((k) => item(k)), 1000, rocks);
    for (const o of out) for (const r of rocks) expect(Math.abs(o.x - r.x)).toBeGreaterThan(r.w / 2);
  });

  it('is deterministic, and an earlier piece keeps its spot when a new one arrives', () => {
    const a = layoutDecor([item('log'), item('anchor')], 1000);
    const b = layoutDecor([item('log'), item('anchor'), item('castle')], 1000);
    expect(layoutDecor([item('log'), item('anchor')], 1000)).toEqual(a);
    expect(b.slice(0, 2)).toEqual(a);
  });

  it('hiding an unpinned earlier piece never moves a later unpinned one', () => {
    const before = layoutDecor([item('log'), item('anchor'), item('barrel')], 1000);
    const after = layoutDecor([item('log', false), item('anchor'), item('barrel')], 1000);
    expect(after).toEqual(before.filter((p) => p.item !== 'log'));
  });

  it('hiding a pinned piece never moves the others', () => {
    const before = layoutDecor([item('log', true, 0.5), item('anchor'), item('barrel')], 1000);
    const after = layoutDecor([item('log', false, 0.5), item('anchor'), item('barrel')], 1000);
    expect(after).toEqual(before.filter((p) => p.item !== 'log'));
  });

  it('a newly earned piece never moves existing ones, hidden ones included', () => {
    const old = [item('log'), item('anchor', false), item('barrel', true, 0.3)];
    const before = layoutDecor(old, 1000);
    const after = layoutDecor([...old, item('castle')], 1000);
    expect(after.filter((p) => p.item !== 'castle')).toEqual(before);
  });

  it('still places everything inside a tank too narrow for the gap', () => {
    const out = layoutDecor(KEYS.map((k) => item(k)), 600);
    expect(out).toHaveLength(21);
    for (const o of out) {
      expect(o.x).toBeGreaterThanOrEqual(0);
      expect(o.x).toBeLessThanOrEqual(600);
    }
  });

  it('returns nothing for a tank with no width yet', () => {
    expect(layoutDecor([item('log')], 0)).toEqual([]);
  });
});

describe('set rewards', () => {
  const ev = (payload: unknown): ReefEvent => ({ id: 1, kind: 'set', ref: 'family:bass', payload, created_at: 1 });

  it('reads a set event payload', () => {
    const p = { setId: 'family:bass', level: 'family', label: 'Bass & perch', reward: { type: 'decor', item: 'rowboat' } };
    expect(setRewardOf(ev(p))).toEqual(p);
    expect(rewardKey(setRewardOf(ev(p))!)).toBe('decor:rowboat');
  });

  it('keys a decor piece the same way for rewards and for the tank', () => {
    expect(decorKey('rowboat')).toBe('decor:rowboat');
  });

  it('keys badges by their set id and backdrops by item', () => {
    const badge = setRewardOf(ev({ setId: 'species:3', level: 'species', label: 'Bluegill', reward: { type: 'badge' } }))!;
    expect(rewardKey(badge)).toBe('species:3');
    const back = setRewardOf(ev({ setId: 'water:salt', level: 'water', label: 'Saltwater', reward: { type: 'backdrop', item: 'coral-wall' } }))!;
    expect(rewardKey(back)).toBe('backdrop:coral-wall');
  });

  it('rejects malformed payloads', () => {
    expect(setRewardOf(ev(null))).toBeNull();
    expect(setRewardOf(ev({ setId: 'x', reward: { type: 'decor' } }))).toBeNull();
    expect(setRewardOf(ev({ setId: 'x', reward: { type: 'nope' } }))).toBeNull();
  });

  it('maps a catalog entry to its species set id', () => {
    expect(speciesSetOf(0)).toBe(`species:${ENTRIES[0]!.s}`);
    expect(speciesSetOf(9999)).toBeUndefined();
  });
});

describe('parseDevDecor', () => {
  it('accepts all, a list of known keys, and nothing else', () => {
    expect(parseDevDecor('all')).toBe('all');
    expect(parseDevDecor('rowboat,castle')).toBe('rowboat,castle');
    expect(parseDevDecor('rowboat,nope')).toBeUndefined();
    expect(parseDevDecor(undefined)).toBeUndefined();
    expect(parseDevDecor(3)).toBeUndefined();
  });
});

describe('backdropLayers', () => {
  it('shows open water (no layers) until the backdrop is known', () => {
    expect(backdropLayers([], null)).toEqual([]);
  });

  it('lands the first known backdrop without a fade', () => {
    expect(backdropLayers([], 'kelp-forest')).toEqual([{ item: 'kelp-forest', id: 0, fresh: false }]);
  });

  it('fades in only a later, different backdrop', () => {
    const first = backdropLayers([], 'kelp-forest');
    expect(backdropLayers(first, 'kelp-forest')).toBe(first);
    expect(backdropLayers(first, null)).toBe(first);
    expect(backdropLayers(first, 'coral-wall')).toEqual([
      { item: 'kelp-forest', id: 0, fresh: false },
      { item: 'coral-wall', id: 1, fresh: true },
    ]);
  });
});

describe('visibleRewards', () => {
  const rewards = {
    badges: ['species:1', 'species:2'],
    decor: [item('anchor'), item('treasure-chest')],
    backdrops: ['kelp-forest', 'coral-wall'],
    activeBackdrop: 'kelp-forest',
  };

  it('is the rewards as given when nothing is held', () => {
    expect(visibleRewards(rewards, new Set())).toBe(rewards);
  });

  it('leaves out every reward a running release still holds, by its reward key', () => {
    const held = new Set(['species:2', decorKey('anchor'), 'backdrop:coral-wall']);
    expect(visibleRewards(rewards, held)).toEqual({
      badges: ['species:1'],
      decor: [item('treasure-chest')],
      backdrops: ['kelp-forest'],
      activeBackdrop: 'kelp-forest',
    });
  });

  it('a held active backdrop falls back to open water', () => {
    expect(visibleRewards(rewards, new Set(['backdrop:kelp-forest'])).activeBackdrop).toBe(OPEN_WATER);
  });
});

describe('held rewards through a release', () => {
  const ev = (id: number, kind: ReefEvent['kind'], payload: unknown): ReefEvent => ({ id, kind, ref: `${kind}-${id}`, payload, created_at: id });
  const decorSet = ev(1, 'set', { setId: 'family:bass', level: 'family', label: 'Bass', reward: { type: 'decor', item: 'rowboat' } });
  const badgeSet = ev(2, 'set', { setId: 'species:3', level: 'species', label: 'Bluegill', reward: { type: 'badge' } });

  it('holds every readable set reward from the start, and nothing for other events or malformed sets', () => {
    const held = heldRewardsOf([decorSet, badgeSet, ev(3, 'pr', { setId: 'x', reward: { type: 'badge' } }), ev(4, 'set', { setId: 'y' })]);
    expect([...held].sort()).toEqual(['decor:rowboat', 'species:3']);
    expect(heldRewardsOf([ev(3, 'pr', {})])).toBe(NO_HELD_REWARDS);
  });

  it('each reward step lets only its own reward go, ending on the shared empty hold', () => {
    const start = heldRewardsOf([decorSet, badgeSet]);
    const one = releaseHeldReward(start, 'decor:rowboat');
    expect([...one]).toEqual(['species:3']);
    expect([...start].sort()).toEqual(['decor:rowboat', 'species:3']);
    expect(releaseHeldReward(one, 'species:3')).toBe(NO_HELD_REWARDS);
  });
});

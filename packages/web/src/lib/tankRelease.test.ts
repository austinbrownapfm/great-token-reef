import { describe, expect, it } from 'vitest';
import type { ReefCatch, ReefEvent, ReefPending, ReefSpeciesRow } from './api';
import { guestsAfterStep, seedReady } from './tankPicks';
import {
  bannerGlow, fishKey, hiddenCatches, marksAfterRelease, maskCollection, planQueue, planRelease, queueCounts, queueLabel, releaseBatch,
  releaseDetail, releaseGates, releasedRows, queueUnknown, revealForStep, rosterChange, splashFor,
} from './tankRelease';

function row(species: number, count: number, shiny_count = 0, rarity: ReefSpeciesRow['rarity'] = 'common'): ReefSpeciesRow {
  return {
    species, name: `Fish ${species}`, rarity, count, shiny_count,
    best_size: 30, first_caught: 1000, last_caught: 2000, first_project: '/p/my-app', released_best_size: 30,
  };
}

function caught(id: number, species: number, opts: { shiny?: boolean; rarity?: ReefCatch['rarity']; size?: number } = {}): ReefCatch {
  return {
    agent: opts.rarity === 'legendary' ? null : 'claude',
    id, seed: `s#${id}`, session_id: 's', catch_index: id, caught_at: 3000 + id,
    project: '/p/my-app', depth_tokens: 2_000_000, species, name: `Fish ${species}`,
    rarity: opts.rarity ?? 'common', shiny: opts.shiny ? 1 : 0, size: opts.size ?? 42,
  };
}

const none = new Map<string, number>();

const light = (c: ReefCatch): ReefPending['all'][number] => ({ id: c.id, species: c.species, shiny: c.shiny, rarity: c.rarity });

describe('maskCollection', () => {
  it('masks pending catches out of the collection', () => {
    const species = [row(1, 2), row(2, 3, 1, 'rare'), row(3, 1)];
    const pending = [
      light(caught(10, 1)), light(caught(11, 1)),
      light(caught(12, 2, { shiny: true, rarity: 'rare' })),
      // Legendary ordinals share the species number space; they never touch the collection.
      light(caught(13, 3, { rarity: 'legendary' })),
    ];
    const masked = maskCollection(species, pending);
    expect(masked.map((s) => s.species)).toEqual([2, 3]);
    expect(masked[0]).toMatchObject({ species: 2, count: 2, shiny_count: 0 });
    expect(masked[1]).toMatchObject({ species: 3, count: 1 });
    expect(species[0]!.count).toBe(2);
  });
});

describe('maskCollection best size', () => {
  const sized = (species: number, best: number, released: number | null): ReefSpeciesRow =>
    ({ ...row(species, 3), best_size: best, released_best_size: released });

  it('draws a masked species at its released best', () => {
    const masked = maskCollection([sized(1, 55, 42), sized(2, 60, 20)], [light(caught(10, 1))]);
    expect(masked.find((s) => s.species === 1)!.best_size).toBe(42);
    // Nothing of species 2 is held, so its full best stands.
    expect(masked.find((s) => s.species === 2)!.best_size).toBe(60);
  });

  it('falls back to the full best when nothing was released', () => {
    expect(maskCollection([sized(1, 55, null)], [light(caught(10, 1))])[0]!.best_size).toBe(55);
  });

  it('a release-time best wins over the server value for masked species', () => {
    // Mid-release the collection refetches with the new mark, so the server value already counts held catches.
    const masked = maskCollection([sized(1, 55, 55)], [light(caught(10, 1))], new Map([[1, 42]]));
    expect(masked[0]!.best_size).toBe(42);
    expect(maskCollection([sized(1, 55, 55)], [], new Map([[1, 42]]))[0]!.best_size).toBe(55);
  });
});

describe('hiddenCatches', () => {
  it('lists a catch that is both pending and held back once', () => {
    const a = light(caught(5, 1));
    const b = light(caught(6, 2));
    const c = light(caught(7, 3));
    // a is held but already behind the mark; b is pending and held (POST in flight); c is new.
    const hidden = hiddenCatches([b, c], 4, [a, b]);
    expect(hidden.map((h) => h.id).sort()).toEqual([5, 6, 7]);
    expect(hiddenCatches([a, b], 5, [])).toEqual([b]);
  });
});

describe('planRelease', () => {
  it('drops a new species', () => {
    const c = caught(1, 5);
    expect(planRelease([c], 1, new Set(), new Set(), none)).toEqual([{ kind: 'drop', catch: c }]);
  });

  it('drops a first-ever common even with the tank full of rarer fish', () => {
    // The live bug: 29 epic and rare species filled the cap, so a new common only got a banner.
    const swimming = new Set(Array.from({ length: 29 }, (_, i) => `${100 + i}-0`));
    const known = new Set(Array.from({ length: 29 }, (_, i) => 100 + i));
    const c = caught(1, 5);
    expect(planRelease([c], 1, swimming, known, none)).toEqual([{ kind: 'drop', catch: c }]);
  });

  it('banners a repeat of a swimming species', () => {
    const c = caught(1, 5);
    expect(planRelease([c], 1, new Set(['5-0']), new Set([5]), none)).toEqual([{ kind: 'banner', catch: c }]);
  });

  it('upgrades a plain swimmer to shiny', () => {
    const c = caught(1, 5, { shiny: true });
    expect(planRelease([c], 1, new Set(['5-0']), new Set([5]), none)).toEqual([{ kind: 'upgrade', catch: c }]);
  });

  it('banners legendaries', () => {
    const c = caught(1, 0, { rarity: 'legendary' });
    expect(planRelease([c], 1, new Set(), new Set(), none)).toEqual([{ kind: 'banner', catch: c }]);
  });

  it('banners a repeat of a known species that is not picked', () => {
    const c = caught(1, 5);
    expect(planRelease([c], 1, new Set(['6-0']), new Set([5, 6]), none)).toEqual([{ kind: 'banner', catch: c }]);
    // Its first shiny is still a repeat of the catalog entry, so banner too.
    const s = caught(2, 5, { shiny: true });
    expect(planRelease([s], 1, new Set(['6-0']), new Set([5, 6]), none)).toEqual([{ kind: 'banner', catch: s }]);
  });

  it('the second catch of one species in a batch is banner only', () => {
    const first = caught(1, 5);
    const second = caught(2, 5);
    expect(planRelease([second, first], 2, new Set(), new Set(), none)).toEqual([
      { kind: 'drop', catch: first },
      { kind: 'banner', catch: second },
    ]);
    // A plain catch then the first shiny of a new species: the plain drops in, the shiny upgrades it.
    const plain = caught(3, 7);
    const shiny = caught(4, 7, { shiny: true });
    expect(planRelease([shiny, plain], 2, new Set(), new Set(), none).map((s) => s.kind)).toEqual(['drop', 'upgrade']);
  });

  it('caps at the given catches and adds a more step', () => {
    const catches = Array.from({ length: 10 }, (_, i) => caught(14 - i, 100 + i));
    const steps = planRelease(catches, 14, new Set(), new Set(), none);
    expect(steps).toHaveLength(11);
    expect(steps.slice(0, 10).every((s) => s.kind === 'drop')).toBe(true);
    expect(steps[10]).toEqual({ kind: 'more', count: 4 });
  });

  it('orders steps oldest first', () => {
    const catches = [caught(3, 13), caught(2, 12), caught(1, 11)];
    const steps = planRelease(catches, 3, new Set(), new Set(), none);
    expect(steps.map((s) => ('catch' in s ? s.catch.id : -1))).toEqual([1, 2, 3]);
  });

  it('marks a personal best only when the catch beats the previous best', () => {
    const big = caught(1, 5, { size: 51 });
    expect(planRelease([big], 1, new Set(['5-0']), new Set([5]), new Map([['5-0', 42]]))).toEqual([
      { kind: 'banner', catch: big, pb: { from: 42, to: 51 } },
    ]);
    const tie = caught(2, 5, { size: 42 });
    expect(planRelease([tie], 1, new Set(['5-0']), new Set([5]), new Map([['5-0', 42]]))).toEqual([
      { kind: 'banner', catch: tie },
    ]);
    const small = caught(3, 5, { size: 30 });
    expect(planRelease([small], 1, new Set(['5-0']), new Set([5]), new Map([['5-0', 42]]))[0]).not.toHaveProperty('pb');
  });

  it('never marks a personal best without a previous best', () => {
    const c = caught(1, 5, { size: 80 });
    expect(planRelease([c], 1, new Set(), new Set(), none)).toEqual([{ kind: 'drop', catch: c }]);
    const legend = caught(2, 5, { rarity: 'legendary', size: 0 });
    expect(planRelease([legend], 1, new Set(['5-0']), new Set([5]), new Map([['5-0', -1]]))[0]).not.toHaveProperty('pb');
  });

  it('compares against the species best whichever form swims', () => {
    // A plain catch of a species swimming shiny still grows that fish.
    const c = caught(1, 5, { size: 60 });
    expect(planRelease([c], 1, new Set(['5-1']), new Set([5]), new Map([['5-1', 40]]))[0]).toMatchObject({ pb: { from: 40, to: 60 } });
  });

  it('a later catch in the batch must beat the earlier one', () => {
    const first = caught(1, 5, { size: 50 });
    const second = caught(2, 5, { size: 48 });
    const third = caught(3, 5, { size: 55 });
    const steps = planRelease([third, second, first], 3, new Set(['5-0']), new Set([5]), new Map([['5-0', 42]]));
    expect(steps.map((s) => ('pb' in s ? s.pb : undefined))).toEqual([{ from: 42, to: 50 }, undefined, { from: 50, to: 55 }]);
  });
});

function ev(id: number, kind: ReefEvent['kind'], created_at: number, payload: unknown = { title: `E${id}` }): ReefEvent {
  return { id, kind, ref: `${kind}-${id}`, payload, created_at };
}

const stepTime = (s: ReturnType<typeof planQueue>[number]): string =>
  'catch' in s ? `fish${s.catch.id}` : 'event' in s ? `${s.event.kind}${s.event.id}` : 'events' in s ? `batch-${s.eventKind}` : 'more';

describe('planQueue', () => {
  it('folds 12 PRs into one batch and never folds a set', () => {
    const prs = Array.from({ length: 12 }, (_, i) => ev(i + 1, 'pr', 5000 + i));
    const set = ev(13, 'set', 5003, { label: 'Bass set' });
    const steps = planQueue([], 0, [...prs, set], new Set(), new Set(), none);
    expect(steps.map((s) => s.kind)).toEqual(['reward', 'visitorBatch']);
    expect(steps[0]).toEqual({ kind: 'reward', event: set });
    expect(steps[1]).toEqual({ kind: 'visitorBatch', eventKind: 'pr', events: prs });
  });

  it('places a batch at its newest event', () => {
    const tickets = [ev(1, 'ticket', 100), ev(2, 'ticket', 200), ev(3, 'ticket', 300), ev(4, 'ticket', 400)];
    const whale = ev(5, 'whale', 350);
    expect(planQueue([], 0, [...tickets, whale], new Set(), new Set(), none).map(stepTime)).toEqual(['whale5', 'batch-ticket']);
  });

  it('keeps up to three of a kind as their own visitors', () => {
    const prs = [ev(1, 'pr', 100), ev(2, 'pr', 200)];
    expect(planQueue([], 0, prs, new Set(), new Set(), none)).toEqual([
      { kind: 'visitor', event: prs[0] },
      { kind: 'visitor', event: prs[1] },
    ]);
    const three = [ev(1, 'ticket', 1), ev(2, 'ticket', 2), ev(3, 'ticket', 3)];
    expect(planQueue([], 0, three, new Set(), new Set(), none).map((s) => s.kind)).toEqual(['visitor', 'visitor', 'visitor']);
  });

  it('batches each kind on its own count', () => {
    const prs = [ev(1, 'pr', 1), ev(2, 'pr', 2), ev(3, 'pr', 3), ev(4, 'pr', 4)];
    const tickets = [ev(5, 'ticket', 5), ev(6, 'ticket', 6)];
    expect(planQueue([], 0, [...prs, ...tickets], new Set(), new Set(), none).map(stepTime)).toEqual(['batch-pr', 'ticket5', 'ticket6']);
  });

  it('never folds whales, however many', () => {
    const whales = Array.from({ length: 6 }, (_, i) => ev(i + 1, 'whale', 100 + i));
    const steps = planQueue([], 0, whales, new Set(), new Set(), none);
    expect(steps).toHaveLength(6);
    expect(steps.every((s) => s.kind === 'visitor')).toBe(true);
  });

  it('orders fish and events by time, oldest first, with the fish more step last', () => {
    // caught(id) lands at 3000 + id.
    const catches = [caught(9, 12), caught(5, 11)];
    const events = [ev(1, 'pr', 3001), ev(2, 'set', 3007), ev(3, 'whale', 3020)];
    const steps = planQueue(catches, 4, events, new Set(), new Set(), none);
    expect(steps.map(stepTime)).toEqual(['pr1', 'fish5', 'set2', 'fish9', 'whale3', 'more']);
  });

  it('plans fish in the order they play when ids and catch times disagree', () => {
    // A later-ingested catch (higher id) can carry an earlier transcript time.
    const late = { ...caught(9, 5, { size: 50 }), caught_at: 3001 };
    const early = { ...caught(4, 5, { size: 55 }), caught_at: 3004 };
    const pbs = planQueue([late, early], 2, [], new Set(['5-0']), new Set([5]), new Map([['5-0', 42]]));
    expect(pbs.map((s) => ('pb' in s ? s.pb : undefined))).toEqual([{ from: 42, to: 50 }, { from: 50, to: 55 }]);

    const plain = { ...caught(8, 7), caught_at: 3001 };
    const shiny = { ...caught(3, 7, { shiny: true }), caught_at: 3002 };
    const steps = planQueue([plain, shiny], 2, [], new Set(), new Set(), none);
    expect(steps.map((s) => [s.kind, 'catch' in s ? s.catch.id : -1])).toEqual([['drop', 8], ['upgrade', 3]]);
  });

  it('keeps the v3 fish rules', () => {
    const big = caught(1, 5, { size: 51 });
    expect(planQueue([big], 1, [], new Set(['5-0']), new Set([5]), new Map([['5-0', 42]]))).toEqual(
      planRelease([big], 1, new Set(['5-0']), new Set([5]), new Map([['5-0', 42]])),
    );
  });
});

describe('queue labels', () => {
  it('counts fish and each event kind', () => {
    const counts = queueCounts(3, [ev(1, 'pr', 1), ev(2, 'set', 2), ev(3, 'ticket', 3), ev(4, 'ticket', 4)]);
    expect(counts).toEqual({ fish: 3, pr: 1, ticket: 2, whale: 0, set: 1 });
  });

  it('labels per kind in fish, chest, bottle, whale, set order, skipping zeros', () => {
    expect(queueLabel({ fish: 3, pr: 1, ticket: 0, whale: 0, set: 1 })).toBe('🎣 3 · 📦 1 · 🏆 1');
    expect(queueLabel({ fish: 0, pr: 0, ticket: 2, whale: 1, set: 0 })).toBe('🍾 2 · 🐋 1');
    expect(queueLabel({ fish: 0, pr: 0, ticket: 0, whale: 0, set: 0 })).toBe('');
  });

  it('formats release telemetry detail', () => {
    expect(releaseDetail({ fish: 3, pr: 1, ticket: 0, whale: 0, set: 1 }, 'tank')).toBe('fish:3 pr:1 set:1 tank');
    expect(releaseDetail({ fish: 0, pr: 0, ticket: 0, whale: 2, set: 0 }, 'widget')).toBe('whale:2 widget');
  });
});

describe('queueUnknown', () => {
  it('a loading or failed release queue cannot tell released fish from waiting ones', () => {
    expect(queueUnknown({ isPending: true, isError: false })).toBe(true);
    expect(queueUnknown({ isPending: false, isError: true })).toBe(true);
    expect(queueUnknown({ isPending: false, isError: false })).toBe(false);
  });
});

describe('releaseGates', () => {
  const collection = { data: { species: [] }, isError: false, isFetchedAfterMount: true, isFetching: false };
  const pending = { isPending: false, isError: false, isFetchedAfterMount: true, isFetching: false };
  const ok = { collection, pending, width: 800, picksReady: true };

  it('a missing or failed collection blocks both paths, so no catch plays as a first-ever drop', () => {
    for (const c of [{ ...collection, data: undefined }, { ...collection, isError: true }]) {
      expect(releaseGates({ ...ok, collection: c })).toEqual({ dataReady: false, autoStart: false, canRelease: false });
    }
  });

  it('a failed collection never seeds a pick, even with cached data', () => {
    const { dataReady } = releaseGates({ ...ok, collection: { ...collection, isError: true } });
    const seed = { unset: true, alreadySeeded: false, picksError: false, picksFresh: true, queueError: false, releasing: false };
    expect(seedReady({ ...seed, dataReady })).toBe(false);
    expect(seedReady({ ...seed, dataReady: releaseGates(ok).dataReady })).toBe(true);
  });

  it('opens both gates once fresh data, a healthy queue, a width and a settled pick are in', () => {
    expect(releaseGates(ok)).toEqual({ dataReady: true, autoStart: true, canRelease: true });
  });

  it('waits for the pick to settle before either path may release', () => {
    expect(releaseGates({ ...ok, picksReady: false })).toEqual({ dataReady: true, autoStart: false, canRelease: false });
  });

  it('a loading or failed release queue blocks both paths', () => {
    for (const p of [{ ...pending, isPending: true }, { ...pending, isError: true }]) {
      expect(releaseGates({ ...ok, pending: p })).toEqual({ dataReady: false, autoStart: false, canRelease: false });
    }
  });

  it('the widget link also waits out stale or refetching data and an unmeasured tank; the button does not', () => {
    const stale = [
      { ...ok, collection: { ...collection, isFetchedAfterMount: false } },
      { ...ok, collection: { ...collection, isFetching: true } },
      { ...ok, pending: { ...pending, isFetchedAfterMount: false } },
      { ...ok, pending: { ...pending, isFetching: true } },
      { ...ok, width: 0 },
    ];
    for (const s of stale) expect(releaseGates(s)).toEqual({ dataReady: false, autoStart: false, canRelease: true });
  });
});

describe('releaseBatch', () => {
  const ev = (id: number, kind: ReefEvent['kind']): ReefEvent => ({ id, kind, ref: `${kind}-${id}`, payload: {}, created_at: id });
  const c = [caught(5, 1), caught(6, 2), caught(7, 3)];
  const p: ReefPending = { count: 3, releasedId: 4, catches: c, all: c.map(light), events: [ev(10, 'pr'), ev(11, 'set')], eventCount: 2, visitorErrors: [] };

  it('takes only what is past the marks, up to the newest fish and event', () => {
    const b = releaseBatch(p, 5, 10)!;
    expect(b.all.map((a) => a.id)).toEqual([6, 7]);
    expect(b.catches.map((x) => x.id)).toEqual([6, 7]);
    expect(b.events.map((e) => e.id)).toEqual([11]);
    expect(b.maxId).toBe(7);
    expect(b.maxEventId).toBe(11);
  });

  it('with only events waiting, the fish mark stays at the released id and no event id is sent for no events', () => {
    expect(releaseBatch(p, 7, 0)).toMatchObject({ all: [], maxId: 4, maxEventId: 11 });
    expect(releaseBatch({ ...p, events: [] }, 5, 0)).toMatchObject({ maxId: 7, maxEventId: undefined });
  });

  it('is null when nothing waits, including a server that sends no events', () => {
    expect(releaseBatch(p, 7, 11)).toBeNull();
    expect(releaseBatch({ ...p, events: undefined as unknown as ReefEvent[] }, 7, 0)).toBeNull();
  });
});

describe('marksAfterRelease', () => {
  it('never moves a mark backwards from what was sent, what the server says, or where events stood', () => {
    expect(marksAfterRelease({ maxId: 7, maxEventId: 11 }, { releasedId: 5, releasedEventId: 9 }, 3)).toEqual({ mark: 7, eventMark: 11 });
    expect(marksAfterRelease({ maxId: 7, maxEventId: undefined }, { releasedId: 9, releasedEventId: 0 }, 12)).toEqual({ mark: 9, eventMark: 12 });
    expect(marksAfterRelease({ maxId: 7, maxEventId: 11 }, { releasedId: 7, releasedEventId: 15 }, 0)).toEqual({ mark: 7, eventMark: 15 });
  });
});

describe('revealForStep', () => {
  const a = caught(1, 10);
  const b = caught(2, 11);
  const held = [light(a), light(b)];
  const bests = new Map([[10, 30]]);

  it('a drop or an upgrade unmasks its own catch and keeps the bests', () => {
    for (const kind of ['drop', 'upgrade'] as const) {
      const r = revealForStep({ kind, catch: a }, held, bests, new Set([1, 2]))!;
      expect(r.held.map((h) => h.id)).toEqual([2]);
      expect(r.bests).toBe(bests);
    }
  });

  it('a plain banner reveals nothing; a personal-best banner unmasks its catch at the new size', () => {
    expect(revealForStep({ kind: 'banner', catch: a }, held, bests, new Set([1, 2]))).toBeNull();
    const r = revealForStep({ kind: 'banner', catch: a, pb: { from: 30, to: 50 } }, held, bests, new Set([1, 2]))!;
    expect(r.held.map((h) => h.id)).toEqual([2]);
    expect(r.bests.get(10)).toBe(50);
    expect(bests.get(10)).toBe(30);
  });

  it('the "+N more" step unmasks every catch without a step of its own', () => {
    expect(revealForStep({ kind: 'more', count: 1 }, held, bests, new Set([2]))!.held.map((h) => h.id)).toEqual([2]);
  });

  it('visitors and rewards reveal no fish', () => {
    const e: ReefEvent = { id: 1, kind: 'pr', ref: 'pr', payload: {}, created_at: 1 };
    expect(revealForStep({ kind: 'visitor', event: e }, held, bests, new Set())).toBeNull();
    expect(revealForStep({ kind: 'reward', event: { ...e, kind: 'set' } }, held, bests, new Set())).toBeNull();
  });
});

describe('rosterChange', () => {
  it('lists the fish that join and those that leave, by roster key', () => {
    const f = (species: number, shiny = false) => ({ species, shiny });
    const key = (x: { species: number; shiny: boolean }) => fishKey(x.species, x.shiny);
    const { arrivals, departures } = rosterChange([f(1), f(2), f(3)], [f(2), f(3, true), f(4)], key);
    expect(arrivals).toEqual([f(3, true), f(4)]);
    expect(departures).toEqual([f(1), f(3)]);
  });
});

describe('release lifecycle', () => {
  // The hook's fold: plan, then each step's guests and reveal, then the final reveal of everything.
  function run(catches: ReefCatch[], swimming: string[], known: number[]) {
    const all = catches.map(light);
    const steps = planQueue(catches, all.length, [], new Set(swimming), new Set(known), none);
    const shown = new Set(catches.map((c) => c.id));
    let held = all;
    let guests: number[] = [];
    let bests = new Map<number, number>();
    for (const s of steps) {
      guests = guestsAfterStep(s, guests, held, shown, new Set(known));
      const r = revealForStep(s, held, bests, shown);
      if (r) ({ held, bests } = r);
    }
    return { steps, held, guests };
  }

  it('a first-ever catch drops in and swims as a session guest; a known species does not', () => {
    const { steps, held, guests } = run([caught(2, 20), caught(1, 10)], [], [10]);
    expect(steps.map((s) => s.kind)).toEqual(['banner', 'drop']);
    expect(guests).toEqual([20]);
    // The known species' banner had no best, so it stays masked until the release's final reveal.
    expect(held.map((h) => h.id)).toEqual([1]);
  });

  it('a first-ever species that is already swimming is no guest', () => {
    expect(run([caught(1, 20)], [fishKey(20, false)], []).guests).toEqual([]);
  });
});

describe('releasedRows', () => {
  it('is nothing while the queue is unknown, else the collection with the hidden catches masked out', () => {
    const species = [row(1, 1), row(2, 2)];
    const hidden = [light(caught(9, 1))];
    expect(releasedRows(species, hidden, new Map(), true)).toEqual([]);
    expect(releasedRows(species, hidden, new Map(), false).map((r) => r.species)).toEqual([2]);
  });
});

describe('rarity reactions', () => {
  const c = (rarity: ReefCatch['rarity'], shiny = false) => ({ rarity, shiny: shiny ? 1 : 0 });

  it('splashes plainly for common to rare, big for epic and legendary, and sparkles for any shiny', () => {
    for (const r of ['common', 'uncommon', 'rare'] as const) expect(splashFor(c(r))).toEqual({ tone: 'plain', big: false });
    for (const r of ['epic', 'legendary'] as const) expect(splashFor(c(r))).toEqual({ tone: 'epic', big: true });
    for (const r of ['common', 'epic'] as const) expect(splashFor(c(r, true))).toEqual({ tone: 'shiny', big: true });
  });

  it('rings a banner gold for a shiny or a legendary, purple for an epic, faint otherwise', () => {
    expect(bannerGlow(c('legendary'))).toContain('reef-banner-shiny');
    expect(bannerGlow(c('common', true))).toContain('reef-banner-shiny');
    expect(bannerGlow(c('epic'))).toBe('ring-purple-400/60');
    expect(bannerGlow(c('epic', true))).toContain('reef-banner-shiny');
    for (const r of ['common', 'uncommon', 'rare'] as const) expect(bannerGlow(c(r))).toBe('ring-white/15');
  });
});

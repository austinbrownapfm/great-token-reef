import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BACKDROP_FOR_WATER, DECOR_FOR_FAMILY, FISH_SETS, type FishSet } from '@gtr/shared';
import type { AppEnv } from '../app.ts';
import type { Bus } from './bus.ts';
import { fixtureDb } from './fixtures.ts';
import { releaseReef, setReefEpoch } from './reef.ts';
import { ClaudeUsageScanner } from './claudeUsageScanner.ts';
import { checkSetCompletions, reefRewards, setReefBackdrop, setReefDecor } from './reefSets.ts';
import { reef } from '../routes/reef.ts';

vi.mock('./reefLimits.ts', () => ({ refreshOfficialLimits: vi.fn(), getOfficialLimits: vi.fn(() => null) }));

const NOW = Math.floor(Date.now() / 1000);
type Db = ReturnType<typeof fixtureDb>;

let n = 0;
const catchEntries = (db: Db, entries: readonly number[]) => {
  const insert = db.prepare(
    `INSERT INTO cc_catches (seed, session_id, catch_index, caught_at, project, depth_tokens, species, name, rarity)
     VALUES (?, 's', ?, ?, '/p', 1, ?, 'x', 'common')`,
  );
  for (const e of entries) insert.run(`set-seed#${++n}`, n, NOW, e);
};
const setEvents = (db: Db) =>
  db.prepare("SELECT id, ref, payload_json FROM reef_events WHERE kind = 'set' ORDER BY id").all() as
    { id: number; ref: string; payload_json: string }[];
const decorRows = (db: Db) =>
  db.prepare('SELECT item, shown, x_frac, earned_event_id FROM reef_decor ORDER BY item').all() as
    { item: string; shown: number; x_frac: number | null; earned_event_id: number }[];
const maxEventId = (db: Db) =>
  (db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM reef_events').get() as { m: number }).m;

const families = FISH_SETS.filter((s) => s.level === 'family');
const speciesSets = FISH_SETS.filter((s) => s.level === 'species');
const smallestFamily = [...families].sort((a, b) => a.entries.length - b.entries.length)[0]!;
const plan = (set: FishSet) => set.id.slice('family:'.length);
// A species set whose family has other entries, so catching it completes only the species.
const loneSpecies = speciesSets.find((s) => {
  const fam = families.find((f) => f.entries.includes(s.entries[0]!))!;
  return fam.entries.length > s.entries.length;
})!;
const freshWater = FISH_SETS.find((s) => s.id === 'water:fresh')!;

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('checkSetCompletions', () => {
  it('emits one set event and one decor row when a family completes, and nothing on re-run', () => {
    const db = fixtureDb();
    catchEntries(db, smallestFamily.entries);
    expect(checkSetCompletions(db, NOW)).toBeGreaterThan(0);

    const familyEvents = setEvents(db).filter((e) => e.ref === smallestFamily.id);
    expect(familyEvents).toHaveLength(1);
    const item = DECOR_FOR_FAMILY[plan(smallestFamily)]!;
    expect(JSON.parse(familyEvents[0]!.payload_json)).toEqual({
      setId: smallestFamily.id, level: 'family', label: smallestFamily.label, reward: { type: 'decor', item },
    });
    expect(decorRows(db)).toEqual([{ item, shown: 1, x_frac: null, earned_event_id: familyEvents[0]!.id }]);

    const before = setEvents(db).length;
    expect(checkSetCompletions(db, NOW)).toBe(0);
    expect(setEvents(db)).toHaveLength(before);
    expect(decorRows(db)).toHaveLength(1);
  });

  it('emits a badge-only event for a species set and adds no decor', () => {
    const db = fixtureDb();
    catchEntries(db, loneSpecies.entries);
    expect(checkSetCompletions(db, NOW)).toBe(1);
    const events = setEvents(db);
    expect(events.map((e) => e.ref)).toEqual([loneSpecies.id]);
    expect(JSON.parse(events[0]!.payload_json).reward).toEqual({ type: 'badge' });
    expect(decorRows(db)).toEqual([]);
  });

  it('records a backdrop when a whole kind of water completes', () => {
    const db = fixtureDb();
    catchEntries(db, freshWater.entries);
    checkSetCompletions(db, NOW);
    const water = setEvents(db).find((e) => e.ref === 'water:fresh')!;
    expect(JSON.parse(water.payload_json).reward).toEqual({ type: 'backdrop', item: BACKDROP_FOR_WATER.fresh });
    expect(decorRows(db).find((r) => r.item === BACKDROP_FOR_WATER.fresh)?.earned_event_id).toBe(water.id);
  });

  it('ignores legendary catches', () => {
    const db = fixtureDb();
    db.prepare(
      `INSERT INTO cc_catches (seed, session_id, catch_index, caught_at, project, depth_tokens, species, name, rarity)
       VALUES ('legend#0', 'lifetime', 0, ?, '', 1, 1000, 'Tiger Shark', 'legendary')`,
    ).run(NOW);
    catchEntries(db, loneSpecies.entries.slice(1));
    expect(checkSetCompletions(db, NOW)).toBe(0);
  });
});

describe('catch paths', () => {
  it('checks set completions after a scan writes a new catch', () => {
    const db = fixtureDb();
    setReefEpoch(db, NOW - 7 * 86400);
    // Every entry already caught: whatever the new catch rolls, every set is complete.
    catchEntries(db, FISH_SETS.filter((s) => s.level === 'water').flatMap((s) => s.entries));
    const line = JSON.stringify({
      type: 'assistant', requestId: 'r1', sessionId: 'sets-1', timestamp: new Date((NOW - 600) * 1000).toISOString(),
      cwd: '/p', message: { role: 'assistant', model: 'claude-fable-5', usage: { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 3_000_000 } },
    });
    const dir = mkdtempSync(join(tmpdir(), 'reef-sets-'));
    try {
      mkdirSync(join(dir, 'p'));
      writeFileSync(join(dir, 'p', 's.jsonl'), `${line}\n`);
      expect(new ClaudeUsageScanner({ db, dir }).scan().catches).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(setEvents(db)).toHaveLength(FISH_SETS.length);
  });
});

describe('reefRewards', () => {
  it('hides rewards until their set event is released', () => {
    const db = fixtureDb();
    catchEntries(db, [...smallestFamily.entries, ...loneSpecies.entries]);
    checkSetCompletions(db, NOW);
    expect(reefRewards(db)).toEqual({ badges: [], decor: [], backdrops: [], activeBackdrop: 'open-water' });

    releaseReef(db, 0, maxEventId(db));
    const rewards = reefRewards(db);
    expect(rewards.badges).toContain(loneSpecies.id);
    expect(rewards.badges.every((b) => b.startsWith('species:'))).toBe(true);
    expect(rewards.decor).toEqual([{ item: DECOR_FOR_FAMILY[plan(smallestFamily)]!, shown: true, xFrac: null }]);
    expect(rewards.backdrops).toEqual([]);
  });

  it('lists released backdrops apart from decor', () => {
    const db = fixtureDb();
    catchEntries(db, freshWater.entries);
    checkSetCompletions(db, NOW);
    releaseReef(db, 0, maxEventId(db));
    const rewards = reefRewards(db);
    expect(rewards.backdrops).toEqual([BACKDROP_FOR_WATER.fresh]);
    expect(rewards.decor.map((d) => d.item)).not.toContain(BACKDROP_FOR_WATER.fresh);
  });
});

describe('decor and backdrop writes', () => {
  it('updates a released decor piece and refuses unknown or unreleased ones', () => {
    const db = fixtureDb();
    catchEntries(db, smallestFamily.entries);
    checkSetCompletions(db, NOW);
    const item = DECOR_FOR_FAMILY[plan(smallestFamily)]!;
    expect(setReefDecor(db, item, { shown: false })).toBeNull();
    expect(setReefDecor(db, 'not-a-thing', { shown: false })).toBeNull();

    releaseReef(db, 0, maxEventId(db));
    expect(setReefDecor(db, item, { shown: false, xFrac: 0.25 })).toMatchObject({
      changed: true, rewards: { decor: [{ item, shown: false, xFrac: 0.25 }] },
    });
    expect(setReefDecor(db, item, { shown: true })?.rewards.decor).toEqual([{ item, shown: true, xFrac: 0.25 }]);
    expect(setReefDecor(db, item, {})).toMatchObject({ changed: false, rewards: { decor: [{ item, shown: true, xFrac: 0.25 }] } });
  });

  it('accepts open water or a released backdrop only', () => {
    const db = fixtureDb();
    catchEntries(db, freshWater.entries);
    checkSetCompletions(db, NOW);
    expect(setReefBackdrop(db, BACKDROP_FOR_WATER.fresh)).toBeNull();
    expect(setReefBackdrop(db, 'coral-wall')).toBeNull();

    releaseReef(db, 0, maxEventId(db));
    expect(setReefBackdrop(db, BACKDROP_FOR_WATER.fresh)?.activeBackdrop).toBe(BACKDROP_FOR_WATER.fresh);
    expect(setReefBackdrop(db, 'open-water')?.activeBackdrop).toBe('open-water');
  });
});

describe('reward routes', () => {
  const app = (db: Db, bus: Bus) => {
    const routes = new Hono<AppEnv>();
    routes.use('*', async (c, next) => {
      c.set('db', db);
      c.set('bus', bus);
      await next();
    });
    return routes.route('/reef', reef);
  };
  const put = (body: unknown) => ({ method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('serves rewards and validates decor and backdrop writes', async () => {
    const db = fixtureDb();
    const bus = { emit: vi.fn() } as unknown as Bus;
    catchEntries(db, [...smallestFamily.entries, ...freshWater.entries]);
    checkSetCompletions(db, NOW);
    const item = DECOR_FOR_FAMILY[plan(smallestFamily)]!;
    const a = app(db, bus);

    expect(await (await a.request('/reef/rewards')).json()).toEqual({ badges: [], decor: [], backdrops: [], activeBackdrop: 'open-water' });
    expect((await a.request(`/reef/decor/${item}`, put({ shown: false }))).status).toBe(404);
    expect((await a.request('/reef/backdrop', put({ backdrop: 'river-rock' }))).status).toBe(400);
    expect(bus.emit).not.toHaveBeenCalled();

    releaseReef(db, 0, maxEventId(db));
    expect((await a.request('/reef/decor/not-a-thing', put({ shown: false }))).status).toBe(404);
    expect((await a.request(`/reef/decor/${item}`, put({ xFrac: 2 }))).status).toBe(400);
    const decor = await a.request(`/reef/decor/${item}`, put({ xFrac: 0.5 }));
    expect(decor.status).toBe(200);
    expect(((await decor.json()) as { decor: unknown[] }).decor).toContainEqual({ item, shown: true, xFrac: 0.5 });
    const backdrop = await a.request('/reef/backdrop', put({ backdrop: 'river-rock' }));
    expect(((await backdrop.json()) as { activeBackdrop: string }).activeBackdrop).toBe('river-rock');
    expect(bus.emit).toHaveBeenCalledTimes(2);
    expect(bus.emit).toHaveBeenCalledWith('reef');
  });

  it('an empty decor body changes nothing and does not broadcast', async () => {
    const db = fixtureDb();
    const bus = { emit: vi.fn() } as unknown as Bus;
    catchEntries(db, smallestFamily.entries);
    checkSetCompletions(db, NOW);
    releaseReef(db, 0, maxEventId(db));
    const item = DECOR_FOR_FAMILY[plan(smallestFamily)]!;
    const res = await app(db, bus).request(`/reef/decor/${item}`, put({}));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { decor: unknown[] }).decor).toContainEqual({ item, shown: true, xFrac: null });
    expect(bus.emit).not.toHaveBeenCalled();
  });
});

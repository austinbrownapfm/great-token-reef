import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../app.ts';
import type { Bus } from './bus.ts';
import { fixtureDb } from './fixtures.ts';
import { getReleasedCatchId, releaseReef } from './reef.ts';
import { FISH_CAPS, reefFishPicks, setReefFishPick } from './reefFish.ts';
import { reef } from '../routes/reef.ts';

vi.mock('./reefLimits.ts', () => ({ refreshOfficialLimits: vi.fn(), getOfficialLimits: vi.fn(() => null) }));

const NOW = Math.floor(Date.now() / 1000);
type Db = ReturnType<typeof fixtureDb>;

let n = 0;
const addCatch = (db: Db, species: number, rarity = 'common') =>
  db.prepare(
    `INSERT INTO cc_catches (seed, session_id, catch_index, caught_at, project, depth_tokens, species, name, rarity)
     VALUES (?, 's', ?, ?, '/p', 1, ?, 'x', ?)`,
  ).run(`fish-seed#${++n}`, n, NOW, species, rarity);
const releaseAll = (db: Db) => {
  const max = (db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM cc_catches').get() as { m: number }).m;
  releaseReef(db, max);
};
const seeded = (species: number[]) => {
  const db = fixtureDb();
  for (const s of species) addCatch(db, s);
  releaseAll(db);
  return db;
};

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('fish picks', () => {
  it('reports null for missing rows', () => {
    expect(reefFishPicks(fixtureDb())).toEqual({ strip: null, full: null });
  });

  it('round-trips a valid pick in order, per view', () => {
    const db = seeded([5, 2, 9]);
    expect(setReefFishPick(db, 'strip', [9, 2, 5])).toEqual([9, 2, 5]);
    expect(reefFishPicks(db)).toEqual({ strip: [9, 2, 5], full: null });
    expect(setReefFishPick(db, 'full', [])).toEqual([]);
    expect(reefFishPicks(db)).toEqual({ strip: [9, 2, 5], full: [] });
  });

  it('rejects duplicates, non-integers, and over-cap picks', () => {
    const many = Array.from({ length: FISH_CAPS.strip + 1 }, (_, i) => i);
    const db = seeded(many);
    expect(setReefFishPick(db, 'strip', [1, 1])).toHaveProperty('error');
    expect(setReefFishPick(db, 'strip', [1.5])).toHaveProperty('error');
    expect(setReefFishPick(db, 'strip', many)).toHaveProperty('error');
    expect(setReefFishPick(db, 'full', many)).toEqual(many);
    expect(reefFishPicks(db).strip).toBeNull();
  });

  it('rejects species with only unreleased or legendary catches', () => {
    const db = fixtureDb();
    addCatch(db, 3);
    addCatch(db, 4, 'legendary');
    releaseAll(db);
    addCatch(db, 7);
    expect(getReleasedCatchId(db)).toBeLessThan(
      (db.prepare('SELECT MAX(id) AS m FROM cc_catches').get() as { m: number }).m,
    );
    expect(setReefFishPick(db, 'strip', [7])).toHaveProperty('error');
    expect(setReefFishPick(db, 'strip', [4])).toHaveProperty('error');
    expect(setReefFishPick(db, 'strip', [3])).toEqual([3]);
  });

  it('logs the write', () => {
    const db = seeded([1]);
    setReefFishPick(db, 'full', [1]);
    expect(console.log).toHaveBeenCalledWith('[reef] fish pick full (1)');
  });
});

describe('corrupt fish pick', () => {
  const corrupt = (db: Db) =>
    db.prepare("INSERT INTO settings (key, value) VALUES ('fishStrip', 'not json')").run();

  it('throws and logs instead of reading as unseeded', () => {
    const db = fixtureDb();
    corrupt(db);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => reefFishPicks(db)).toThrow();
    expect(err).toHaveBeenCalledWith('[reef] corrupt fish pick fishStrip: not json');
  });

  it.each([
    ['duplicates', '[1,1]'],
    ['non-integers', '[1.5]'],
    ['over cap', JSON.stringify(Array.from({ length: FISH_CAPS.strip + 1 }, (_, i) => i))],
    ['a non-array', '{"a":1}'],
  ])('treats stored %s as corrupt', (_label, value) => {
    const db = fixtureDb();
    db.prepare("INSERT INTO settings (key, value) VALUES ('fishStrip', ?)").run(value);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => reefFishPicks(db)).toThrow();
    expect(err).toHaveBeenCalledWith(`[reef] corrupt fish pick fishStrip: ${value.slice(0, 80)}`);
  });

  it('a PUT to one view while the other row is corrupt 500s and writes nothing', async () => {
    const db = seeded([2]);
    corrupt(db);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const bus = { emit: vi.fn() } as unknown as Bus;
    const routes = new Hono<AppEnv>();
    routes.use('*', async (c, next) => {
      c.set('db', db);
      c.set('bus', bus);
      await next();
    });
    routes.route('/reef', reef);
    const res = await routes.request('/reef/fish/full', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ species: [2] }),
    });
    expect(res.status).toBe(500);
    expect(db.prepare("SELECT value FROM settings WHERE key = 'fishFull'").get()).toBeUndefined();
    expect(bus.emit).not.toHaveBeenCalled();
  });

  it('GET 500s and a valid PUT replaces the row', async () => {
    const db = seeded([2]);
    corrupt(db);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const routes = new Hono<AppEnv>();
    routes.use('*', async (c, next) => {
      c.set('db', db);
      await next();
    });
    routes.route('/reef', reef);
    expect((await routes.request('/reef/fish')).status).toBe(500);
    const res = await routes.request('/reef/fish/strip', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ species: [2] }),
    });
    expect(res.status).toBe(200);
    expect(reefFishPicks(db)).toEqual({ strip: [2], full: null });
  });
});

describe('fish pick routes', () => {
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

  it('validates, 404s unknown views, and emits reef only on success', async () => {
    const db = seeded([2, 3]);
    const bus = { emit: vi.fn() } as unknown as Bus;
    const a = app(db, bus);

    expect(await (await a.request('/reef/fish')).json()).toEqual({ strip: null, full: null });
    expect((await a.request('/reef/fish/side', put({ species: [2] }))).status).toBe(404);
    expect((await a.request('/reef/fish/strip', put({ nope: 1 }))).status).toBe(400);
    expect((await a.request('/reef/fish/strip', put({ species: [2, 2] }))).status).toBe(400);
    expect((await a.request('/reef/fish/strip', put({ species: [99] }))).status).toBe(400);
    expect(bus.emit).not.toHaveBeenCalled();

    const ok = await a.request('/reef/fish/strip', put({ species: [3, 2] }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ strip: [3, 2], full: null });
    expect(bus.emit).toHaveBeenCalledTimes(1);
    expect(bus.emit).toHaveBeenCalledWith('reef');
  });
});

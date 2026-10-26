import { describe, expect, it } from 'vitest';
import { fixtureDb } from './fixtures.ts';
import { reefCollection, reefPending, reefSummary, releaseReef } from './reef.ts';

// Reef read models: burn baseline and the release mark. Scanner-driven tests
// live in claudeUsageScanner.spec.ts.

const NOW = Math.floor(Date.now() / 1000);

describe('burn baseline', () => {
  const addUsage = (db: ReturnType<typeof fixtureDb>, id: string, ts: number, tokens: number) =>
    db.prepare(
      `INSERT INTO cc_usage (request_id, ts, session_id, project, model, output_tokens)
       VALUES (?, ?, 's', '/p', 'claude-fable-5', ?)`,
    ).run(id, ts, tokens);

  it('burn baseline averages over active minutes only', () => {
    const db = fixtureDb();
    const base = Math.floor((NOW - 86400) / 60) * 60;
    addUsage(db, 'a', base, 100);
    addUsage(db, 'b', base + 30, 100);
    addUsage(db, 'c', base + 120, 200);
    addUsage(db, 'd', base + 3600, 200);
    const s = reefSummary(db, 'all');
    expect(s.burn.tokensPerActiveMin7d).toBe(200);
    expect(s.burn.tokensPerMin7d).toBe(Math.round(600 / 10080));
    expect(s.claudeQuota.burn.tokensPerActiveMin7d).toBe(200);
  });

  it('is 0 with no usage', () => {
    const s = reefSummary(fixtureDb(), 'all');
    expect(s.burn.tokensPerActiveMin7d).toBe(0);
    expect(s.claudeQuota.burn.tokensPerActiveMin7d).toBe(0);
  });
});

describe('release mark', () => {
  let n = 0;
  const addCatch = (db: ReturnType<typeof fixtureDb>) => {
    n++;
    db.prepare(
      `INSERT INTO cc_catches (seed, session_id, catch_index, caught_at, project, depth_tokens, species, name, rarity)
       VALUES (?, 's', ?, ?, '/p', 1, 0, 'x', 'common')`,
    ).run(`seed#${n}`, n, NOW);
  };
  const addCatches = (db: ReturnType<typeof fixtureDb>, k: number) => { for (let i = 0; i < k; i++) addCatch(db); };
  const maxId = (db: ReturnType<typeof fixtureDb>) =>
    (db.prepare('SELECT MAX(id) AS m FROM cc_catches').get() as { m: number }).m;

  it('a catch landing before any pending read is still pending on a fresh database', () => {
    const db = fixtureDb();
    addCatch(db);
    const p = reefPending(db);
    expect(p.count).toBe(1);
    expect(p.releasedId).toBe(0);
  });

  it('seeds to 0 on an empty collection', () => {
    const p = reefPending(fixtureDb());
    expect(p.count).toBe(0);
    expect(p.releasedId).toBe(0);
  });

  it('reports catches above the mark', () => {
    const db = fixtureDb();
    addCatches(db, 3);
    releaseReef(db, maxId(db));
    addCatches(db, 12);
    const p = reefPending(db);
    expect(p.count).toBe(12);
    expect(p.catches).toHaveLength(10);
    expect(p.catches[0]!.id).toBe(maxId(db));
    expect(p.all).toHaveLength(12);
    expect(p.all.map((c) => c.id)).toEqual([...p.all.map((c) => c.id)].sort((a, b) => a - b));
  });

  it('release never moves backwards and clamps to max', () => {
    const db = fixtureDb();
    addCatches(db, 2);
    releaseReef(db, maxId(db));
    addCatches(db, 3);
    const max = maxId(db);
    expect(releaseReef(db, max + 50).releasedId).toBe(max);
    expect(releaseReef(db, max - 2).releasedId).toBe(max);
    expect(reefPending(db).releasedId).toBe(max);
  });

  it('a catch landing after release stays pending', () => {
    const db = fixtureDb();
    addCatches(db, 2);
    releaseReef(db, maxId(db));
    addCatches(db, 2);
    releaseReef(db, maxId(db));
    expect(reefPending(db).count).toBe(0);
    addCatch(db);
    expect(reefPending(db).count).toBe(1);
  });

  it('released best size ignores pending catches until they are released', () => {
    const db = fixtureDb();
    const sized = (size: number) => {
      addCatch(db);
      db.prepare('UPDATE cc_catches SET size = ? WHERE id = ?').run(size, maxId(db));
    };
    sized(30);
    releaseReef(db, maxId(db));
    sized(55);
    const best = () => reefCollection(db).species[0] as { best_size: number; released_best_size: number | null };
    expect(best()).toMatchObject({ best_size: 55, released_best_size: 30 });
    releaseReef(db, maxId(db));
    expect(best()).toMatchObject({ best_size: 55, released_best_size: 55 });
  });

  it('released best size is null when nothing of the species is released', () => {
    const db = fixtureDb();
    reefPending(db);
    addCatch(db);
    expect(reefCollection(db).species[0]).toMatchObject({ released_best_size: null });
  });

  it('summary carries the pending count', () => {
    const db = fixtureDb();
    addCatches(db, 1);
    releaseReef(db, maxId(db));
    expect(reefSummary(db).pending).toBe(0);
    addCatches(db, 2);
    expect(reefSummary(db).pending).toBe(2);
  });
});

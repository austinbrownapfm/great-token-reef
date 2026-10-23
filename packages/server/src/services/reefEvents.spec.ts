import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../app.ts';
import { reef } from '../routes/reef.ts';
import type { Bus } from './bus.ts';
import { fixtureDb } from './fixtures.ts';
import { emitReefEvent, getReleasedEventId, pendingEvents } from './reefEvents.ts';
import { getReleasedCatchId, reefPending, reefSummary, releaseReef } from './reef.ts';

vi.mock('./reefLimits.ts', () => ({ refreshOfficialLimits: vi.fn(), getOfficialLimits: vi.fn(() => null) }));

const NOW = Math.floor(Date.now() / 1000);
type Db = ReturnType<typeof fixtureDb>;

let n = 0;
const addCatch = (db: Db) => {
  n++;
  db.prepare(
    `INSERT INTO cc_catches (seed, session_id, catch_index, caught_at, project, depth_tokens, species, name, rarity)
     VALUES (?, 's', ?, ?, '/p', 1, 0, 'x', 'common')`,
  ).run(`ev-seed#${n}`, n, NOW);
};
const maxEventId = (db: Db) =>
  (db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM reef_events').get() as { m: number }).m;

afterEach(() => vi.restoreAllMocks());

describe('reef events', () => {
  it('inserts a (kind, ref) once and logs only the insert', () => {
    const db = fixtureDb();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const id = emitReefEvent(db, 'pr', 'org/repo#1', { title: 'A' }, NOW);
    expect(id).toBeTypeOf('number');
    expect(emitReefEvent(db, 'pr', 'org/repo#1', { title: 'B' }, NOW)).toBeNull();
    expect(emitReefEvent(db, 'ticket', 'org/repo#1', { title: 'C' }, NOW)).toBeTypeOf('number');
    expect((db.prepare('SELECT COUNT(*) AS n FROM reef_events').get() as { n: number }).n).toBe(2);
    expect(log.mock.calls.filter((c) => String(c[0]).includes('[reef] event pr org/repo#1'))).toHaveLength(1);
  });

  it('rejects an unknown kind at the table', () => {
    const db = fixtureDb();
    expect(() => db.prepare(
      "INSERT INTO reef_events (kind, ref, payload_json, created_at) VALUES ('fish', 'x', '{}', 0)",
    ).run()).toThrow();
  });

  it('rejects an invalid kind passed through emit instead of ignoring it', () => {
    const db = fixtureDb();
    expect(() => emitReefEvent(db, 'fish' as 'pr', 'x', {}, NOW)).toThrow();
  });

  it('an event emitted before any read stays pending', () => {
    const db = fixtureDb();
    emitReefEvent(db, 'pr', 'boot', {}, NOW);
    expect(pendingEvents(db).map((r) => r.ref)).toEqual(['boot']);
  });

  it('a bad stored payload logs and still fails loudly', () => {
    const db = fixtureDb();
    getReleasedEventId(db);
    db.prepare("INSERT INTO reef_events (kind, ref, payload_json, created_at) VALUES ('pr', 'bad', '{nope', 0)").run();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => pendingEvents(db)).toThrow();
    expect(err.mock.calls.some((c) => String(c[0]).startsWith('[reef] bad event payload id='))).toBe(true);
  });

  it('seeds the mark to the current max on first read and logs it', () => {
    const db = fixtureDb();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const insert = db.prepare("INSERT INTO reef_events (kind, ref, payload_json, created_at) VALUES (?, ?, '{}', 0)");
    insert.run('whale', 'w1');
    insert.run('set', 's1');
    expect(getReleasedEventId(db)).toBe(maxEventId(db));
    expect(log.mock.calls.some((c) => String(c[0]).includes('[reef] seeded released event mark'))).toBe(true);
    expect(pendingEvents(db)).toEqual([]);
  });

  it('seeds to 0 on an empty table', () => {
    expect(getReleasedEventId(fixtureDb())).toBe(0);
  });

  it('lists events past the mark oldest first with parsed payloads', () => {
    const db = fixtureDb();
    getReleasedEventId(db);
    emitReefEvent(db, 'pr', 'p1', { title: 'First' }, NOW);
    emitReefEvent(db, 'ticket', 't1', { title: 'Second' }, NOW + 1);
    const rows = pendingEvents(db);
    expect(rows.map((r) => r.ref)).toEqual(['p1', 't1']);
    expect(rows[0]).toMatchObject({ kind: 'pr', payload: { title: 'First' }, created_at: NOW });
    expect(rows[0]!.id).toBeLessThan(rows[1]!.id);
  });

  it('release is forward-only and clamped to the max', () => {
    const db = fixtureDb();
    getReleasedEventId(db);
    emitReefEvent(db, 'pr', 'p1', {}, NOW);
    emitReefEvent(db, 'pr', 'p2', {}, NOW);
    const max = maxEventId(db);
    expect(releaseReef(db, 0, max + 50).releasedEventId).toBe(max);
    expect(releaseReef(db, 0, max - 1).releasedEventId).toBe(max);
    expect(getReleasedEventId(db)).toBe(max);
    emitReefEvent(db, 'pr', 'p3', {}, NOW);
    expect(pendingEvents(db).map((r) => r.ref)).toEqual(['p3']);
  });
});

describe('reefPending and summary with events', () => {
  it('reefPending includes events past the mark', () => {
    const db = fixtureDb();
    reefPending(db);
    emitReefEvent(db, 'set', 'bass', { set: 'bass' }, NOW);
    const p = reefPending(db);
    expect(p.eventCount).toBe(1);
    expect(p.events.map((e) => e.ref)).toEqual(['bass']);
  });

  it('summary pending counts catches plus events', () => {
    const db = fixtureDb();
    reefSummary(db);
    addCatch(db);
    addCatch(db);
    emitReefEvent(db, 'pr', 'p1', {}, NOW);
    expect(reefSummary(db).pending).toBe(3);
  });

  it('releaseReef moves both marks and leaves events alone without upToEventId', () => {
    const db = fixtureDb();
    reefPending(db);
    addCatch(db);
    emitReefEvent(db, 'pr', 'p1', {}, NOW);
    const catchMax = (db.prepare('SELECT MAX(id) AS m FROM cc_catches').get() as { m: number }).m;
    expect(releaseReef(db, catchMax)).toEqual({ releasedId: catchMax, releasedEventId: 0 });
    expect(reefPending(db).eventCount).toBe(1);
    expect(releaseReef(db, catchMax, maxEventId(db))).toEqual({ releasedId: catchMax, releasedEventId: maxEventId(db) });
    expect(reefSummary(db).pending).toBe(0);
  });
});

describe('release atomicity', () => {
  it('a failing event release leaves the catch mark where it was', () => {
    const db = fixtureDb();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    reefPending(db);
    addCatch(db);
    const catchMax = (db.prepare('SELECT MAX(id) AS m FROM cc_catches').get() as { m: number }).m;
    db.exec('DROP TABLE reef_events');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => releaseReef(db, catchMax, 1)).toThrow();
    expect(getReleasedCatchId(db)).toBe(0);
    expect(err.mock.calls.some((c) => String(c[0]).startsWith('[reef] release failed'))).toBe(true);
    expect((console.log as unknown as ReturnType<typeof vi.fn>).mock.calls.some((c) => String(c[0]).includes('released catches up to'))).toBe(false);
  });

  it('a failing rollback still logs and rethrows the original error', () => {
    const real = fixtureDb();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    reefPending(real);
    addCatch(real);
    real.exec('DROP TABLE reef_events');
    const db = new Proxy(real, {
      get(target, prop) {
        if (prop === 'exec') {
          return (sql: string) => {
            if (sql.startsWith('ROLLBACK TO')) throw new Error('rollback broke');
            return target.exec(sql);
          };
        }
        const value = Reflect.get(target, prop) as unknown;
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => releaseReef(db, 1, 1)).toThrow(/reef_events/);
    expect(err.mock.calls.some((c) => String(c[0]).startsWith('[reef] release failed') && String(c[0]).includes('reef_events'))).toBe(true);
  });
});

describe('visitor errors', () => {
  it('a corrupt stored row logs and shows a synthetic entry instead of failing pending', () => {
    const db = fixtureDb();
    db.prepare("INSERT INTO settings (key, value) VALUES ('visitorError_jira', '{nope')").run();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(reefPending(db).visitorErrors).toEqual([{ source: 'jira', message: 'corrupt stored visitor error', at: 0 }]);
    expect(err).toHaveBeenCalledWith('[reef] corrupt visitor error visitorError_jira: {nope');
  });
});

describe('pending and release routes', () => {
  const app = (db: Db, bus: Bus) => {
    const routes = new Hono<AppEnv>();
    routes.use('*', async (c, next) => {
      c.set('db', db);
      c.set('bus', bus);
      await next();
    });
    return routes.route('/reef', reef);
  };
  const post = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  type Pending = { count: number; releasedId: number; eventCount: number; events: { ref: string }[] };

  it('GET /pending lists held catches and events', async () => {
    const db = fixtureDb();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    reefPending(db);
    addCatch(db);
    emitReefEvent(db, 'pr', 'p1', { title: 'A' }, NOW);
    const res = await app(db, { emit: vi.fn() } as unknown as Bus).request('/reef/pending');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Pending;
    expect(body).toMatchObject({ count: 1, releasedId: 0, eventCount: 1 });
    expect(body.events.map((e) => e.ref)).toEqual(['p1']);
  });

  it('POST /release moves both marks and broadcasts', async () => {
    const db = fixtureDb();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const bus = { emit: vi.fn() } as unknown as Bus;
    reefPending(db);
    addCatch(db);
    emitReefEvent(db, 'pr', 'p1', {}, NOW);
    const catchMax = (db.prepare('SELECT MAX(id) AS m FROM cc_catches').get() as { m: number }).m;
    const res = await app(db, bus).request('/reef/release', post({ upToId: catchMax, upToEventId: maxEventId(db) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ releasedId: catchMax, releasedEventId: maxEventId(db) });
    expect(reefPending(db)).toMatchObject({ count: 0, eventCount: 0 });
    expect(bus.emit).toHaveBeenCalledWith('reef');
  });

  it('an events-only release leaves held catches pending', async () => {
    const db = fixtureDb();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const bus = { emit: vi.fn() } as unknown as Bus;
    reefPending(db);
    addCatch(db);
    emitReefEvent(db, 'ticket', 't1', {}, NOW);
    const res = await app(db, bus).request('/reef/release', post({ upToId: 0, upToEventId: maxEventId(db) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ releasedId: 0, releasedEventId: maxEventId(db) });
    const after = (await (await app(db, bus).request('/reef/pending')).json()) as Pending;
    expect(after).toMatchObject({ count: 1, releasedId: 0, eventCount: 0, events: [] });
  });

  it('POST /release rejects a bad body without moving a mark', async () => {
    const db = fixtureDb();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const bus = { emit: vi.fn() } as unknown as Bus;
    reefPending(db);
    addCatch(db);
    expect((await app(db, bus).request('/reef/release', post({ upToEventId: 1 }))).status).toBe(400);
    expect(getReleasedCatchId(db)).toBe(0);
    expect(bus.emit).not.toHaveBeenCalled();
  });
});

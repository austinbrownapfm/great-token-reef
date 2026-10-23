import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FISH_SETS } from '@gtr/shared';
import type { Db } from '../store/db.ts';
import { fixtureDb } from './fixtures.ts';
import {
  ReefScanner, getCodexRewardEpoch, reefCatchesByDate, reefCollection, reefModels, reefProjects, reefSessions,
  reefSummary, reefTrend, setReefEpoch, storeCodexBatch,
} from './reef.ts';
import type { CodexSessionRow, CodexUsageRow } from './reefTypes.ts';

const now = Math.floor(Date.now() / 1000);
const databases: Db[] = [];
const dirs: string[] = [];
const freshDb = () => {
  const db = fixtureDb();
  databases.push(db);
  setReefEpoch(db, now - 86400);
  // Codex rewards stay off until a test activates them, as on a first run.
  db.prepare("DELETE FROM settings WHERE key = 'codexRewardEpoch'").run();
  return db;
};
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const usage = (over: Partial<CodexUsageRow> = {}): CodexUsageRow => ({
  requestId: 'codex:event-1', ts: now, sessionId: 'codex:session-1',
  project: '/project', model: 'gpt-test', input: 100, output: 50, cacheRead: 25,
  reasoningOutput: 30, cacheWriteInput: 10, cost: null, ...over,
});
const session = (over: Partial<CodexSessionRow> = {}): CodexSessionRow => ({
  sessionId: 'codex:session-1', nativeId: 'session-1', parentSessionId: null,
  project: '/project', ts: now, label: 'Codex task', modelProvider: 'openai', source: 'local', ...over,
});
const claude = (db: Db, tokens: number, ts = now - 1, id = 'claude-request') => {
  const dir = mkdtempSync(join(tmpdir(), 'reef-tracking-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'p'));
  writeFileSync(join(dir, 'p', `${id}.jsonl`), `${JSON.stringify({
    type: 'assistant', requestId: id, sessionId: `session-${id}`, cwd: '/project',
    timestamp: new Date(ts * 1000).toISOString(),
    message: { model: 'claude-fable-5', usage: { input_tokens: tokens, output_tokens: 0 } },
  })}\n`);
  new ReefScanner({ db, dir }).scan();
};
const activate = (db: Db, epoch = now) => {
  db.prepare("INSERT INTO settings (key, value) VALUES ('codexRewardEpoch', ?)")
    .run(String(epoch));
};
const catches = (db: Db) => db.prepare('SELECT * FROM cc_catches ORDER BY id').all();

describe('Codex usage on the shared Reef', () => {
  it('leaves activation unset on summary reads and persists the first enabled start', () => {
    const db = freshDb();
    reefSummary(db, 'all');
    expect(db.prepare("SELECT value FROM settings WHERE key = 'codexRewardEpoch'").get()).toBeUndefined();
    const epoch = getCodexRewardEpoch(db);
    expect(epoch).toBeGreaterThanOrEqual(now);
    expect(getCodexRewardEpoch(db)).toBe(epoch);
  });

  it('keeps Claude quotas and forecasts unchanged while selecting either agent or their sum', () => {
    const db = freshDb();
    claude(db, 1_000);
    const before = reefSummary(db);
    storeCodexBatch(db, [usage()], [session()], () => {});
    const onlyClaude = reefSummary(db);
    const onlyCodex = reefSummary(db, 'codex');
    const all = reefSummary(db, 'all');
    expect(onlyClaude.lifetime.tokens).toBe(before.lifetime.tokens);
    expect(onlyClaude.lifetime.cost).toBe(before.lifetime.cost);
    for (const summary of [onlyClaude, onlyCodex, all]) {
      expect(summary.claudeQuota).toEqual({
        window5h: before.window5h, week: before.claudeQuota.week,
        burn: before.claudeQuota.burn, official: before.official,
      });
      expect(summary.window5h).toEqual(before.window5h);
    }
    // Reasoning/cache-write diagnostics are subsets, never extra total tokens.
    expect(onlyCodex.lifetime.tokens).toBe(175);
    expect(all.lifetime.tokens).toBe(1_175);
    expect(onlyCodex.lifetime.cost).toBe(0);
    expect(onlyCodex.unpricedEvents).toBe(1);
    for (const field of ['today', 'week', 'burn', 'lifetime'] as const) {
      expect(onlyCodex[field].unpricedEvents).toBe(1);
      expect(onlyClaude[field].unpricedEvents).toBe(0);
    }
    expect(all.rewards.tokens).toBe(1_000);
    expect(reefTrend(db, 7, 'all')).toHaveLength(2);
    expect(reefTrend(db, 7)).toHaveLength(1);
    expect(reefModels(db, 7, 'codex')).toMatchObject([{ agent: 'codex', calls: 1, input: 100, output: 50, cache_read: 25, unpricedEvents: 1 }]);
    expect(reefProjects(db, 7, 'all')).toMatchObject([{ project: '/project', tokens: 1_175, sessions: 2, unpricedEvents: 1 }]);
    expect(reefSessions(db, 7, 20, 'codex')).toMatchObject([{ agent: 'codex', label: 'Codex task', native_id: 'session-1', tokens: 175, unpricedEvents: 1 }]);
    expect(reefSessions(db, 7)).toHaveLength(1);
  });

  it('rolls back usage, labels and checkpoint when any batch step fails', () => {
    const db = freshDb();
    activate(db);
    expect(() => storeCodexBatch(db, [usage({ input: 3_000_000 })], [session()], () => {
      db.prepare('INSERT INTO codex_files (path, bytes_read) VALUES (?, ?)').run('rollout.jsonl', 123);
      throw new Error('checkpoint failure');
    })).toThrow('checkpoint failure');
    for (const table of ['cc_usage', 'cc_sessions', 'cc_catches', 'codex_files']) {
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
    }
    expect(storeCodexBatch(db, [usage({ input: 3_000_000 })], [session()], () => {}).catches).toBe(1);
  });

  it('rolls back checkpoint and earlier awards if the catch engine fails', () => {
    const db = freshDb();
    activate(db);
    db.exec(`CREATE TRIGGER reject_second_catch BEFORE INSERT ON cc_catches
      WHEN NEW.catch_index = 1 BEGIN SELECT RAISE(ABORT, 'catch failure'); END`);
    expect(() => storeCodexBatch(db, [usage({ input: 9_000_000 })], [session()], () => {
      db.prepare('INSERT INTO codex_files (path, bytes_read) VALUES (?, ?)').run('rollout.jsonl', 123);
    })).toThrow('catch failure');
    for (const table of ['cc_usage', 'cc_sessions', 'cc_catches', 'codex_files']) {
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
    }
  });

  it('commits a batch\'s catches when the set completion check fails, and logs the failure', () => {
    const db = freshDb();
    activate(db);
    const family = FISH_SETS.find((s) => s.level === 'family')!;
    const seed = db.prepare(`INSERT INTO cc_catches (seed, session_id, catch_index, caught_at, project, depth_tokens, species, name, rarity)
      VALUES (?, 'seeded', ?, ?, '/p', 1, ?, 'x', 'common')`);
    family.entries.forEach((e, i) => seed.run(`seeded#${i}`, i, now - 10, e));
    db.exec(`CREATE TRIGGER reject_sets BEFORE INSERT ON reef_events
      WHEN NEW.kind = 'set' BEGIN SELECT RAISE(ABORT, 'set failure'); END`);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(storeCodexBatch(db, [usage({ input: 3_000_000 })], [session()], () => {}).catches).toBe(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM cc_catches WHERE session_id = 'codex:session-1'").get()).toEqual({ n: 1 });
    expect(error).toHaveBeenCalledWith(expect.stringContaining('[reef] set completion check failed: set failure'));
    error.mockRestore();
  });

  it('deduplicates replayed usage and rewards while still advancing checkpoints', () => {
    const db = freshDb();
    activate(db);
    const rows = [usage({ input: 3_000_000, cost: 5 })];
    expect(storeCodexBatch(db, rows, [session()], () => {})).toEqual({ messages: 1, catches: 1 });
    const original = catches(db);
    let advanced = false;
    expect(storeCodexBatch(db, rows, [session()], () => { advanced = true; })).toEqual({ messages: 0, catches: 0 });
    expect(advanced).toBe(true);
    expect(catches(db)).toEqual(original);
    expect(reefSummary(db, 'codex').lifetime).toMatchObject({ tokens: 3_000_075, cost: 5, unpricedEvents: 0 });
  });

  it('excludes historical Codex tokens before the ordinary ladders', () => {
    const db = freshDb();
    // Both Codex samples lie in the same five-minute bucket, around activation.
    const epoch = Math.floor(now / 300) * 300 + 120;
    activate(db, epoch);
    claude(db, 98_500_000, epoch - 600);
    const oldCatches = catches(db);
    const history = usage({ requestId: 'codex:history', ts: epoch - 1, input: 500_000_000, output: 0, cacheRead: 0 });
    expect(storeCodexBatch(db, [history], [session()], () => {}).catches).toBe(0);
    expect(catches(db)).toEqual(oldCatches);
    expect(reefSessions(db, 7, 20, 'codex')).toMatchObject([{ tokens: 500_000_000, rewardTokens: 0 }]);
    const live = usage({ requestId: 'codex:live-1', ts: epoch, input: 1_000_000, output: 0, cacheRead: 0 });
    expect(storeCodexBatch(db, [live], [], () => {}).catches).toBe(0);
    expect(reefSummary(db, 'all').rewards.tokens).toBe(99_500_000);
    expect(reefSessions(db, 7, 20, 'codex')).toMatchObject([{ tokens: 501_000_000, rewardTokens: 1_000_000 }]);
    expect(reefSessions(db, 7)).toMatchObject([{ tokens: 98_500_000, rewardTokens: 98_500_000 }]);
    expect(reefSummary(db, 'codex').lifetime.tokens).toBe(501_000_000);
    expect(storeCodexBatch(db, [usage({ ...live, requestId: 'codex:live-2', ts: epoch + 1 })], [], () => {}).catches).toBe(1);
    expect(db.prepare("SELECT seed FROM cc_catches WHERE session_id = 'codex:session-1'").all())
      .toEqual([{ seed: 'codex:session-1#0' }]);
    expect(storeCodexBatch(db, [history], [], () => {}).catches).toBe(0);
    expect(catches(db).slice(0, oldCatches.length)).toEqual(oldCatches);
  });

  it('derives ordinary catch agents and without changing stored rows', () => {
    const db = freshDb();
    claude(db, 3_000_000, now);
    expect(reefSummary(db).lastCatch?.agent).toBe('claude');
    activate(db);
    storeCodexBatch(db, [usage({ input: 3_000_000, ts: now + 1 })], [session()], () => {});
    expect(reefSummary(db, 'all').rewards.lastCatch?.agent).toBe('codex');
    const stored = catches(db);
    const collection = reefCollection(db);
    expect(collection.recent.filter((row) => row.session_id.startsWith('codex:')))
      .toMatchObject([{ agent: 'codex' }]);
    const date = db.prepare("SELECT date(?, 'unixepoch', 'localtime') AS day").get(now) as { day: string };
    const daily = reefCatchesByDate(db, { date: date.day }).catches;
    expect(daily.map((row) => row.agent)).toContain('claude');
    expect(daily.map((row) => row.agent)).toContain('codex');
    expect(collection.species.every((row) => !('agent' in row))).toBe(true);
    expect(catches(db)).toEqual(stored);
  });

  it('returns latest observed Codex limit telemetry without altering Claude official limits', () => {
    const db = freshDb();
    const snapshot = { observedAt: now, source: 'local', limitId: 'codex', primary: null, secondary: null, unlimited: false, plan: 'pro' };
    db.prepare('INSERT INTO codex_limits VALUES (?, ?, ?)').run('local', now, JSON.stringify(snapshot));
    db.prepare('INSERT INTO codex_limits VALUES (?, ?, ?)').run('sbx', now - 1, JSON.stringify({ ...snapshot, source: 'sbx' }));
    expect(reefSummary(db, 'codex').codexLimits).toEqual(snapshot);
    expect(reefSummary(db, 'codex').official).toBeNull();
  });
});

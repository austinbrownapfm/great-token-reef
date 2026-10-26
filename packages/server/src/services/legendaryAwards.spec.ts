import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FISH_SETS } from '@gtr/shared';
import type { Db } from '../store/db.ts';
import { fixtureDb } from './fixtures.ts';
import { reefCollection } from './reefCollection.ts';
import { releaseReef } from './reefRelease.ts';
import { setReefEpoch } from './reefState.ts';
import { reefSummary } from './reefStats.ts';
import { storeCodexBatch } from './usageStore.ts';
import { ClaudeUsageScanner } from './claudeUsageScanner.ts';
import { setSetting } from './settings.ts';
import { awardLegendaries, ladderTokens } from './legendaryAwards.ts';
import { setReefFishPick } from './reefFish.ts';
import { checkSetCompletions } from './reefSets.ts';

vi.mock('./reefLimits.ts', () => ({ refreshOfficialLimits: vi.fn(), getOfficialLimits: vi.fn(() => null) }));

const NOW = Math.floor(Date.now() / 1000);
const EPOCH = NOW - 30 * 86400;
const dirs: string[] = [];
const databases: Db[] = [];

const freshDb = () => {
  const db = fixtureDb();
  databases.push(db);
  setReefEpoch(db, EPOCH);
  return db;
};
const claudeUsage = (db: Db, id: string, tokens: number, ts: number) => {
  const dir = mkdtempSync(join(tmpdir(), 'legendary-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'p'));
  writeFileSync(join(dir, 'p', `${id}.jsonl`), `${JSON.stringify({
    type: 'assistant', requestId: id, sessionId: `s-${id}`, cwd: '/p',
    timestamp: new Date(ts * 1000).toISOString(),
    message: { model: 'claude-fable-5', usage: { input_tokens: tokens, output_tokens: 0 } },
  })}\n`);
  new ClaudeUsageScanner({ db, dir }).scan();
};
const codexUsage = (db: Db, id: string, tokens: number, ts: number) => {
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('codexRewardEpoch', ?)").run(String(EPOCH));
  storeCodexBatch(db, [{
    requestId: `codex:${id}`, ts, sessionId: `codex:${id}`, project: '/p', model: 'gpt-test',
    input: tokens, output: 0, cacheRead: 0, reasoningOutput: 0, cacheWriteInput: 0, cost: null,
  }], [], () => {});
};
const legendaries = (db: Db) =>
  db.prepare("SELECT * FROM cc_catches WHERE rarity = 'legendary' ORDER BY depth_tokens, shiny").all() as
    { seed: string; species: number; name: string; caught_at: number; shiny: number; session_id: string; size: number }[];

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) db.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('legendary ladder', () => {
  it('ignores usage from before the epoch but keeps it in the totals', () => {
    const db = freshDb();
    claudeUsage(db, 'old', 5_000_000_000, EPOCH - 3600);
    expect(awardLegendaries(db)).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM cc_catches').get()).toEqual({ n: 0 });
    expect(reefSummary(db, 'all').lifetime.tokens).toBe(5_000_000_000);
    expect(ladderTokens(db)).toBe(0);
  });

  it('awards Tiger Shark in the bucket where 100M was crossed', () => {
    const db = freshDb();
    const ts = NOW - 7200;
    claudeUsage(db, 'a', 60_000_000, ts - 3600);
    claudeUsage(db, 'b', 90_000_000, ts);
    expect(legendaries(db)).toMatchObject([
      { seed: 'legend#0', species: 1000, name: 'Tiger Shark', shiny: 0, session_id: 'lifetime', size: 400,
        caught_at: Math.floor(ts / 300) * 300 },
    ]);
  });

  it('counts Claude and Codex tokens together', () => {
    const db = freshDb();
    claudeUsage(db, 'a', 60_000_000, NOW - 3600);
    codexUsage(db, 'x', 60_000_000, NOW - 1800);
    expect(legendaries(db)).toMatchObject([{ name: 'Tiger Shark', species: 1000 }]);
    expect(legendaries(db)[0]!.caught_at).toBe(Math.floor((NOW - 1800) / 300) * 300);
  });

  it('ignores Codex tokens from before the Codex reward epoch', () => {
    const db = freshDb();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('codexRewardEpoch', ?)").run(String(NOW - 1800));
    const batch = (id: string, ts: number) => storeCodexBatch(db, [{
      requestId: `codex:${id}`, ts, sessionId: `codex:${id}`, project: '/p', model: 'gpt-test',
      input: 150_000_000, output: 0, cacheRead: 0, reasoningOutput: 0, cacheWriteInput: 0, cost: null,
    }], [], () => {});
    batch('history', NOW - 3600);
    expect(legendaries(db)).toHaveLength(0);
    expect(ladderTokens(db)).toBe(0);
    batch('live', NOW - 60);
    expect(legendaries(db)).toMatchObject([{ name: 'Tiger Shark' }]);
  });

  it('starts the ladder at ladderOffsetTokens', () => {
    const db = freshDb();
    setSetting(db, 'ladderOffsetTokens', '6900000000');
    claudeUsage(db, 'a', 200_000_000, NOW - 3600);
    const rows = legendaries(db);
    expect(rows).toHaveLength(7);
    expect(rows.filter((r) => r.shiny === 1)).toHaveLength(0);
  });

  it('awards no shiny with the second legendary, and the first shiny only past the last regular', () => {
    const db = freshDb();
    claudeUsage(db, 'a', 200_000_000, NOW - 3600);
    expect(legendaries(db).map((r) => r.seed)).toEqual(['legend#0', 'legend#1']);

    const past = freshDb();
    setSetting(past, 'ladderOffsetTokens', '204800000000');
    claudeUsage(past, 'b', 200_000_000, NOW - 3600);
    const rows = legendaries(past);
    expect(rows.filter((r) => r.shiny === 0)).toHaveLength(12);
    expect(rows.filter((r) => r.shiny === 1).map((r) => r.seed)).toEqual(['legend-shiny#0']);
  });

  it('adds no rows on a rescan', () => {
    const db = freshDb();
    claudeUsage(db, 'a', 150_000_000, NOW - 3600);
    expect(awardLegendaries(db)).toBe(0);
    expect(legendaries(db)).toHaveLength(1);
  });

  it('reports ladder tokens, not lifetime tokens, as rewards.tokens', () => {
    const db = freshDb();
    claudeUsage(db, 'old', 5_000_000_000, EPOCH - 3600);
    claudeUsage(db, 'new', 150_000_000, NOW - 3600);
    expect(reefSummary(db, 'all').rewards.tokens).toBe(150_000_000);
  });

  it('lists legendaries in the collection with their names', () => {
    const db = freshDb();
    claudeUsage(db, 'a', 150_000_000, NOW - 3600);
    expect(reefCollection(db).legendary).toMatchObject([{ species: 1000, name: 'Tiger Shark', shiny: 0 }]);
  });

  it('lets a released legendary be picked for the tank', () => {
    const db = freshDb();
    claudeUsage(db, 'a', 150_000_000, NOW - 3600);
    const max = (db.prepare('SELECT MAX(id) AS m FROM cc_catches').get() as { m: number }).m;
    releaseReef(db, max);
    expect(setReefFishPick(db, 'full', [1000])).toEqual([1000]);
  });

  it('leaves set completions unchanged by legendary rows', () => {
    const db = freshDb();
    const set = FISH_SETS.find((s) => s.level === 'species')!;
    const seed = db.prepare(`INSERT INTO cc_catches (seed, session_id, catch_index, caught_at, project, depth_tokens, species, name, rarity)
      VALUES (?, 's', ?, ?, '/p', 1, ?, 'x', 'common')`);
    set.entries.slice(0, -1).forEach((e, i) => seed.run(`c#${i}`, i, NOW, e));
    const before = checkSetCompletions(db, NOW);
    db.prepare(`INSERT INTO cc_catches (seed, session_id, catch_index, caught_at, project, depth_tokens, species, name, rarity)
      VALUES ('legend#0', 'lifetime', 0, ?, '', 1, ?, 'Tiger Shark', 'legendary')`).run(NOW, set.entries.at(-1)!);
    expect(checkSetCompletions(db, NOW)).toBe(before);
  });
});

describe('catch log prefix', () => {
  it('logs Codex catches with [codex] and Claude catches with [reef]', () => {
    const db = freshDb();
    const log = vi.mocked(console.log);
    codexUsage(db, 'cx', 2_000_000, NOW - 600);
    expect(log.mock.calls.some((c) => String(c[0]).startsWith('[codex] 🎣 caught'))).toBe(true);
    claudeUsage(db, 'cl', 2_000_000, NOW - 600);
    expect(log.mock.calls.some((c) => String(c[0]).startsWith('[reef] 🎣 caught'))).toBe(true);
  });
});

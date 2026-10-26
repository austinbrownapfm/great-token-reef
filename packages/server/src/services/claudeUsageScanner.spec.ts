import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { catchesEarned, rollCatch, speciesName } from '@gtr/shared';
import { fixtureDb } from './fixtures.ts';
import { estimateCcCost } from './pricing.ts';
import { ClaudeUsageScanner } from './claudeUsageScanner.ts';
import { reefCollection } from './reefCollection.ts';
import { getReefBudgets, setReefBudgets, setReefEpoch } from './reefState.ts';
import { reefSessions, reefSummary } from './reefStats.ts';
import { repriceClaudeUsage } from './usageStore.ts';

// The Reef: incremental JSONL scanner + deterministic catch engine.
// Fixture files mirror the real Claude Code transcript line shapes
// (verified against a live transcript 2026-08-18).

const NOW = Math.floor(Date.now() / 1000);
const iso = (ts: number) => new Date(ts * 1000).toISOString();

// Fish are forward-only. Fixture messages are timestamped minutes ago, so
// catch tests move the epoch back a week; the no-retro test pins it to NOW.
function freshDb() {
  const db = fixtureDb();
  setReefEpoch(db, NOW - 7 * 86400);
  return db;
}

function assistantLine(over: {
  requestId: string;
  sessionId?: string;
  ts?: number;
  model?: string;
  input?: number;
  output?: number;
  cacheRead?: number;
  cache5m?: number;
  cache1h?: number;
  legacyCacheOnly?: boolean;
}): string {
  const usage: Record<string, unknown> = {
    input_tokens: over.input ?? 10,
    output_tokens: over.output ?? 100,
    cache_read_input_tokens: over.cacheRead ?? 0,
  };
  if (over.legacyCacheOnly) {
    usage.cache_creation_input_tokens = over.cache5m ?? 0;
  } else {
    usage.cache_creation = {
      ephemeral_5m_input_tokens: over.cache5m ?? 0,
      ephemeral_1h_input_tokens: over.cache1h ?? 0,
    };
  }
  return `${JSON.stringify({
    type: 'assistant',
    requestId: over.requestId,
    sessionId: over.sessionId ?? 'sess-1',
    timestamp: iso(over.ts ?? NOW - 600),
    cwd: '/home/dev/reef-demo',
    message: { role: 'assistant', model: over.model ?? 'claude-fable-5', usage },
  })}\n`;
}

function userLine(text: string, sessionId = 'sess-1', ts = NOW - 601): string {
  return `${JSON.stringify({
    type: 'user',
    sessionId,
    timestamp: iso(ts),
    cwd: '/home/dev/reef-demo',
    message: { role: 'user', content: text },
  })}\n`;
}

describe('reef scanner', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'reef-'));
    mkdirSync(join(dir, 'proj'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const file = () => join(dir, 'proj', 'session.jsonl');

  it('parses assistant usage with correct cache-aware cost', () => {
    const db = freshDb();
    writeFileSync(
      file(),
      userLine('fix the login bug') +
        assistantLine({ requestId: 'r1', input: 2, output: 860, cacheRead: 22467, cache5m: 0, cache1h: 26101 }),
    );
    const result = new ClaudeUsageScanner({ db, dir }).scan();
    expect(result).toMatchObject({ files: 1, messages: 1 });

    const row = db.prepare('SELECT * FROM cc_usage').get() as Record<string, number | string>;
    expect(row.session_id).toBe('sess-1');
    expect(row.project).toBe('/home/dev/reef-demo');
    expect(row.cache_read_tokens).toBe(22467);
    expect(row.cache_w1h_tokens).toBe(26101);
    // fable 5: in $10/M, out $50/M; read 0.1×, 1h write 2×
    const expected = (2 * 10 + 860 * 50 + 22467 * 10 * 0.1 + 26101 * 10 * 2) / 1e6;
    expect(row.cost).toBeCloseTo(expected, 6);
    expect(estimateCcCost('claude-fable-5', { input: 2, output: 860, cacheRead: 22467, cacheW5m: 0, cacheW1h: 26101 })).toBeCloseTo(expected, 6);

    const sess = db.prepare('SELECT label FROM cc_sessions').get() as { label: string };
    expect(sess.label).toBe('fix the login bug');
  });

  it('scans project folders whose names start with -sbx', () => {
    const db = freshDb();
    mkdirSync(join(dir, '-sbx-abc'));
    writeFileSync(join(dir, '-sbx-abc', 's1.jsonl'), userLine('sandboxed') + assistantLine({ requestId: 'sbx-r1' }));
    expect(new ClaudeUsageScanner({ db, dir }).scan()).toMatchObject({ files: 1, messages: 1 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM cc_usage').get()).toEqual({ n: 1 });
  });

  it('scanning a missing directory warns once, throws nothing, and leaves a valid summary', () => {
    const db = freshDb();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const scanner = new ClaudeUsageScanner({ db, dir: join(dir, 'does-not-exist') });
    expect(scanner.scan()).toEqual({ files: 0, messages: 0, catches: 0 });
    expect(scanner.scan()).toEqual({ files: 0, messages: 0, catches: 0 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(reefSummary(db)).toMatchObject({ lifetime: { tokens: 0, catches: 0 }, pending: 0 });
    warn.mockRestore();
  });

  describe('ai titles', () => {
    const titleLine = (title: string, sessionId = 'sess-1') =>
      `${JSON.stringify({ type: 'ai-title', aiTitle: title, sessionId })}\n`;
    const sessionLabel = (db: ReturnType<typeof freshDb>) =>
      (reefSessions(db, 7) as { label: string }[])[0]?.label;

    it('shows the first prompt until a title arrives, then prefers the ai title', () => {
      const db = freshDb();
      writeFileSync(file(), userLine('hi there') + assistantLine({ requestId: 'r1' }));
      new ClaudeUsageScanner({ db, dir }).scan();
      expect(sessionLabel(db)).toBe('hi there');

      appendFileSync(file(), titleLine('Reef page session boxes'));
      new ClaudeUsageScanner({ db, dir }).scan();
      expect(sessionLabel(db)).toBe('Reef page session boxes');
    });

    it('labels a child session from its parent, and a row-less session from folder + date', () => {
      const db = freshDb();
      writeFileSync(
        file(),
        userLine('parent prompt') +
          assistantLine({ requestId: 'r1' }) +
          assistantLine({ requestId: 'r2', sessionId: 'child' }) +
          assistantLine({ requestId: 'r3', sessionId: 'orphan' }),
      );
      new ClaudeUsageScanner({ db, dir }).scan();
      db.prepare(
        "INSERT INTO cc_sessions (session_id, project, first_ts, label, parent_session_id) VALUES ('child', '', ?, '', 'sess-1')",
      ).run(NOW);
      const labels = Object.fromEntries(
        (reefSessions(db, 7) as { session_id: string; label: string }[]).map((r) => [r.session_id, r.label]),
      );
      expect(labels.child).toBe('↳ parent prompt');
      expect(labels.orphan).toBe(`reef-demo · ${iso(NOW - 600).slice(0, 10)}`);
    });
  });

  describe('pricing from the Anthropic price sheet', () => {
    const tok = { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheW5m: 1_000_000, cacheW1h: 1_000_000 };

    it('prices point releases with their own rates and cache-read multipliers', () => {
      // opus 5.5: in 4, out 20, read 0.05×, 5m 1.25×, 1h 2×
      expect(estimateCcCost('claude-opus-5-5', tok)).toBeCloseTo(4 + 20 + 0.2 + 5 + 8, 6);
      // fable 5.1: in 10, out 50, read 0.025×
      expect(estimateCcCost('claude-fable-5-1', tok)).toBeCloseTo(10 + 50 + 0.25 + 12.5 + 20, 6);
      expect(estimateCcCost('claude-sonnet-5-5', tok)).toBeCloseTo(2 + 10 + 0.1 + 2.5 + 4, 6);
    });

    it('uses the long-prompt tier for haiku 5.5 over 100k prompt tokens', () => {
      const small = { input: 50_000, output: 1_000_000, cacheRead: 0, cacheW5m: 0, cacheW1h: 0 };
      const big = { ...small, input: 150_000 };
      expect(estimateCcCost('claude-haiku-5-5', small)).toBeCloseTo((50_000 * 0.1) / 1e6 + 0.5, 6);
      expect(estimateCcCost('claude-haiku-5-5', big)).toBeCloseTo((150_000 * 0.5) / 1e6 + 2.5, 6);
    });

    it('returns null for a model not on the table and 0 for <synthetic>', () => {
      expect(estimateCcCost('claude-future-9', tok)).toBeNull();
      expect(estimateCcCost('<synthetic>', tok)).toBe(0);
    });

    it('marks unknown-model rows cost_known=0, then heals them once re-priced', () => {
      const db = freshDb();
      db.prepare(
        `INSERT INTO cc_usage (request_id, ts, session_id, project, model, input_tokens, output_tokens, cost, cost_known)
         VALUES ('old', ?, 's', 'p', 'claude-opus-5-5', 1000000, 1000000, 0, 1),
                ('unk', ?, 's', 'p', 'claude-future-9', 1000000, 0, 0, 1)`,
      ).run(NOW, NOW);
      expect(repriceClaudeUsage(db)).toBe(2);
      const rows = db.prepare('SELECT request_id, cost, cost_known FROM cc_usage ORDER BY request_id').all() as
        { request_id: string; cost: number; cost_known: number }[];
      expect(rows[0]).toMatchObject({ request_id: 'old', cost_known: 1 });
      expect(rows[0]?.cost).toBeCloseTo(24, 6);
      expect(rows[1]).toMatchObject({ request_id: 'unk', cost: 0, cost_known: 0 });
      // unchanged table → no second pass
      expect(repriceClaudeUsage(db)).toBe(0);
    });
  });

  it('treats the legacy flat cache_creation_input_tokens as 5m writes', () => {
    const db = freshDb();
    writeFileSync(file(), assistantLine({ requestId: 'r1', cache5m: 5000, legacyCacheOnly: true }));
    new ClaudeUsageScanner({ db, dir }).scan();
    const row = db.prepare('SELECT cache_w5m_tokens, cache_w1h_tokens FROM cc_usage').get() as Record<string, number>;
    expect(row.cache_w5m_tokens).toBe(5000);
    expect(row.cache_w1h_tokens).toBe(0);
  });

  it('is incremental: only appended complete lines are parsed, partial lines wait', () => {
    const db = freshDb();
    const scanner = new ClaudeUsageScanner({ db, dir });
    writeFileSync(file(), assistantLine({ requestId: 'r1' }));
    expect(scanner.scan().messages).toBe(1);
    expect(scanner.scan()).toMatchObject({ files: 0, messages: 0 }); // nothing new

    // Torn write: no trailing newline → not consumed yet.
    const line2 = assistantLine({ requestId: 'r2' });
    appendFileSync(file(), line2.slice(0, 40));
    expect(scanner.scan().messages).toBe(0);
    appendFileSync(file(), line2.slice(40));
    expect(scanner.scan().messages).toBe(1);
    expect((db.prepare('SELECT COUNT(*) AS n FROM cc_usage').get() as { n: number }).n).toBe(2);
  });

  describe('forked sessions', () => {
    // `claude --resume <id> --fork-session` copies the parent's lines verbatim
    // under the fork's sessionId (reproduced on Claude Code 2.1.310).
    const history = (sessionId: string) => {
      let content = '';
      for (let i = 0; i < 3; i++) content += assistantLine({ requestId: `r${i}`, sessionId, ts: NOW - 600 + i, cacheRead: 900_000 });
      return content;
    };
    const ownerOf = (db: ReturnType<typeof freshDb>) =>
      Object.fromEntries((db.prepare('SELECT request_id, session_id FROM cc_usage ORDER BY request_id').all() as
        { request_id: string; session_id: string }[]).map((r) => [r.request_id, r.session_id]));
    const catches = (db: ReturnType<typeof freshDb>) =>
      db.prepare('SELECT session_id, COUNT(*) AS n FROM cc_catches GROUP BY session_id ORDER BY session_id').all();

    it('keeps copied history with the parent and earns the fork nothing for it', () => {
      const db = freshDb();
      const scanner = new ClaudeUsageScanner({ db, dir });
      writeFileSync(join(dir, 'proj', 'parent.jsonl'), history('parent'));
      expect(scanner.scan().catches).toBe(1);

      writeFileSync(join(dir, 'proj', 'fork.jsonl'),
        history('fork') + assistantLine({ requestId: 'f1', sessionId: 'fork', ts: NOW - 500, cacheRead: 100_000 }));
      expect(scanner.scan()).toMatchObject({ messages: 1, catches: 0 });
      expect(ownerOf(db)).toEqual({ f1: 'fork', r0: 'parent', r1: 'parent', r2: 'parent' });
      expect(catches(db)).toEqual([{ session_id: 'parent', n: 1 }]);
    });

    it('awards the shared history once when a rebuild finds both files together', () => {
      const db = freshDb();
      writeFileSync(join(dir, 'proj', 'a.jsonl'), history('sess-a'));
      writeFileSync(join(dir, 'proj', 'b.jsonl'), history('sess-b'));
      new ClaudeUsageScanner({ db, dir }).scan();
      expect(new Set(Object.values(ownerOf(db))).size).toBe(1);
      expect(db.prepare('SELECT COUNT(*) AS n FROM cc_catches').get()).toEqual({ n: 1 });
    });
  });

  it('dedupes by requestId across re-emits and rewritten files', () => {
    const db = freshDb();
    const scanner = new ClaudeUsageScanner({ db, dir });
    writeFileSync(file(), assistantLine({ requestId: 'r1', output: 100 }) + assistantLine({ requestId: 'r1', output: 100 }));
    scanner.scan();
    // Rewritten SHORTER file (fork/compaction) → size < bytes_read → rescan
    // from 0; the request_id upsert keeps it one row, last write wins.
    writeFileSync(file(), assistantLine({ requestId: 'r1', output: 999 }));
    scanner.scan();
    const rows = db.prepare('SELECT output_tokens FROM cc_usage').all() as { output_tokens: number }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.output_tokens).toBe(999);
  });

  it('awards deterministic catches at depth milestones (2M, 8M, …)', () => {
    const db = freshDb();
    // 3 messages × 900k cache-read ≈ 2.7M → crosses 2M once.
    let content = '';
    for (let i = 0; i < 3; i++) {
      content += assistantLine({ requestId: `r${i}`, ts: NOW - 600 + i, cacheRead: 900_000 });
    }
    writeFileSync(file(), content);
    expect(new ClaudeUsageScanner({ db, dir }).scan().catches).toBe(1);

    const c = db.prepare('SELECT * FROM cc_catches').get() as Record<string, string | number>;
    expect(c.seed).toBe('sess-1#0');
    expect(c.depth_tokens).toBe(2_000_000);
    const expected = rollCatch('sess-1#0', 0);
    expect(c.name).toBe(expected.name);
    expect(c.name).toBe(speciesName(expected.species));
    expect(c.rarity).toBe(expected.rarity);

    // Deepen to 8M+ → exactly one more catch, and a rescan-from-scratch on a
    // fresh DB reproduces the identical fish (rebuildable collection).
    for (let i = 3; i < 9; i++) {
      appendFileSync(file(), assistantLine({ requestId: `r${i}`, ts: NOW - 590 + i, cacheRead: 900_000 }));
    }
    expect(new ClaudeUsageScanner({ db, dir }).scan().catches).toBe(1);
    expect(catchesEarned(9 * 900_000)).toBe(2);

    const db2 = freshDb();
    new ClaudeUsageScanner({ db: db2, dir }).scan();
    const names = (d: typeof db) =>
      (d.prepare('SELECT name FROM cc_catches ORDER BY catch_index').all() as { name: string }[]).map((r) => r.name);
    expect(names(db2)).toEqual(names(db));
  });

  it('a newly caught 128M-deep fish emits one whale visitor; a 32M catch does not', () => {
    const db = freshDb();
    let batch = userLine('deep dive session', 'whale-1') + userLine('shallow session', 'small-1');
    for (let i = 0; i < 5; i++) {
      batch += assistantLine({ requestId: `w${i}`, sessionId: 'whale-1', ts: NOW - 600 + i, cacheRead: 30_000_000 });
    }
    for (let i = 0; i < 2; i++) {
      batch += assistantLine({ requestId: `s${i}`, sessionId: 'small-1', ts: NOW - 500 + i, cacheRead: 20_000_000 });
    }
    writeFileSync(file(), batch);
    new ClaudeUsageScanner({ db, dir }).scan();
    const whales = () => db.prepare(`SELECT ref, payload_json, created_at FROM reef_events WHERE kind = 'whale'`)
      .all() as { ref: string; payload_json: string; created_at: number }[];
    expect(whales()).toHaveLength(1);
    expect(whales()[0]!.ref).toBe('whale-1#3');
    expect(JSON.parse(whales()[0]!.payload_json)).toEqual({ sessionId: 'whale-1', label: 'deep dive session', depthTokens: 128_000_000 });
    expect(whales()[0]!.created_at).toBeLessThan(1e11);
    // Rescanning an unchanged file inserts no new catch, so no second whale.
    new ClaudeUsageScanner({ db, dir }).scan();
    expect(whales()).toHaveLength(1);
  });

  it('rolls a failed award back with its usage, then retries it on a pass with no new bytes', () => {
    const db = freshDb();
    let batch = userLine('deep dive session', 'whale-1');
    for (let i = 0; i < 5; i++) {
      batch += assistantLine({ requestId: `w${i}`, sessionId: 'whale-1', ts: NOW - 600 + i, cacheRead: 30_000_000 });
    }
    writeFileSync(file(), batch);
    db.exec(`CREATE TRIGGER reject_whale BEFORE INSERT ON reef_events
      WHEN NEW.kind = 'whale' BEGIN SELECT RAISE(ABORT, 'whale failure'); END`);
    const whaleCatch = () => db.prepare("SELECT COUNT(*) AS n FROM cc_catches WHERE seed = 'whale-1#3'").get();
    const scanner = new ClaudeUsageScanner({ db, dir });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(scanner.scan()).toMatchObject({ messages: 0, catches: 0 });
    expect(whaleCatch()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM cc_usage').get()).toEqual({ n: 0 });
    expect(scanner.status().errors).toEqual([
      { path: join('proj', 'session.jsonl'), error: expect.stringContaining('whale failure'), diagnostic: false },
    ]);

    db.exec('DROP TRIGGER reject_whale');
    expect(scanner.scan().messages).toBe(5);
    expect(db.prepare("SELECT COUNT(*) AS n FROM cc_catches WHERE session_id = 'whale-1'").get()).toEqual({ n: 4 });
    expect(whaleCatch()).toEqual({ n: 1 });
    expect(db.prepare(`SELECT ref FROM reef_events WHERE kind = 'whale'`).all()).toEqual([{ ref: 'whale-1#3' }]);
    expect(scanner.status().errors).toEqual([]);
    error.mockRestore();
  });

  it('never retro-awards: crossings before the reef epoch yield stats but no fish', () => {
    const db = fixtureDb();
    setReefEpoch(db, NOW);
    let content = '';
    for (let i = 0; i < 8; i++) {
      // 8 × 26M = 208M: would be 3 depth catches if retro.
      content += assistantLine({ requestId: `r${i}`, ts: NOW - 600 + i, cacheRead: 26_000_000 });
    }
    writeFileSync(file(), content);
    const result = new ClaudeUsageScanner({ db, dir }).scan();
    expect(result.messages).toBe(8);
    expect(result.catches).toBe(0);
    expect((db.prepare('SELECT COUNT(*) AS n FROM cc_catches').get() as { n: number }).n).toBe(0);
    // History still counts for stats.
    expect(reefSummary(db).lifetime.tokens).toBeGreaterThan(200_000_000);

    // Going forward: a post-epoch message crossing the NEXT session milestone
    // awards, pre-epoch crossings stay unawarded forever.
    appendFileSync(file(), assistantLine({ requestId: 'r9', sessionId: 's-new', ts: NOW + 5, cacheRead: 2_500_000 }));
    expect(new ClaudeUsageScanner({ db, dir }).scan().catches).toBe(1);
    const c = db.prepare('SELECT seed FROM cc_catches').get() as { seed: string };
    expect(c.seed).toBe('s-new#0');
  });

  it('skips harness noise when labeling sessions', () => {
    const db = freshDb();
    writeFileSync(
      file(),
      userLine('<command-name>/compact</command-name>', 'sess-1', NOW - 700) +
        userLine('what does the triage view do?', 'sess-1', NOW - 650) +
        assistantLine({ requestId: 'r1' }),
    );
    new ClaudeUsageScanner({ db, dir }).scan();
    const sess = db.prepare('SELECT label FROM cc_sessions').get() as { label: string };
    expect(sess.label).toBe('what does the triage view do?');
  });

  it('summary reports today/window/burn and estimates budgets from observed peaks', () => {
    const db = freshDb();
    writeFileSync(
      file(),
      assistantLine({ requestId: 'r1', ts: NOW - 1200, cacheRead: 3_000_000 }) +
        assistantLine({ requestId: 'r2', ts: NOW - 300, cacheRead: 1_000_000 }),
    );
    new ClaudeUsageScanner({ db, dir }).scan();
    const s = reefSummary(db);
    expect(s.window5h.tokens).toBeGreaterThanOrEqual(4_000_000);
    expect(s.window5h.resetAt).toBeGreaterThan(NOW);
    expect(s.window5h.budgetEstimated).toBe(true);
    expect(s.window5h.budget).toBeGreaterThanOrEqual(s.window5h.tokens);
    expect(s.lifetime.catches).toBe(1); // 4M+ depth → one catch
    expect(s.lastCatch?.seed).toBe('sess-1#0');

    setReefBudgets(db, { window5h: 90_000_000, week: null });
    expect(getReefBudgets(db).window5h).toBe(90_000_000);
    expect(reefSummary(db).window5h.budgetEstimated).toBe(false);

    const sessions = reefSessions(db, 7) as { label: string; tokens: number; catches: number }[];
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.tokens).toBeGreaterThan(4_000_000);
    expect(sessions[0]!.catches).toBe(1);

    const col = reefCollection(db);
    expect(col.species).toHaveLength(1);
    expect((col.species[0] as { first_project: string }).first_project).toBe('/home/dev/reef-demo');
    expect(col.recent).toHaveLength(1);
  });
});

describe('bounded, isolated scanning', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'reef-')); });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  const write = (rel: string, content: string) => {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), content);
  };
  const drain = (scanner: ClaudeUsageScanner) => {
    const total = { passes: 0, messages: 0, catches: 0 };
    do {
      const r = scanner.scan();
      total.passes++;
      total.messages += r.messages;
      total.catches += r.catches;
    } while (scanner.status().backfilling && total.passes < 50);
    return total;
  };

  it('records an unreadable file and keeps scanning and awarding the files after it', () => {
    const db = freshDb();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    write('a/locked.jsonl', assistantLine({ requestId: 'a1', sessionId: 'sess-a' }));
    let deep = '';
    for (let i = 0; i < 3; i++) deep += assistantLine({ requestId: `b${i}`, sessionId: 'sess-b', ts: NOW - 600 + i, cacheRead: 900_000 });
    write('b/open.jsonl', deep);
    chmodSync(join(dir, 'a/locked.jsonl'), 0o000);

    const scanner = new ClaudeUsageScanner({ db, dir });
    expect(scanner.scan()).toMatchObject({ messages: 3, catches: 1 });
    expect(scanner.status().errors).toEqual([
      { path: join('a', 'locked.jsonl'), error: expect.stringContaining('EACCES'), diagnostic: false },
    ]);

    chmodSync(join(dir, 'a/locked.jsonl'), 0o644);
    expect(scanner.scan().messages).toBe(1);
    expect(scanner.status().errors).toEqual([]);
  });

  it('clears an earlier failure once a fully read file opens cleanly again', () => {
    const db = freshDb();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    write('proj/s.jsonl', assistantLine({ requestId: 'r1' }));
    const scanner = new ClaudeUsageScanner({ db, dir });
    expect(scanner.scan().messages).toBe(1);
    chmodSync(join(dir, 'proj/s.jsonl'), 0o000);
    scanner.scan();
    expect(scanner.status().errors).toHaveLength(1);
    chmodSync(join(dir, 'proj/s.jsonl'), 0o644);
    expect(scanner.scan().messages).toBe(0);
    expect(scanner.status().errors).toEqual([]);
  });

  it('spreads a large backfill over several passes without losing or repeating a line', () => {
    const db = freshDb();
    const filler = 'x'.repeat(200_000);
    let content = '';
    for (let i = 0; i < 30; i++) content += userLine(`${filler} ${i}`) + assistantLine({ requestId: `r${i}`, ts: NOW - 600 + i });
    write('proj/big.jsonl', content);

    const scanner = new ClaudeUsageScanner({ db, dir });
    const first = scanner.scan();
    expect(first.messages).toBeGreaterThan(0);
    expect(first.messages).toBeLessThan(30);
    expect(scanner.status().backfilling).toBe(true);

    const rest = drain(scanner);
    expect(first.messages + rest.messages).toBe(30);
    expect(db.prepare('SELECT COUNT(*) AS n FROM cc_usage').get()).toEqual({ n: 30 });
    expect(scanner.status().backfilling).toBe(false);
  });

  it('skips a line over 16 MiB, notes it as a diagnostic, and counts the lines after it', () => {
    const db = freshDb();
    write('proj/huge.jsonl',
      assistantLine({ requestId: 'before' }) + userLine('y'.repeat(17 * 1024 * 1024)) + assistantLine({ requestId: 'after' }));

    const scanner = new ClaudeUsageScanner({ db, dir });
    expect(drain(scanner).messages).toBe(2);
    const ids = (db.prepare('SELECT request_id FROM cc_usage ORDER BY request_id').all() as { request_id: string }[])
      .map((r) => r.request_id);
    expect(ids).toEqual(['after', 'before']);
    expect(scanner.status()).toMatchObject({
      diagnosticCount: 1,
      errors: [{ path: join('proj', 'huge.jsonl'), error: expect.stringContaining('16 MiB'), diagnostic: true }],
    });
  });

  it('follows a symlinked projects directory', () => {
    const db = freshDb();
    write('real/proj/s.jsonl', assistantLine({ requestId: 'r1' }));
    symlinkSync(join(dir, 'real'), join(dir, 'link'));
    expect(new ClaudeUsageScanner({ db, dir: join(dir, 'link') }).scan().messages).toBe(1);
  });

  it('reports a fresh scanner as idle and a started one as enabled', () => {
    const db = freshDb();
    const scanner = new ClaudeUsageScanner({ db, dir });
    expect(scanner.status()).toEqual({
      enabled: false, lastScanAt: null, backfilling: false, files: 0, diagnosticCount: 0, errors: [], rootErrors: [],
    });
    scanner.start(60_000);
    expect(scanner.status().enabled).toBe(true);
    scanner.stop();
  });
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ConnectStatus, FISH_SETS, FishPicks, OpenPr, ReefBudgets, ReefCatchesByDate, ReefCollection, ReefModelRow,
  ReefPending, ReefProjectRow, ReefReleaseResult, ReefRewards, ReefScanResult, ReefSessionRow, ReefSummary,
  ReefTrendRow, ScannerStatus,
} from '@gtr/shared';
import { z } from 'zod';
import { createApp } from '../app.ts';
import { Bus } from '../services/bus.ts';
import { ClaudeUsageScanner } from '../services/claudeUsageScanner.ts';
import { CodexUsageScanner } from '../services/codexUsageScanner.ts';
import { fakeConnectDeps, fixtureDb } from '../services/fixtures.ts';
import { releaseReef, setReefEpoch } from '../services/reef.ts';
import { recordVisitorFetch } from '../services/reefEvents.ts';
import { mapOauthUsage } from '../services/reefLimits.ts';
import { checkSetCompletions } from '../services/reefSets.ts';
import { setSetting } from '../services/settings.ts';

// The API contract, end to end: real logs go through the real scanners and award
// logic, and every response is parsed with the shared schema the web reads. Nothing
// here is stubbed, so a renamed SQL column or a lying cast fails this file.

const NOW = Math.floor(Date.now() / 1000);
const iso = (ts: number) => new Date(ts * 1000).toISOString();
const line = (o: unknown) => `${JSON.stringify(o)}\n`;

let root: string;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  root = mkdtempSync(join(tmpdir(), 'reef-contract-'));
  const db = fixtureDb();
  setReefEpoch(db, NOW - 30 * 86400);
  setSetting(db, 'codexRewardEpoch', String(NOW - 30 * 86400));

  // Claude: 150M tokens in one session crosses four depth milestones (one a 128M whale) and the 100M legendary.
  mkdirSync(join(root, 'claude', 'proj'), { recursive: true });
  let claude = line({
    type: 'user', sessionId: 'deep', timestamp: iso(NOW - 700), cwd: '/src/reef',
    message: { role: 'user', content: 'chart the deep water' },
  });
  for (let i = 0; i < 5; i++) {
    claude += line({
      type: 'assistant', requestId: `r${i}`, sessionId: 'deep', timestamp: iso(NOW - 600 + i), cwd: '/src/reef',
      message: { role: 'assistant', model: 'claude-fable-5', usage: { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 30_000_000 } },
    });
  }
  writeFileSync(join(root, 'claude', 'proj', 'deep.jsonl'), claude);

  // Codex: one session with token usage and a rate-limit snapshot.
  mkdirSync(join(root, 'codex'));
  const codex = (type: string, payload: unknown) => line({ timestamp: iso(NOW - 300), type, payload });
  writeFileSync(join(root, 'codex', 'rollout.jsonl'),
    codex('session_meta', { id: 'cx-1', cwd: '/src/reef' })
    + codex('turn_context', { model: 'gpt-5-codex' })
    + codex('event_msg', {
      type: 'token_count',
      info: { total_token_usage: { input_tokens: 500, cached_input_tokens: 20, output_tokens: 40, reasoning_output_tokens: 2, total_tokens: 540 } },
      rate_limits: { primary: { used_percent: 24, window_minutes: 300, resets_in_seconds: 120 }, secondary: null, limit_id: 'codex', plan_type: 'pro' },
    }));

  setSetting(db, 'limits', JSON.stringify(mapOauthUsage(
    { five_hour: { utilization: 12, resets_at: iso(NOW + 3600) }, seven_day: { utilization: 40, resets_at: iso(NOW + 86400) } },
    { subscriptionType: 'max', rateLimitTier: 'default_claude_max_20x' },
    NOW,
  )));
  recordVisitorFetch(db, 'github', 'github rejected token (401)', NOW);

  app = createApp({
    db, bus: new Bus(), connect: fakeConnectDeps(),
    reefScanner: new ClaudeUsageScanner({ db, dir: join(root, 'claude') }),
    codexScanner: new CodexUsageScanner({ db, roots: [join(root, 'codex')] }),
  });
  expect(await send('POST', '/api/reef/scan', undefined, ReefScanResult)).toMatchObject({ messages: 6 });
});

afterAll(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

async function parse<T>(path: string, res: Response, schema: z.ZodType<T>): Promise<T> {
  expect(res.status).toBe(200);
  const parsed = schema.safeParse(await res.json());
  if (!parsed.success) throw new Error(`${path} broke the contract:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}
const get = async <T>(path: string, schema: z.ZodType<T>, on = app) => parse(path, await on.request(path), schema);
const send = async <T>(method: string, path: string, body: unknown, schema: z.ZodType<T>, on = app) =>
  parse(path, await on.request(path, {
    method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  }), schema);

describe('Reef API contract', () => {
  it('GET /summary', async () => {
    const s = await get('/api/reef/summary?agent=all', ReefSummary);
    expect(s.lastCatch).not.toBeNull();
    expect(s.official?.plan).toBe('Max 20x');
    expect(s.codexLimits?.primary?.usedPercent).toBe(24);
    expect(s.lifetime.catches).toBeGreaterThan(4);
  });

  it('GET /trend, /models and /projects for both agents', async () => {
    const trend = await get('/api/reef/trend?agent=all&days=30', z.array(ReefTrendRow));
    expect(new Set(trend.map((r) => r.agent))).toEqual(new Set(['claude', 'codex']));
    expect((await get('/api/reef/models?agent=all', z.array(ReefModelRow))).length).toBe(2);
    expect((await get('/api/reef/projects?agent=all', z.array(ReefProjectRow)))[0]!.project).toBe('/src/reef');
  });

  it('GET /sessions carries Codex session metadata', async () => {
    const sessions = await get('/api/reef/sessions?agent=all&days=7', z.array(ReefSessionRow));
    expect(sessions.find((s) => s.agent === 'claude')!.label).toBe('chart the deep water');
    expect(sessions.find((s) => s.agent === 'codex')!.native_id).toBe('cx-1');
  });

  it('GET /collection includes catalog species, a legendary and recent catches', async () => {
    const col = await get('/api/reef/collection', ReefCollection);
    expect(col.species.length).toBeGreaterThan(0);
    expect(col.species.every((s) => s.first_project === '/src/reef')).toBe(true);
    expect(col.legendary.length).toBeGreaterThan(0);
    expect(col.recent.length).toBeGreaterThan(0);
  });

  it('GET /catches for today', async () => {
    const day = await get('/api/reef/catches', ReefCatchesByDate);
    expect(day.count).toBe(day.catches.length);
  });

  it('GET /pending holds the new catches, the whale visitor and the visitor error', async () => {
    const p = await get('/api/reef/pending', ReefPending);
    expect(p.events.map((e) => e.kind)).toContain('whale');
    expect(p.visitorErrors).toEqual([{ source: 'github', message: 'github rejected token (401)', at: NOW }]);
    expect(p.all.length).toBe(p.count);
  });

  it('GET /summary on the default (Claude) and Codex filters', async () => {
    const claude = await get('/api/reef/summary', ReefSummary);
    const codex = await get('/api/reef/summary?agent=codex', ReefSummary);
    expect(claude.lifetime.tokens).toBeGreaterThan(150_000_000);
    expect(codex.lifetime.tokens).toBe(540); // Codex input_tokens already include the 20 cached
    expect((await get('/api/reef/sessions?agent=codex', z.array(ReefSessionRow))).map((r) => r.agent)).toEqual(['codex']);
  });

  it('GET /collection reports a released best size once the tank is released', async () => {
    const { count, all } = await get('/api/reef/pending', ReefPending);
    expect(count).toBeGreaterThan(0);
    const release = await send('POST', '/api/reef/release', { upToId: Math.max(...all.map((c) => c.id)) }, ReefReleaseResult);
    expect(release.releasedId).toBe(Math.max(...all.map((c) => c.id)));
    const col = await get('/api/reef/collection', ReefCollection);
    expect(col.species.every((s) => typeof s.released_best_size === 'number')).toBe(true);
  });

  it('every endpoint keeps the contract on an empty database', async () => {
    const empty = createApp({
      db: fixtureDb(), bus: new Bus(), connect: fakeConnectDeps(),
      reefScanner: new ClaudeUsageScanner({ db: fixtureDb(), dir: join(root, 'none') }),
      codexScanner: new CodexUsageScanner({ db: fixtureDb(), roots: [] }),
    });
    const s = await get('/api/reef/summary', ReefSummary, empty);
    expect(s).toMatchObject({ official: null, codexLimits: null, lastCatch: null, lifetime: { since: null } });
    expect(s.window5h).toMatchObject({ budget: null, startedAt: null, resetAt: null, limitAt: null });
    expect(await get('/api/reef/trend', z.array(ReefTrendRow), empty)).toEqual([]);
    expect(await get('/api/reef/models', z.array(ReefModelRow), empty)).toEqual([]);
    expect(await get('/api/reef/projects', z.array(ReefProjectRow), empty)).toEqual([]);
    expect(await get('/api/reef/sessions', z.array(ReefSessionRow), empty)).toEqual([]);
    expect(await get('/api/reef/collection', ReefCollection, empty)).toEqual({ species: [], legendary: [], recent: [] });
    expect((await get('/api/reef/catches', ReefCatchesByDate, empty)).count).toBe(0);
    expect((await get('/api/reef/pending', ReefPending, empty)).count).toBe(0);
  });

  it('a stored limits value that no longer matches the contract shows as none, not a broken shape', async () => {
    const db = fixtureDb();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setSetting(db, 'limits', JSON.stringify({ fiveHour: null, plan: 'Max', fetchedAt: NOW, retired: true }));
    db.prepare('INSERT INTO codex_limits (source, observed_at, snapshot_json) VALUES (?, ?, ?)').run('local:codex', NOW, '{"observedAt":1}');
    const stale = createApp({
      db, bus: new Bus(), connect: fakeConnectDeps(),
      reefScanner: new ClaudeUsageScanner({ db, dir: join(root, 'none') }),
      codexScanner: new CodexUsageScanner({ db, roots: [] }),
    });
    expect(await get('/api/reef/summary', ReefSummary, stale)).toMatchObject({ official: null, codexLimits: null });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('GET and PUT /budgets', async () => {
    expect(await get('/api/reef/budgets', ReefBudgets)).toEqual({ window5h: null, week: null });
    expect(await send('PUT', '/api/reef/budgets', { window5h: 90_000_000, week: null }, ReefBudgets))
      .toEqual({ window5h: 90_000_000, week: null });
  });

  it('GET and PUT /fish', async () => {
    const { recent } = await get('/api/reef/collection', ReefCollection);
    const picks = await send('PUT', '/api/reef/fish/strip', { species: [recent[0]!.species] }, FishPicks);
    expect(picks.strip).toEqual([recent[0]!.species]);
    expect(await get('/api/reef/fish', FishPicks)).toEqual(picks);
  });

  it('GET /prs, both scanner statuses, and the Connect status', async () => {
    expect(await get('/api/reef/prs', z.array(OpenPr))).toEqual([]);
    expect((await get('/api/reef/claude/status', ScannerStatus)).files).toBe(1);
    expect((await get('/api/reef/codex/status', ScannerStatus)).files).toBe(1);
    expect((await get('/api/connect', ConnectStatus)).github.connected).toBe(false);
  });

  it('POST /events/ui accepts the shared body', async () => {
    expect(await send('POST', '/api/events/ui', { name: 'reef.view' }, z.strictObject({ ok: z.literal(true) }))).toEqual({ ok: true });
  });

  it('GET /rewards and the decor and backdrop writes, once every set is complete and released', async () => {
    const db = fixtureDb();
    const insert = db.prepare(
      `INSERT INTO cc_catches (seed, session_id, catch_index, caught_at, project, depth_tokens, species, name, rarity)
       VALUES (?, 's', ?, ?, '/p', 1, ?, 'x', 'common')`,
    );
    const entries = [...new Set(FISH_SETS.flatMap((set) => set.entries))];
    entries.forEach((species, i) => insert.run(`all#${i}`, i, NOW, species));
    checkSetCompletions(db, NOW);
    const maxEvent = (db.prepare('SELECT MAX(id) AS m FROM reef_events').get() as { m: number }).m;
    releaseReef(db, entries.length, maxEvent);
    const rewarded = createApp({
      db, bus: new Bus(), connect: fakeConnectDeps(),
      reefScanner: new ClaudeUsageScanner({ db, dir: join(root, 'none') }),
      codexScanner: new CodexUsageScanner({ db, roots: [] }),
    });

    const rewards = await get('/api/reef/rewards', ReefRewards, rewarded);
    expect(rewards.badges.length).toBeGreaterThan(0);
    expect(rewards.decor.length).toBeGreaterThan(0);
    expect(rewards.backdrops.length).toBeGreaterThan(0);
    const item = rewards.decor[0]!.item;
    const moved = await send('PUT', `/api/reef/decor/${encodeURIComponent(item)}`, { shown: false, xFrac: 0.25 }, ReefRewards, rewarded);
    expect(moved.decor.find((d) => d.item === item)).toEqual({ item, shown: false, xFrac: 0.25 });
    const backdrop = rewards.backdrops[0]!;
    expect((await send('PUT', '/api/reef/backdrop', { backdrop }, ReefRewards, rewarded)).activeBackdrop).toBe(backdrop);
  });
});

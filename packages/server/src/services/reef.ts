import { closeSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  catchesEarned,
  milestoneAt,
  rollCatch,
  speciesName,
  type ReefVisitorError,
} from '@gtr/shared';

// The stored `name` column is a write-time snapshot kept for debugging; the
// catalog is the source of truth, so display names are DERIVED from the
// species index at the read boundary. Renaming a morph label is then a pure
// code change — no data migration. Legendaries keep their stored name
// (species 1000+ is a legendary id, not a catalog index).
function deriveName<T extends { species: number; rarity: string; name: string }>(row: T): T {
  return row.rarity === 'legendary' ? row : { ...row, name: speciesName(row.species) };
}
import type { Db } from '../store/db.ts';
import { CLAUDE_RATES_FINGERPRINT, estimateCcCost } from './pricing.ts';
import { getSetting, setSetting } from './settings.ts';
import { getOfficialLimits, type OfficialLimits } from './reefLimits.ts';
import {
  emitReefEvent, getReleasedEventId, moveEventMark, pendingEventCount, pendingEvents, visitorErrors, type ReefEventRow,
} from './reefEvents.ts';
import { checkSetCompletions } from './reefSets.ts';
import { autoAddReleased } from './reefFish.ts';
import { awardLegendaries, ladderTokens } from './legendaryAwards.ts';
import type { Bus } from './bus.ts';
import type { CodexLimitSnapshot, CodexSessionRow, CodexUsageRow, ReefAgentFilter } from './reefTypes.ts';

// The Reef — Claude Code usage analytics + fishing companion.
//
// A scanner tails ~/.claude/projects/**/*.jsonl incrementally: cc_files
// remembers a byte offset per file, only appended complete lines are parsed,
// and assistant-message usage upserts into cc_usage keyed by request_id
// (streaming re-emits and session forks that copy history dedupe themselves).
// Catches are DETERMINISTIC — seed = `${sessionId}#${index}` — so the whole
// collection can be rebuilt from the JSONL at any time and the same fish
// come back.

export const TOK = '(input_tokens + output_tokens + cache_read_tokens + cache_w5m_tokens + cache_w1h_tokens)';
const WINDOW_5H = 5 * 3600;

interface UsageRow {
  requestId: string;
  ts: number;
  sessionId: string;
  project: string;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheW5m: number;
  cacheW1h: number;
}

export class ReefScanner {
  private scanning = false;
  private warnedMissing = false;

  constructor(private readonly deps: { db: Db; bus?: Bus; dir: string }) {}

  start(intervalMs: number): void {
    const tick = () => {
      try {
        const r = this.scan();
        if (r.messages > 0 || r.catches > 0) {
          console.log(`[reef] scan: ${r.messages} messages, ${r.catches} catches (${r.files} files touched)`);
        }
      } catch (err) {
        console.error(`[reef] scan failed: ${(err as Error).message}`);
      }
    };
    // Defer the first pass — the initial backfill reads every historical
    // JSONL and must not delay the port bind.
    setTimeout(tick, 3000).unref();
    setInterval(tick, intervalMs).unref();
  }

  scan(): { files: number; messages: number; catches: number } {
    if (this.scanning) return { files: 0, messages: 0, catches: 0 };
    this.scanning = true;
    try {
      return this.scanOnce();
    } finally {
      this.scanning = false;
    }
  }

  private scanOnce(): { files: number; messages: number; catches: number } {
    const { db, dir } = this.deps;
    repriceClaudeUsage(db);
    let entries: string[];
    try {
      entries = (readdirSync(dir, { recursive: true }) as string[]).filter(
        (p) => p.endsWith('.jsonl'),
      );
    } catch {
      if (!this.warnedMissing) {
        console.warn(`[reef] projects dir not readable: ${dir} (set GTR_CC_PROJECTS_DIR)`);
        this.warnedMissing = true;
      }
      return { files: 0, messages: 0, catches: 0 };
    }

    let files = 0;
    let messages = 0;
    const touched = new Set<string>();

    for (const rel of entries) {
      const path = join(dir, rel);
      let size: number;
      try {
        size = statSync(path).size;
      } catch {
        continue; // deleted between listing and stat
      }
      const prev = db.prepare('SELECT bytes_read FROM cc_files WHERE path = ?').get(rel) as
        | { bytes_read: number }
        | undefined;
      // A shrunk file was rewritten — rescan from 0 (request_id upserts keep
      // this idempotent).
      const start = prev && prev.bytes_read <= size ? prev.bytes_read : 0;
      if (size <= start) continue;

      const { rows, consumed } = readAppendedRows(path, start, size - start);
      if (consumed === 0 && rows.usage.length === 0) continue;

      files++;
      try {
        const stored = storeUsage(db, rows);
        for (const s of stored.touched) touched.add(s);
        messages += stored.messages;
        // Offset bookkeeping sits outside storeUsage's transaction — a crash
        // between the two just re-parses on the next scan (upserts are
        // idempotent), it never loses data.
        db.prepare(
          `INSERT INTO cc_files (path, size, bytes_read, updated_at)
           VALUES (?, ?, ?, unixepoch())
           ON CONFLICT(path) DO UPDATE SET size = excluded.size,
             bytes_read = excluded.bytes_read, updated_at = excluded.updated_at`,
        ).run(rel, size, start + consumed);
      } catch (err) {
        console.error(`[reef] file ${rel} failed: ${(err as Error).message}`);
      }
    }

    const catches = messages > 0 ? awardCatches(db, touched) : 0;
    if ((messages > 0 || catches > 0) && this.deps.bus) this.deps.bus.emit('reef');
    return { files, messages, catches };
  }

}

/** Upsert parsed usage + session labels in one transaction. */
function storeUsage(
  db: Db,
  rows: ParsedTranscript,
): { messages: number; touched: Set<string> } {
  const touched = new Set<string>();
  let messages = 0;
  db.exec('BEGIN');
  try {
    const upsert = db.prepare(
      `INSERT OR REPLACE INTO cc_usage
       (request_id, ts, session_id, project, model, input_tokens, output_tokens,
        cache_read_tokens, cache_w5m_tokens, cache_w1h_tokens, cost, cost_known)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const unpriced = new Set<string>();
    for (const u of rows.usage) {
      const cost = estimateCcCost(u.model, {
        input: u.input, output: u.output, cacheRead: u.cacheRead,
        cacheW5m: u.cacheW5m, cacheW1h: u.cacheW1h,
      });
      if (cost === null) unpriced.add(u.model);
      upsert.run(u.requestId, u.ts, u.sessionId, u.project, u.model,
        u.input, u.output, u.cacheRead, u.cacheW5m, u.cacheW1h, cost ?? 0, cost === null ? 0 : 1);
      touched.add(u.sessionId);
      messages++;
    }
    const label = db.prepare(
      'INSERT OR IGNORE INTO cc_sessions (session_id, project, first_ts, label) VALUES (?, ?, ?, ?)',
    );
    for (const s of rows.sessions) label.run(s.sessionId, s.project, s.ts, s.label);
    const aiTitle = db.prepare(`UPDATE cc_sessions SET ai_title = ? WHERE session_id = ? AND agent = 'claude'`);
    for (const t of rows.titles) aiTitle.run(t.title, t.sessionId);
    db.exec('COMMIT');
    for (const m of unpriced) {
      console.warn(`[reef] no price for model "${m}" — cost left unknown; add it to CLAUDE_RATES in services/pricing.ts`);
    }
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { messages, touched };
}

const PRICING_KEY = 'ccPricingFingerprint';

/**
 * Re-price every stored Claude Code message when CLAUDE_RATES has changed since
 * the last run (fingerprint in settings), so fixing the table heals history.
 * Models still missing from the table stay cost_known = 0 (UI shows "partial").
 */
export function repriceClaudeUsage(db: Db): number {
  if (getSetting(db, PRICING_KEY) === CLAUDE_RATES_FINGERPRINT) return 0;
  const rows = db.prepare(
    `SELECT request_id, model, input_tokens, output_tokens, cache_read_tokens,
            cache_w5m_tokens, cache_w1h_tokens
     FROM cc_usage WHERE agent = 'claude'`,
  ).all() as {
    request_id: string; model: string; input_tokens: number; output_tokens: number;
    cache_read_tokens: number; cache_w5m_tokens: number; cache_w1h_tokens: number;
  }[];
  const update = db.prepare('UPDATE cc_usage SET cost = ?, cost_known = ? WHERE request_id = ?');
  const unpriced = new Map<string, number>();
  db.exec('BEGIN');
  try {
    for (const r of rows) {
      const cost = estimateCcCost(r.model, {
        input: r.input_tokens, output: r.output_tokens, cacheRead: r.cache_read_tokens,
        cacheW5m: r.cache_w5m_tokens, cacheW1h: r.cache_w1h_tokens,
      });
      if (cost === null) unpriced.set(r.model, (unpriced.get(r.model) ?? 0) + 1);
      update.run(cost ?? 0, cost === null ? 0 : 1, r.request_id);
    }
    setSetting(db, PRICING_KEY, CLAUDE_RATES_FINGERPRINT);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  console.log(`[reef] re-priced ${rows.length} Claude Code messages (rates changed)`);
  for (const [m, n] of unpriced) console.warn(`[reef] ${n} messages on "${m}" still have no price`);
  return rows.length;
}

/** Store normalized Codex deltas and their parser checkpoint atomically. */
export function storeCodexBatch(
  db: Db,
  usage: CodexUsageRow[],
  sessions: CodexSessionRow[],
  checkpoint: () => void,
): { messages: number; catches: number } {
  const touched = new Set<string>();
  let messages = 0;
  db.exec('BEGIN');
  try {
    const insert = db.prepare(
      `INSERT OR IGNORE INTO cc_usage
       (request_id, ts, session_id, project, model, input_tokens, output_tokens,
        cache_read_tokens, cost, agent, cost_known, reasoning_output_tokens, cache_write_input_tokens)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'codex', ?, ?, ?)`,
    );
    for (const u of usage) {
      const result = insert.run(u.requestId, u.ts, u.sessionId, u.project, u.model,
        u.input, u.output, u.cacheRead, u.cost ?? 0, u.cost === null ? 0 : 1,
        u.reasoningOutput, u.cacheWriteInput);
      if (result.changes > 0) {
        messages++;
        touched.add(u.sessionId);
      }
    }
    const session = db.prepare(
      `INSERT INTO cc_sessions
       (session_id, project, first_ts, label, agent, native_id, parent_session_id, model_provider, source)
       VALUES (?, ?, ?, ?, 'codex', ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         first_ts = MIN(first_ts, excluded.first_ts),
         label = CASE WHEN label = '' THEN excluded.label ELSE label END,
         project = CASE WHEN project = '' THEN excluded.project ELSE project END,
         parent_session_id = COALESCE(parent_session_id, excluded.parent_session_id),
         model_provider = COALESCE(model_provider, excluded.model_provider)
       WHERE cc_sessions.agent = 'codex'`,
    );
    for (const s of sessions) {
      session.run(s.sessionId, s.project, s.ts, s.label, s.nativeId,
        s.parentSessionId, s.modelProvider, s.source);
    }
    checkpoint();
    const catches = messages > 0 ? awardCatches(db, touched) : 0;
    db.exec('COMMIT');
    return { messages, catches };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

const WHALE_DEPTH = 128_000_000;

function sessionLabel(db: Db, sessionId: string, project: string): string {
  const row = db.prepare(
    `SELECT COALESCE(NULLIF(ai_title, ''), NULLIF(label, '')) AS label FROM cc_sessions WHERE session_id = ?`,
  ).get(sessionId) as { label: string | null } | undefined;
  return row?.label ?? (project.split('/').filter(Boolean).at(-1) ?? project);
}

/**
 * Deterministic catch engine: replay each touched session's depth ladder.
 * Crossings BEFORE the reef epoch never award — fish are a going-forward
 * reward, while usage stats keep full history.
 */
function awardCatches(db: Db, sessions: Set<string>): number {
  const epoch = getReefEpoch(db);
  let awarded = 0;
  const insert = db.prepare(
    `INSERT OR IGNORE INTO cc_catches
     (seed, session_id, catch_index, caught_at, project, depth_tokens, species, name, rarity, shiny, size)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const sessionId of sessions) {
    const rows = db.prepare(
      `SELECT ts, project, agent, ${TOK} AS total FROM cc_usage
       WHERE session_id = ? AND (agent = 'claude' OR ts >= ?) ORDER BY ts, request_id`,
    ).all(sessionId, readCodexRewardEpoch(db)) as { ts: number; project: string; agent: string; total: number }[];
    const tag = rows[0]?.agent === 'codex' ? '[codex]' : '[reef]';
    let cum = 0;
    let idx = 0;
    for (const row of rows) {
      cum += row.total;
      while (cum >= milestoneAt(idx)) {
        if (row.ts >= epoch) {
          const seed = `${sessionId}#${idx}`;
          const fish = rollCatch(seed, idx);
          // A failed whale emit must undo its catch, or the next scan never re-emits it.
          db.exec('SAVEPOINT reef_catch');
          let inserted: boolean;
          try {
            inserted = insert.run(seed, sessionId, idx, row.ts, row.project, milestoneAt(idx),
              fish.species, fish.name, fish.rarity, fish.shiny ? 1 : 0, fish.size).changes > 0;
            if (inserted && milestoneAt(idx) >= WHALE_DEPTH) {
              emitReefEvent(db, 'whale', seed, { sessionId, label: sessionLabel(db, sessionId, row.project), depthTokens: milestoneAt(idx) }, row.ts);
            }
            db.exec('RELEASE reef_catch');
          } catch (err) {
            db.exec('ROLLBACK TO reef_catch');
            db.exec('RELEASE reef_catch');
            throw err;
          }
          if (inserted) {
            awarded++;
            console.log(`${tag} 🎣 caught ${fish.shiny ? '✨SHINY ' : ''}${fish.name} (${fish.rarity}, ${fish.size}cm) at depth ${milestoneAt(idx) / 1e6}M — session ${sessionId.slice(0, 8)}`);
          }
        }
        idx++;
      }
    }
    // Consistency check against the shared helper (cheap, catches drift).
    if (idx !== catchesEarned(cum)) {
      console.warn(`${tag} catch count drift for ${sessionId}: walked ${idx}, formula ${catchesEarned(cum)}`);
    }
  }

  awarded += awardLegendaries(db);
  // Runs on every batch so a failed check is retried; a failure never costs the batch its catches.
  try {
    checkSetCompletions(db, Math.floor(Date.now() / 1000));
  } catch (err) {
    console.error(`[reef] set completion check failed: ${(err as Error).message}`);
  }
  return awarded;
}

/** Read the appended byte range and parse complete lines only. */
function readAppendedRows(path: string, start: number, length: number): {
  rows: ParsedTranscript;
  consumed: number;
} {
  const buf = Buffer.alloc(length);
  const fd = openSync(path, 'r');
  let read = 0;
  try {
    read = readSync(fd, buf, 0, length, start);
  } finally {
    closeSync(fd);
  }
  const lastNl = buf.lastIndexOf(10, read - 1);
  if (lastNl === -1) return { rows: { usage: [], sessions: [], titles: [] }, consumed: 0 };
  return { rows: parseTranscriptLines(buf.toString('utf8', 0, lastNl).split('\n')), consumed: lastNl + 1 };
}

interface ParsedTranscript {
  usage: UsageRow[];
  sessions: { sessionId: string; project: string; ts: number; label: string }[];
  titles: { sessionId: string; title: string }[];
}

/** Parse Claude Code transcript JSONL lines (shared by the scanner). */
function parseTranscriptLines(lines: string[]): ParsedTranscript {
  const usage: UsageRow[] = [];
  const sessions: ParsedTranscript['sessions'] = [];
  const titles: ParsedTranscript['titles'] = [];
  const seenSessionLabel = new Set<string>();

  for (const line of lines) {
    if (!line) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue; // torn or non-JSON line — skip, never abort the file
    }
    const sessionId = (obj.sessionId ?? obj.session_id) as string | undefined;
    // ai-title entries carry no timestamp, so they must be read before the ts guard.
    if (obj.type === 'ai-title' && sessionId && typeof obj.aiTitle === 'string' && obj.aiTitle.trim()) {
      titles.push({ sessionId, title: obj.aiTitle.trim() });
      continue;
    }
    const ts = typeof obj.timestamp === 'string' ? Math.floor(Date.parse(obj.timestamp) / 1000) : NaN;
    if (!sessionId || !Number.isFinite(ts)) continue;
    const project = typeof obj.cwd === 'string' ? obj.cwd : '';
    const message = obj.message as Record<string, unknown> | undefined;

    if (obj.type === 'assistant' && typeof obj.requestId === 'string' && message) {
      const u = message.usage as Record<string, unknown> | undefined;
      if (!u) continue;
      const cache = u.cache_creation as Record<string, unknown> | undefined;
      usage.push({
        requestId: obj.requestId,
        ts,
        sessionId,
        project,
        model: typeof message.model === 'string' ? message.model : 'unknown',
        input: num(u.input_tokens),
        output: num(u.output_tokens),
        cacheRead: num(u.cache_read_input_tokens),
        // Older CLI versions have only the flat total — treat it as 5m.
        cacheW5m: cache ? num(cache.ephemeral_5m_input_tokens) : num(u.cache_creation_input_tokens),
        cacheW1h: cache ? num(cache.ephemeral_1h_input_tokens) : 0,
      });
    } else if (obj.type === 'user' && !obj.isMeta && message && !seenSessionLabel.has(sessionId)) {
      const text = userText(message.content);
      if (text) {
        seenSessionLabel.add(sessionId);
        sessions.push({ sessionId, project, ts, label: text.slice(0, 140) });
      }
    }
  }
  return { usage, sessions, titles };
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function userText(content: unknown): string {
  let text = '';
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    const part = content.find((p) => (p as { type?: string }).type === 'text') as { text?: string } | undefined;
    text = part?.text ?? '';
  }
  text = text.trim();
  // Skip harness noise: command wrappers, tool results, system reminders.
  if (!text || text.startsWith('<')) return '';
  return text.replace(/\s+/g, ' ');
}

// ---------------------------------------------------------------------------
// Budgets (plan limits aren't in the JSONL — user-confirmable settings with
// observed-peak estimates until then).

// The reef epoch: catches only award for milestone crossings at/after this
// timestamp (seeded by migration 1; self-heals if the row is missing).
const EPOCH_KEY = 'reefEpoch';

export function getReefEpoch(db: Db): number {
  const raw = getSetting(db, EPOCH_KEY);
  if (raw) return Number(raw);
  const now = Math.floor(Date.now() / 1000);
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(EPOCH_KEY, String(now));
  return now;
}

const RELEASED_KEY = 'releasedCatchId';

// Catches at or below this id are already in the tank; migration 1 seeds it at 0.
export function getReleasedCatchId(db: Db): number {
  return Number(getSetting(db, RELEASED_KEY) ?? 0);
}

export interface ReefPending {
  count: number;
  releasedId: number;
  catches: CatchRow[];
  all: { id: number; species: number; shiny: number; rarity: string }[];
  events: ReefEventRow[];
  eventCount: number;
  visitorErrors: ReefVisitorError[];
}

export function reefPending(db: Db): ReefPending {
  const releasedId = getReleasedCatchId(db);
  const all = db.prepare(
    'SELECT id, species, shiny, rarity FROM cc_catches WHERE id > ? ORDER BY id',
  ).all(releasedId) as ReefPending['all'];
  const rows = db.prepare(
    'SELECT * FROM cc_catches WHERE id > ? ORDER BY id DESC LIMIT 10',
  ).all(releasedId) as Omit<CatchRow, 'agent'>[];
  const events = pendingEvents(db);
  return {
    count: all.length, releasedId, catches: rows.map(deriveCatch), all, events, eventCount: events.length,
    visitorErrors: visitorErrors(db),
  };
}

function pendingCount(db: Db): number {
  const catches = (db.prepare('SELECT COUNT(*) AS n FROM cc_catches WHERE id > ?')
    .get(getReleasedCatchId(db)) as { n: number }).n;
  return catches + pendingEventCount(db);
}

export function releaseReef(db: Db, upToId: number, upToEventId?: number): { releasedId: number; releasedEventId: number } {
  // SAVEPOINT, not BEGIN, so a caller already inside a transaction still nests.
  db.exec('SAVEPOINT reef_release');
  let catches: { releasedId: number; n: number };
  let events: { releasedId: number; n: number } | null;
  try {
    const previousMark = getReleasedCatchId(db);
    catches = moveCatchMark(db, upToId);
    autoAddReleased(db, previousMark, catches.releasedId);
    events = upToEventId === undefined ? null : moveEventMark(db, upToEventId);
    db.exec('RELEASE reef_release');
  } catch (err) {
    console.error(`[reef] release failed, rolling back both marks: ${(err as Error).message}`);
    try {
      db.exec('ROLLBACK TO reef_release');
      db.exec('RELEASE reef_release');
    } catch (rollbackErr) {
      console.error(`[reef] release rollback failed, marks may be partly moved: ${(rollbackErr as Error).message}`);
    }
    throw err;
  }
  console.log(`[reef] released catches up to ${catches.releasedId} (${catches.n} fish)`);
  if (events) console.log(`[reef] released events up to ${events.releasedId} (${events.n} events)`);
  return { releasedId: catches.releasedId, releasedEventId: events?.releasedId ?? getReleasedEventId(db) };
}

function moveCatchMark(db: Db, upToId: number): { releasedId: number; n: number } {
  const current = getReleasedCatchId(db);
  const max = (db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM cc_catches').get() as { m: number }).m;
  const releasedId = Math.max(current, Math.min(upToId, max));
  setSetting(db, RELEASED_KEY, String(releasedId));
  const n = (db.prepare('SELECT COUNT(*) AS n FROM cc_catches WHERE id > ? AND id <= ?')
    .get(current, releasedId) as { n: number }).n;
  return { releasedId, n };
}

const CODEX_EPOCH_KEY = 'codexRewardEpoch';

// Reads must never activate rewards: scanner startup owns activation.
export function readCodexRewardEpoch(db: Db): number {
  const raw = getSetting(db, CODEX_EPOCH_KEY);
  return raw ? Number(raw) : Number.MAX_SAFE_INTEGER;
}

export function getCodexRewardEpoch(db: Db): number {
  const now = Math.floor(Date.now() / 1000);
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')
    .run(CODEX_EPOCH_KEY, String(now));
  return readCodexRewardEpoch(db);
}

/** Test hook (also handy for a deliberate re-grant): move the epoch. */
export function setReefEpoch(db: Db, ts: number): void {
  setSetting(db, EPOCH_KEY, String(ts));
}

const BUDGET_KEY = 'budgets';

export interface ReefBudgets {
  window5h: number | null;
  week: number | null;
}

export function getReefBudgets(db: Db): ReefBudgets {
  const raw = getSetting(db, BUDGET_KEY);
  const parsed = raw ? (JSON.parse(raw) as Partial<ReefBudgets>) : {};
  return { window5h: parsed.window5h ?? null, week: parsed.week ?? null };
}

export function setReefBudgets(db: Db, budgets: ReefBudgets): ReefBudgets {
  setSetting(db, BUDGET_KEY, JSON.stringify(budgets));
  return budgets;
}

// ---------------------------------------------------------------------------
// Queries (thin route adapters call these).

function tokensPerActiveMin7d(db: Db, agent: ReefAgentFilter, weekTokens: number, now: number): number {
  const { n } = db.prepare(
    `SELECT COUNT(DISTINCT ts / 60) AS n FROM cc_usage
     WHERE ts > ? AND (? = 'all' OR agent = ?)`,
  ).get(now - 7 * 86400, agent, agent) as { n: number };
  return n > 0 ? Math.round(weekTokens / n) : 0;
}

function claudeSummary(db: Db): {
  today: { tokens: number; cost: number; catches: number };
  window5h: {
    tokens: number; budget: number | null; budgetEstimated: boolean;
    startedAt: number | null; resetAt: number | null; limitAt: number | null;
  };
  week: { tokens: number; cost: number; budget: number | null; budgetEstimated: boolean };
  burn: { tokensPerMin: number; costPerHour: number; tokensPerMin7d: number; tokensPerActiveMin7d: number };
  official: OfficialLimits | null;
  lastCatch: CatchRow | null;
  lifetime: {
    tokens: number; cost: number; since: number | null;
    catches: number; speciesDiscovered: number;
  };
} {
  const now = Math.floor(Date.now() / 1000);
  const dayStart = Math.floor(new Date(new Date().setHours(0, 0, 0, 0)).getTime() / 1000);
  const budgets = getReefBudgets(db);

  const today = db.prepare(
    `SELECT COALESCE(SUM(${TOK}), 0) AS tokens, COALESCE(SUM(cost), 0) AS cost
     FROM cc_usage WHERE agent = 'claude' AND ts >= ?`,
  ).get(dayStart) as { tokens: number; cost: number };
  const todayCatches = (db.prepare(
    'SELECT COUNT(*) AS n FROM cc_catches WHERE caught_at >= ?',
  ).get(dayStart) as { n: number }).n;

  // 5h windows: chain from first activity — a window opens at the first
  // message after the previous window's 5h elapses (mirrors how the plan
  // limit windows behave). 5-minute buckets keep this cheap over 14 days.
  const buckets = db.prepare(
    `SELECT (ts / 300) * 300 AS bucket, SUM(${TOK}) AS tokens
     FROM cc_usage WHERE agent = 'claude' AND ts > ? GROUP BY bucket ORDER BY bucket`,
  ).all(now - 14 * 86400) as { bucket: number; tokens: number }[];

  let windowStart: number | null = null;
  let windowTokens = 0;
  let maxWindowTokens = 0;
  for (const b of buckets) {
    if (windowStart === null || b.bucket >= windowStart + WINDOW_5H) {
      windowStart = b.bucket;
      windowTokens = 0;
    }
    windowTokens += b.tokens;
    if (windowTokens > maxWindowTokens) maxWindowTokens = windowTokens;
  }
  const inWindow = windowStart !== null && now < windowStart + WINDOW_5H;
  const cur5h = inWindow ? windowTokens : 0;
  const budget5h = budgets.window5h ?? (maxWindowTokens > 0 ? Math.ceil(maxWindowTokens * 1.1) : null);

  const week = db.prepare(
    `SELECT COALESCE(SUM(${TOK}), 0) AS tokens, COALESCE(SUM(cost), 0) AS cost
     FROM cc_usage WHERE agent = 'claude' AND ts > ?`,
  ).get(now - 7 * 86400) as { tokens: number; cost: number };
  // Estimated weekly budget: worst consecutive-7-day total in the last 14.
  const daily = db.prepare(
    `SELECT (ts / 86400) AS day, SUM(${TOK}) AS tokens FROM cc_usage
     WHERE agent = 'claude' AND ts > ? GROUP BY day ORDER BY day`,
  ).all(now - 14 * 86400) as { day: number; tokens: number }[];
  let maxWeek = 0;
  for (let i = 0; i < daily.length; i++) {
    let sum = 0;
    for (let j = i; j < daily.length && daily[j]!.day < daily[i]!.day + 7; j++) sum += daily[j]!.tokens;
    if (sum > maxWeek) maxWeek = sum;
  }
  const budgetWeek = budgets.week ?? (maxWeek > 0 ? Math.ceil(maxWeek * 1.1) : null);

  const lastHour = db.prepare(
    `SELECT COALESCE(SUM(${TOK}), 0) AS tokens, COALESCE(SUM(cost), 0) AS cost
     FROM cc_usage WHERE agent = 'claude' AND ts > ?`,
  ).get(now - 3600) as { tokens: number; cost: number };
  const tokensPerMin = lastHour.tokens / 60;
  // Forecast: at the last hour's pace, when does the current window budget run out?
  let limitAt: number | null = null;
  if (inWindow && budget5h && tokensPerMin > 0 && cur5h < budget5h) {
    const minutes = (budget5h - cur5h) / tokensPerMin;
    const hit = now + Math.round(minutes * 60);
    if (hit < windowStart! + WINDOW_5H) limitAt = hit;
  }

  const lastCatchRow = (db.prepare(
    'SELECT * FROM cc_catches ORDER BY caught_at DESC, id DESC LIMIT 1',
  ).get() ?? null) as Omit<CatchRow, 'agent'> | null;
  const lastCatch = lastCatchRow ? deriveCatch(lastCatchRow) : null;

  const lifetime = db.prepare(
    `SELECT COALESCE(SUM(${TOK}), 0) AS tokens, COALESCE(SUM(cost), 0) AS cost, MIN(ts) AS since
     FROM cc_usage WHERE agent = 'claude'`,
  ).get() as { tokens: number; cost: number; since: number | null };
  const catchTotals = db.prepare(
    `SELECT COUNT(*) AS catches, COUNT(DISTINCT CASE WHEN rarity != 'legendary' THEN species END) AS species
     FROM cc_catches`,
  ).get() as { catches: number; species: number };

  return {
    today: { ...today, catches: todayCatches },
    window5h: {
      tokens: cur5h,
      budget: budget5h,
      budgetEstimated: budgets.window5h === null,
      startedAt: inWindow ? windowStart : null,
      resetAt: inWindow ? windowStart! + WINDOW_5H : null,
      limitAt,
    },
    week: { ...week, budget: budgetWeek, budgetEstimated: budgets.week === null },
    burn: {
      tokensPerMin: Math.round(tokensPerMin),
      costPerHour: Math.round(lastHour.cost * 100) / 100,
      tokensPerMin7d: Math.round(week.tokens / (7 * 24 * 60)),
      tokensPerActiveMin7d: tokensPerActiveMin7d(db, 'claude', week.tokens, now),
    },
    official: getOfficialLimits(db),
    lastCatch,
    lifetime: {
      tokens: lifetime.tokens, cost: lifetime.cost, since: lifetime.since,
      catches: catchTotals.catches, speciesDiscovered: catchTotals.species,
    },
  };
}

/** Usage selection is independent of Claude quotas and the shared collection. */
export function reefSummary(db: Db, agent: ReefAgentFilter = 'claude') {
  const claude = claudeSummary(db);
  const now = Math.floor(Date.now() / 1000);
  const dayStart = Math.floor(new Date(new Date().setHours(0, 0, 0, 0)).getTime() / 1000);
  const totals = (since: number) => db.prepare(
    `SELECT COALESCE(SUM(${TOK}), 0) AS tokens, COALESCE(SUM(cost), 0) AS cost,
            COALESCE(SUM(CASE WHEN cost_known = 0 THEN 1 ELSE 0 END), 0) AS unpricedEvents,
            MIN(ts) AS since
     FROM cc_usage WHERE ts >= ? AND (? = 'all' OR agent = ?)`,
  ).get(since, agent, agent) as { tokens: number; cost: number; unpricedEvents: number; since: number | null };
  const today = totals(dayStart);
  const week = totals(now - 7 * 86400 + 1);
  const hour = totals(now - 3600 + 1);
  const lifetime = totals(0);
  const limitRow = db.prepare(
    'SELECT snapshot_json FROM codex_limits ORDER BY observed_at DESC, source LIMIT 1',
  ).get() as { snapshot_json: string } | undefined;
  let codexLimits: CodexLimitSnapshot | null = null;
  if (limitRow) {
    try { codexLimits = JSON.parse(limitRow.snapshot_json) as CodexLimitSnapshot; } catch { /* ignore invalid stored telemetry */ }
  }
  return {
    ...claude,
    pending: pendingCount(db),
    today: { ...claude.today, tokens: today.tokens, cost: today.cost, unpricedEvents: today.unpricedEvents },
    week: { ...claude.week, tokens: week.tokens, cost: week.cost, unpricedEvents: week.unpricedEvents },
    burn: {
      tokensPerMin: Math.round(hour.tokens / 60),
      costPerHour: Math.round(hour.cost * 100) / 100,
      unpricedEvents: hour.unpricedEvents,
      tokensPerMin7d: Math.round(week.tokens / (7 * 24 * 60)),
      tokensPerActiveMin7d: tokensPerActiveMin7d(db, agent, week.tokens, now),
    },
    lifetime: {
      ...claude.lifetime, tokens: lifetime.tokens, cost: lifetime.cost, since: lifetime.since,
      unpricedEvents: lifetime.unpricedEvents,
    },
    claudeQuota: { window5h: claude.window5h, week: claude.week, burn: claude.burn, official: claude.official },
    rewards: {
      tokens: ladderTokens(db),
      catches: claude.lifetime.catches,
      speciesDiscovered: claude.lifetime.speciesDiscovered,
      lastCatch: claude.lastCatch,
    },
    codexLimits,
    unpricedEvents: lifetime.unpricedEvents,
  };
}

export interface CatchRow {
  agent: 'claude' | 'codex' | null;
  id: number; seed: string; session_id: string; catch_index: number;
  caught_at: number; project: string; depth_tokens: number; species: number;
  name: string; rarity: string; shiny: number; size: number;
}

// Codex session IDs are namespaced at ingestion; Claude IDs remain unchanged.
// Legendaries belong to the shared collection, not to either agent.
function deriveCatch(row: Omit<CatchRow, 'agent'>): CatchRow {
  return { ...deriveName(row), agent: row.rarity === 'legendary' ? null : row.session_id.startsWith('codex:') ? 'codex' : 'claude' };
}

export function reefTrend(db: Db, days: number, agent: ReefAgentFilter = 'claude') {
  return db.prepare(
    `SELECT date(ts, 'unixepoch', 'localtime') AS day, model, agent,
            SUM(${TOK}) AS tokens, ROUND(SUM(cost), 4) AS cost,
            SUM(CASE WHEN cost_known = 0 THEN 1 ELSE 0 END) AS unpricedEvents
     FROM cc_usage WHERE ts > unixepoch() - ? * 86400 AND (? = 'all' OR agent = ?)
     GROUP BY day, model, agent ORDER BY day`,
  ).all(days, agent, agent);
}

export function reefModels(db: Db, days: number, agent: ReefAgentFilter = 'claude') {
  return db.prepare(
    `SELECT model, agent, COUNT(*) AS calls,
            SUM(input_tokens) AS input, SUM(output_tokens) AS output,
            SUM(cache_read_tokens) AS cache_read,
            SUM(cache_w5m_tokens + cache_w1h_tokens) AS cache_write,
            ROUND(SUM(cost), 2) AS cost,
            SUM(CASE WHEN cost_known = 0 THEN 1 ELSE 0 END) AS unpricedEvents
     FROM cc_usage WHERE ts > unixepoch() - ? * 86400 AND (? = 'all' OR agent = ?)
     GROUP BY model, agent ORDER BY cost DESC`,
  ).all(days, agent, agent);
}

export function reefProjects(db: Db, days: number, agent: ReefAgentFilter = 'claude') {
  return db.prepare(
    `SELECT project, SUM(${TOK}) AS tokens, ROUND(SUM(cost), 2) AS cost,
            SUM(CASE WHEN cost_known = 0 THEN 1 ELSE 0 END) AS unpricedEvents,
            COUNT(DISTINCT session_id) AS sessions, MAX(ts) AS last_used
     FROM cc_usage WHERE ts > unixepoch() - ? * 86400 AND (? = 'all' OR agent = ?)
     GROUP BY project ORDER BY cost DESC`,
  ).all(days, agent, agent);
}

export function reefSessions(db: Db, days: number, limit = 20, agent: ReefAgentFilter = 'claude') {
  return db.prepare(
    `SELECT u.session_id,
            COALESCE(
              NULLIF(s.ai_title, ''),
              NULLIF(s.label, ''),
              (SELECT '↳ ' || COALESCE(NULLIF(p.ai_title, ''), NULLIF(p.label, ''))
                 FROM cc_sessions p
                WHERE p.session_id = s.parent_session_id
                  AND COALESCE(NULLIF(p.ai_title, ''), NULLIF(p.label, '')) IS NOT NULL),
              TRIM(replace(u.project, rtrim(u.project, replace(u.project, '/', '')), '') || ' · '
                   || strftime('%Y-%m-%d', MIN(u.ts), 'unixepoch'), ' ·')
            ) AS label, u.project, u.agent,
            s.native_id, s.parent_session_id, s.model_provider, s.source,
            MIN(u.ts) AS started_at, MAX(u.ts) AS ended_at,
            SUM(${TOK}) AS tokens,
            SUM(CASE WHEN u.agent = 'claude' OR u.ts >= ? THEN ${TOK} ELSE 0 END) AS rewardTokens,
            ROUND(SUM(u.cost), 2) AS cost,
            SUM(CASE WHEN u.cost_known = 0 THEN 1 ELSE 0 END) AS unpricedEvents,
            (SELECT COUNT(*) FROM cc_catches c WHERE c.session_id = u.session_id) AS catches
     FROM cc_usage u
     LEFT JOIN cc_sessions s ON s.session_id = u.session_id
     WHERE u.ts > unixepoch() - ? * 86400 AND (? = 'all' OR u.agent = ?)
     GROUP BY u.session_id ORDER BY ended_at DESC LIMIT ?`,
  ).all(readCodexRewardEpoch(db), days, agent, agent, limit);
}

export interface CollectionSpeciesRow {
  species: number; name: string; rarity: string; count: number;
  shiny_count: number; best_size: number; first_caught: number;
  last_caught: number; first_project: string | null;
  /** best among catches already in the tank; the tank draws this until a release lands */
  released_best_size: number | null;
}

export function reefCollection(db: Db) {
  const releasedId = getReleasedCatchId(db);
  const species = db.prepare(
    `SELECT species, name, rarity, COUNT(*) AS count, SUM(shiny) AS shiny_count,
            MAX(size) AS best_size, MIN(caught_at) AS first_caught, MAX(caught_at) AS last_caught,
            MAX(CASE WHEN c.id <= ? THEN size END) AS released_best_size,
            (SELECT c2.project FROM cc_catches c2
              WHERE c2.species = c.species AND c2.rarity != 'legendary'
              ORDER BY c2.caught_at, c2.id LIMIT 1) AS first_project
     FROM cc_catches c WHERE c.rarity != 'legendary'
     GROUP BY species ORDER BY MIN(caught_at)`,
  ).all(releasedId).map((r) => deriveName(r as unknown as CollectionSpeciesRow));
  const legendary = db.prepare(
    `SELECT species, name, shiny, size, caught_at, depth_tokens, project, NULL AS agent FROM cc_catches
     WHERE rarity = 'legendary' ORDER BY depth_tokens, shiny`,
  ).all();
  const recent = db.prepare(
    'SELECT * FROM cc_catches ORDER BY caught_at DESC, id DESC LIMIT 30',
  ).all().map((r) => deriveCatch(r as unknown as Omit<CatchRow, 'agent'>));
  return { species, legendary, recent };
}

const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;

/**
 * Individual catches for one local calendar day ("how many fish did I
 * catch today"), optionally narrowed to a rarity. `date` is a
 * YYYY-MM-DD string in local time; defaults to today.
 */
export function reefCatchesByDate(
  db: Db,
  opts: { date?: string; rarity?: string } = {},
): { date: string; count: number; catches: CatchRow[] } {
  const date =
    opts.date ??
    (db.prepare(`SELECT date('now', 'localtime') AS d`).get() as { d: string }).d;
  const rarity = opts.rarity && (RARITIES as readonly string[]).includes(opts.rarity) ? opts.rarity : null;

  const catches = db
    .prepare(
      `SELECT * FROM cc_catches
       WHERE date(caught_at, 'unixepoch', 'localtime') = ?
         AND (? IS NULL OR rarity = ?)
       ORDER BY caught_at DESC, id DESC`,
    )
    .all(date, rarity, rarity) as unknown as Omit<CatchRow, 'agent'>[];

  return { date, count: catches.length, catches: catches.map(deriveCatch) };
}

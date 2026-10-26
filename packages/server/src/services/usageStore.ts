import type { Db } from '../store/db.ts';
import { awardCatches } from './catches.ts';
import { CLAUDE_RATES_FINGERPRINT, estimateCcCost } from './pricing.ts';
import type { ClaudeTranscript, CodexSessionRow, CodexUsageRow } from './reefTypes.ts';
import { getSetting, setSetting } from './settings.ts';

// The Reef — Claude Code usage analytics + fishing companion.
//
// The scanners (claudeUsageScanner.ts, codexUsageScanner.ts) tail agent logs
// and hand each parsed chunk to a store*Batch function below, which commits
// usage, the scanner's checkpoint and any catches in one transaction.
// Catches are DETERMINISTIC — seed = `${sessionId}#${index}` — so the whole
// collection can be rebuilt from the logs at any time and the same fish
// come back.

/** Store parsed Claude Code usage, its checkpoint and any catches atomically. */
export function storeClaudeBatch(
  db: Db,
  rows: ClaudeTranscript,
  checkpoint: () => void,
): { messages: number; catches: number } {
  const touched = new Set<string>();
  const unpriced = new Set<string>();
  let messages = 0;
  let catches: number;
  db.exec('BEGIN');
  try {
    const upsert = db.prepare(
      // First owner wins: a forked session copies its parent's request IDs, and must not take them over.
      `INSERT INTO cc_usage
       (request_id, ts, session_id, project, model, input_tokens, output_tokens,
        cache_read_tokens, cache_w5m_tokens, cache_w1h_tokens, cost, cost_known)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(request_id) DO UPDATE SET model = excluded.model,
         input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens,
         cache_read_tokens = excluded.cache_read_tokens, cache_w5m_tokens = excluded.cache_w5m_tokens,
         cache_w1h_tokens = excluded.cache_w1h_tokens, cost = excluded.cost, cost_known = excluded.cost_known
       WHERE cc_usage.session_id = excluded.session_id`,
    );
    for (const u of rows.usage) {
      const cost = estimateCcCost(u.model, {
        input: u.input, output: u.output, cacheRead: u.cacheRead,
        cacheW5m: u.cacheW5m, cacheW1h: u.cacheW1h,
      });
      if (cost === null) unpriced.add(u.model);
      const result = upsert.run(u.requestId, u.ts, u.sessionId, u.project, u.model,
        u.input, u.output, u.cacheRead, u.cacheW5m, u.cacheW1h, cost ?? 0, cost === null ? 0 : 1);
      if (result.changes === 0) continue; // another session already owns this request
      touched.add(u.sessionId);
      messages++;
    }
    const label = db.prepare(
      'INSERT OR IGNORE INTO cc_sessions (session_id, project, first_ts, label) VALUES (?, ?, ?, ?)',
    );
    for (const s of rows.sessions) label.run(s.sessionId, s.project, s.ts, s.label);
    const aiTitle = db.prepare(`UPDATE cc_sessions SET ai_title = ? WHERE session_id = ? AND agent = 'claude'`);
    for (const t of rows.titles) aiTitle.run(t.title, t.sessionId);
    checkpoint();
    // Awards share the batch so a failed award also rolls back the checkpoint, and the next pass retries it.
    catches = messages > 0 ? awardCatches(db, touched) : 0;
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  for (const m of unpriced) {
    console.warn(`[reef] no price for model "${m}" — cost left unknown; add it to CLAUDE_RATES in services/pricing.ts`);
  }
  return { messages, catches };
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

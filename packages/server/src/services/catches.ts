import { catchesEarned, milestoneAt, rollCatch } from '@gtr/shared';
import type { Db } from '../store/db.ts';
import { awardLegendaries } from './legendaryAwards.ts';
import { emitReefEvent } from './reefEvents.ts';
import { TOK } from './reefRows.ts';
import { checkSetCompletions } from './reefSets.ts';
import { getReefEpoch, readCodexRewardEpoch } from './reefState.ts';

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
export function awardCatches(db: Db, sessions: Set<string>): number {
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

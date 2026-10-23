import { LEGENDARY_DEFS, LEGENDARY_ID_BASE, legendaryAwards } from '@gtr/shared';
import type { Db } from '../store/db.ts';
import { TOK, getReefEpoch } from './reef.ts';
import { getSetting } from './settings.ts';

function ladderOffset(db: Db): number {
  const n = Number(getSetting(db, 'ladderOffsetTokens'));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Tokens since the reef epoch (both agents) plus the user's starting offset. */
export function ladderTokens(db: Db): number {
  const row = db.prepare(`SELECT COALESCE(SUM(${TOK}), 0) AS tokens FROM cc_usage WHERE ts >= ?`)
    .get(getReefEpoch(db)) as { tokens: number };
  return row.tokens + ladderOffset(db);
}

/** Awards every legendary the ladder has reached; each is stamped with the 5-minute bucket where it was crossed. */
export function awardLegendaries(db: Db): number {
  const epoch = getReefEpoch(db);
  const offset = ladderOffset(db);
  const buckets = db.prepare(
    `SELECT (ts / 300) * 300 AS bucket, SUM(${TOK}) AS tokens FROM cc_usage
     WHERE ts >= ? GROUP BY bucket ORDER BY bucket`,
  ).all(epoch) as { bucket: number; tokens: number }[];
  const awards = legendaryAwards(offset + buckets.reduce((sum, b) => sum + b.tokens, 0));
  if (awards.length === 0) return 0;

  const insert = db.prepare(
    `INSERT OR IGNORE INTO cc_catches
     (seed, session_id, catch_index, caught_at, project, depth_tokens, species, name, rarity, shiny, size)
     VALUES (?, 'lifetime', ?, ?, '', ?, ?, ?, 'legendary', ?, ?)`,
  );
  let awarded = 0;
  let next = 0;
  let total = offset;
  // An offset already past a threshold stamps it with the first bucket.
  for (const b of buckets) {
    total += b.tokens;
    while (next < awards.length && awards[next]!.threshold <= total) {
      const a = awards[next++]!;
      const def = LEGENDARY_DEFS[a.index]!;
      const res = insert.run(a.seed, a.index, b.bucket, a.threshold, LEGENDARY_ID_BASE + a.index,
        def.name, a.shiny ? 1 : 0, def.lengthCm);
      if (res.changes > 0) {
        awarded++;
        console.log(`[reef] legendary earned: ${a.shiny ? 'shiny ' : ''}${def.name} at ${a.threshold / 1e6}M ladder tokens`);
      }
    }
  }
  return awarded;
}

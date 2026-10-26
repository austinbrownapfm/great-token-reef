import type { ReefPending, ReefReleaseResult } from '@gtr/shared';
import type { Db } from '../store/db.ts';
import { autoAddReleased } from './reefFish.ts';
import {
  getReleasedEventId, moveEventMark, pendingEventCount, pendingEvents, visitorErrors,
} from './reefEvents.ts';
import { deriveCatch, type CatchColumns } from './reefRows.ts';
import { getReleasedCatchId, setReleasedCatchId } from './reefState.ts';

export function reefPending(db: Db): ReefPending {
  const releasedId = getReleasedCatchId(db);
  const all = db.prepare(
    'SELECT id, species, shiny, rarity FROM cc_catches WHERE id > ? ORDER BY id',
  ).all(releasedId) as ReefPending['all'];
  const rows = db.prepare(
    'SELECT * FROM cc_catches WHERE id > ? ORDER BY id DESC LIMIT 10',
  ).all(releasedId) as CatchColumns[];
  const events = pendingEvents(db);
  return {
    count: all.length, releasedId, catches: rows.map(deriveCatch), all, events, eventCount: events.length,
    visitorErrors: visitorErrors(db),
  };
}

export function pendingCount(db: Db): number {
  const catches = (db.prepare('SELECT COUNT(*) AS n FROM cc_catches WHERE id > ?')
    .get(getReleasedCatchId(db)) as { n: number }).n;
  return catches + pendingEventCount(db);
}

export function releaseReef(db: Db, upToId: number, upToEventId?: number): ReefReleaseResult {
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
  setReleasedCatchId(db, releasedId);
  const n = (db.prepare('SELECT COUNT(*) AS n FROM cc_catches WHERE id > ? AND id <= ?')
    .get(current, releasedId) as { n: number }).n;
  return { releasedId, n };
}

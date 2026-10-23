import { ReefVisitorError } from '@gtr/shared';
import type { Db } from '../store/db.ts';
import { deleteSetting, getSetting, setSetting } from './settings.ts';

// The Reef waiting queue for non-fish arrivals (visitors and set rewards).
// Fish keep cc_catches and their own released mark in reef.ts.

export type ReefEventKind = 'pr' | 'ticket' | 'whale' | 'set';

export interface ReefEventRow {
  id: number;
  kind: ReefEventKind;
  ref: string;
  payload: unknown;
  created_at: number;
}

const RELEASED_EVENT_KEY = 'releasedEventId';

export function emitReefEvent(db: Db, kind: ReefEventKind, ref: string, payload: object, at: number): number | null {
  // Seed before the first insert, or boot-time events would seed as already released.
  getReleasedEventId(db);
  const result = db.prepare(
    `INSERT INTO reef_events (kind, ref, payload_json, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(kind, ref) DO NOTHING`,
  ).run(kind, ref, JSON.stringify(payload), at);
  if (result.changes === 0) return null;
  const id = Number(result.lastInsertRowid);
  console.log(`[reef] event ${kind} ${ref} (id ${id})`);
  return id;
}

// Events at or below this id were already played; history seeds in as released.
export function getReleasedEventId(db: Db): number {
  const raw = getSetting(db, RELEASED_EVENT_KEY);
  if (raw) return Number(raw);
  db.prepare(
    `INSERT OR IGNORE INTO settings (key, value)
     VALUES (?, (SELECT CAST(COALESCE(MAX(id), 0) AS TEXT) FROM reef_events))`,
  ).run(RELEASED_EVENT_KEY);
  const id = Number(getSetting(db, RELEASED_EVENT_KEY));
  console.log(`[reef] seeded released event mark at ${id}`);
  return id;
}

export function pendingEvents(db: Db): ReefEventRow[] {
  const rows = db.prepare(
    'SELECT id, kind, ref, payload_json, created_at FROM reef_events WHERE id > ? ORDER BY id',
  ).all(getReleasedEventId(db)) as (Omit<ReefEventRow, 'payload'> & { payload_json: string })[];
  return rows.map(({ payload_json, ...row }) => {
    try {
      return { ...row, payload: JSON.parse(payload_json) as unknown };
    } catch (err) {
      console.error(`[reef] bad event payload id=${row.id}: ${(err as Error).message}`);
      throw err;
    }
  });
}

export function pendingEventCount(db: Db): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM reef_events WHERE id > ?')
    .get(getReleasedEventId(db)) as { n: number }).n;
}

/** Moves the mark without logging, so a caller's transaction can log once it commits. */
export function moveEventMark(db: Db, upToId: number): { releasedId: number; n: number } {
  const current = getReleasedEventId(db);
  const max = (db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM reef_events').get() as { m: number }).m;
  const releasedId = Math.max(current, Math.min(upToId, max));
  setSetting(db, RELEASED_EVENT_KEY, String(releasedId));
  const n = (db.prepare('SELECT COUNT(*) AS n FROM reef_events WHERE id > ? AND id <= ?')
    .get(current, releasedId) as { n: number }).n;
  return { releasedId, n };
}

type VisitorSource = ReefVisitorError['source'];
const VISITOR_SOURCES: VisitorSource[] = ['github', 'jira'];
const visitorErrorKey = (source: VisitorSource) => `visitorError_${source}`;

/** Null message = the fetch succeeded, which clears any recorded failure. True when the shown error appeared, changed or cleared. */
export function recordVisitorFetch(db: Db, source: VisitorSource, message: string | null, at: number): boolean {
  const key = visitorErrorKey(source);
  const before = getSetting(db, key);
  if (message === null) {
    if (before === null) return false;
    deleteSetting(db, key);
    return true;
  }
  setSetting(db, key, JSON.stringify({ message, at }));
  return before === null || storedMessage(before) !== message;
}

function storedMessage(raw: string): unknown {
  try {
    return (JSON.parse(raw) as { message?: unknown } | null)?.message;
  } catch {
    return undefined;
  }
}

export function visitorErrors(db: Db): ReefVisitorError[] {
  return VISITOR_SOURCES.flatMap((source) => {
    const raw = getSetting(db, visitorErrorKey(source));
    if (raw === null) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = undefined;
    }
    const valid = ReefVisitorError.safeParse({ source, ...(parsed as object) });
    if (valid.success) return [valid.data];
    // Stay visible without failing /pending, which would block releases.
    console.error(`[reef] corrupt visitor error ${visitorErrorKey(source)}: ${raw.slice(0, 80)}`);
    return [{ source, message: 'corrupt stored visitor error', at: 0 }];
  });
}

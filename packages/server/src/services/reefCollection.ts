import {
  RarityValue,
  type ReefCatchesByDate,
  type ReefCollection,
  type ReefLegendaryRow,
  type ReefSpeciesRow,
} from '@gtr/shared';
import type { Db } from '../store/db.ts';
import { deriveCatch, deriveName, type CatchColumns } from './reefRows.ts';
import { getReleasedCatchId } from './reefState.ts';

export function reefCollection(db: Db): ReefCollection {
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
  ).all(releasedId).map((r) => deriveName(r as unknown as ReefSpeciesRow));
  const legendary = db.prepare(
    `SELECT species, name, shiny, size, caught_at, depth_tokens, project, NULL AS agent FROM cc_catches
     WHERE rarity = 'legendary' ORDER BY depth_tokens, shiny`,
  ).all() as ReefLegendaryRow[];
  const recent = db.prepare(
    'SELECT * FROM cc_catches ORDER BY caught_at DESC, id DESC LIMIT 30',
  ).all().map((r) => deriveCatch(r as unknown as CatchColumns));
  return { species, legendary, recent };
}

/**
 * Individual catches for one local calendar day ("how many fish did I
 * catch today"), optionally narrowed to a rarity. `date` is a
 * YYYY-MM-DD string in local time; defaults to today.
 */
export function reefCatchesByDate(
  db: Db,
  opts: { date?: string; rarity?: string } = {},
): ReefCatchesByDate {
  const date =
    opts.date ??
    (db.prepare(`SELECT date('now', 'localtime') AS d`).get() as { d: string }).d;
  const rarity = opts.rarity && (RarityValue.options as readonly string[]).includes(opts.rarity) ? opts.rarity : null;

  const catches = db
    .prepare(
      `SELECT * FROM cc_catches
       WHERE date(caught_at, 'unixepoch', 'localtime') = ?
         AND (? IS NULL OR rarity = ?)
       ORDER BY caught_at DESC, id DESC`,
    )
    .all(date, rarity, rarity) as unknown as CatchColumns[];

  return { date, count: catches.length, catches: catches.map(deriveCatch) };
}

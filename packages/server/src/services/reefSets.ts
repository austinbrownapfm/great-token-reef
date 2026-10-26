import { BACKDROP_FOR_WATER, DECOR_FOR_FAMILY, setsCompletedBy, type FishSet, type ReefDecorBody, type ReefRewards } from '@gtr/shared';
import type { Db } from '../store/db.ts';
import { emitReefEvent, getReleasedEventId } from './reefEvents.ts';
import { getSetting, setSetting } from './settings.ts';

// Set rewards: completion emits a `set` event into the waiting queue, and every
// reward stays hidden until the player releases that event (spec §1, §4).

export type SetReward = { type: 'badge' } | { type: 'decor'; item: string } | { type: 'backdrop'; item: string };

export type { ReefRewards };

const BACKDROP_KEY = 'backdrop';
const OPEN_WATER = 'open-water';
const BACKDROPS = new Set<string>(Object.values(BACKDROP_FOR_WATER));

function rewardFor(set: FishSet): SetReward {
  const [, key] = set.id.split(':') as [string, string];
  if (set.level === 'family') return { type: 'decor', item: DECOR_FOR_FAMILY[key]! };
  if (set.level === 'water') return { type: 'backdrop', item: BACKDROP_FOR_WATER[key as keyof typeof BACKDROP_FOR_WATER] };
  return { type: 'badge' };
}

export function checkSetCompletions(db: Db, at: number): number {
  const caught = new Set(
    (db.prepare(`SELECT DISTINCT species FROM cc_catches WHERE rarity != 'legendary'`).all() as { species: number }[])
      .map((r) => r.species),
  );
  const insertDecor = db.prepare(
    `INSERT OR IGNORE INTO reef_decor (item, shown, x_frac, earned_event_id, earned_at) VALUES (?, 1, NULL, ?, ?)`,
  );
  let emitted = 0;
  for (const set of setsCompletedBy(caught)) {
    const reward = rewardFor(set);
    // SAVEPOINT, not BEGIN: the Codex batch path already holds a transaction.
    db.exec('SAVEPOINT reef_set');
    let id: number | null;
    try {
      id = emitReefEvent(db, 'set', set.id, { setId: set.id, level: set.level, label: set.label, reward }, at);
      if (id !== null && reward.type !== 'badge') insertDecor.run(reward.item, id, at);
      db.exec('RELEASE reef_set');
    } catch (err) {
      db.exec('ROLLBACK TO reef_set');
      db.exec('RELEASE reef_set');
      throw err;
    }
    if (id === null) continue;
    emitted++;
    console.log(`[reef] set complete ${set.id} → ${reward.type}${reward.type === 'badge' ? '' : ` ${reward.item}`} (event ${id})`);
  }
  if (emitted > 0) console.log(`[reef] ${emitted} sets completed from ${caught.size} caught entries`);
  return emitted;
}

function releasedItems(db: Db): { item: string; shown: number; x_frac: number | null }[] {
  return db.prepare(
    'SELECT item, shown, x_frac FROM reef_decor WHERE earned_event_id <= ? ORDER BY earned_event_id, item',
  ).all(getReleasedEventId(db)) as { item: string; shown: number; x_frac: number | null }[];
}

export function reefRewards(db: Db): ReefRewards {
  const released = getReleasedEventId(db);
  const badges = (db.prepare(
    `SELECT ref FROM reef_events WHERE kind = 'set' AND ref LIKE 'species:%' AND id <= ? ORDER BY id`,
  ).all(released) as { ref: string }[]).map((r) => r.ref);
  const items = releasedItems(db);
  const backdrops = items.filter((r) => BACKDROPS.has(r.item)).map((r) => r.item);
  const decor = items
    .filter((r) => !BACKDROPS.has(r.item))
    .map((r) => ({ item: r.item, shown: r.shown === 1, xFrac: r.x_frac }));
  const chosen = getSetting(db, BACKDROP_KEY);
  const activeBackdrop = chosen && backdrops.includes(chosen) ? chosen : OPEN_WATER;
  return { badges, decor, backdrops, activeBackdrop };
}

/** Null when the item is not a released decor piece; `changed` is false for an empty patch. */
export function setReefDecor(
  db: Db, item: string, patch: ReefDecorBody,
): { rewards: ReefRewards; changed: boolean } | null {
  if (BACKDROPS.has(item) || !releasedItems(db).some((r) => r.item === item)) return null;
  if (patch.shown === undefined && patch.xFrac === undefined) return { rewards: reefRewards(db), changed: false };
  db.prepare('UPDATE reef_decor SET shown = COALESCE(?, shown), x_frac = COALESCE(?, x_frac) WHERE item = ?')
    .run(patch.shown === undefined ? null : patch.shown ? 1 : 0, patch.xFrac ?? null, item);
  console.log(`[reef] decor ${item} updated: ${JSON.stringify(patch)}`);
  return { rewards: reefRewards(db), changed: true };
}

/** Null unless the backdrop is open water or a released one. */
export function setReefBackdrop(db: Db, backdrop: string): ReefRewards | null {
  if (backdrop !== OPEN_WATER && !reefRewards(db).backdrops.includes(backdrop)) return null;
  setSetting(db, BACKDROP_KEY, backdrop);
  console.log(`[reef] backdrop set to ${backdrop}`);
  return reefRewards(db);
}

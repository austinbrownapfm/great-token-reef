import { FISH_CAPS, fishPickSchema, type FishPicks, type FishView } from '@gtr/shared';
import type { Db } from '../store/db.ts';
import { getReleasedCatchId } from './reef.ts';
import { getSetting, setSetting } from './settings.ts';

export { FISH_CAPS, type FishView };

const KEYS: Record<FishView, string> = { strip: 'fishStrip', full: 'fishFull' };
const OTHER: Record<FishView, FishView> = { strip: 'full', full: 'strip' };

function read(db: Db, view: FishView): number[] | null {
  const raw = getSetting(db, KEYS[view]);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  const valid = fishPickSchema(view).safeParse(parsed);
  if (valid.success) return valid.data;
  console.error(`[reef] corrupt fish pick ${KEYS[view]}: ${raw.slice(0, 80)}`);
  throw new Error(`corrupt fish pick ${KEYS[view]}`);
}

export function reefFishPicks(db: Db): FishPicks {
  return { strip: read(db, 'strip'), full: read(db, 'full') };
}

/** Throws (nothing written) when the other view's stored row is corrupt; a corrupt row for this view is replaced. */
export function setReefFishPick(db: Db, view: FishView, species: number[]): number[] | { error: string } {
  if (!species.every(Number.isInteger)) return { error: 'species must be integers' };
  if (new Set(species).size !== species.length) return { error: 'species must not repeat' };
  if (species.length > FISH_CAPS[view]) return { error: `at most ${FISH_CAPS[view]} fish for ${view}` };
  const caught = new Set(
    (db.prepare(`SELECT DISTINCT species FROM cc_catches WHERE id <= ?`)
      .all(getReleasedCatchId(db)) as { species: number }[]).map((r) => r.species),
  );
  const missing = species.filter((s) => !caught.has(s));
  if (missing.length > 0) return { error: `not caught yet: ${missing.join(', ')}` };
  read(db, OTHER[view]);
  setSetting(db, KEYS[view], JSON.stringify(species));
  console.log(`[reef] fish pick ${view} (${species.length})`);
  return species;
}

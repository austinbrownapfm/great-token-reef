import type { ReefSpeciesRow } from './api';
import { FISH_CAPS, seedPick, type FishView } from './tankPicks';

// Inventory → Fish section (docs/superpowers/specs/2026-10-22-reef-fish-picker-design.md): list edits for the two picks.

/** What an unset pick opens with: the automatic roster at each view's default population. */
export const FISH_SEED_POPULATION: Record<FishView, number> = { strip: 8, full: 28 };

/** Released caught fish not already in the list, by case-insensitive name substring and optional rarity, A to Z. */
export function searchFish(rows: ReefSpeciesRow[], query: string, rarity: string | null, exclude: Set<number>): ReefSpeciesRow[] {
  const q = query.trim().toLowerCase();
  return rows
    .filter((r) => r.rarity !== 'legendary' && !exclude.has(r.species))
    .filter((r) => (rarity === null || r.rarity === rarity) && r.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name) || a.species - b.species);
}

/** Appends `id`; the same list back when it is already there or the list is at the cap. */
export function addFish(list: number[], id: number, cap: number): number[] {
  return list.includes(id) || list.length >= cap ? list : [...list, id];
}

export function removeFish(list: number[], id: number): number[] {
  return list.includes(id) ? list.filter((x) => x !== id) : list;
}

/** A copy with the item at `from` moved to `to` (clamped); the same list back when nothing moves. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length) return list;
  const target = Math.max(0, Math.min(list.length - 1, to));
  if (target === from) return list;
  const out = list.filter((_, i) => i !== from);
  out.splice(target, 0, list[from] as T);
  return out;
}

/** The list an edit starts from: the saved pick, or for an unset view the roster the tank shows by default. */
export function startingPick(pick: number[] | null, released: ReefSpeciesRow[], view: FishView): number[] {
  return pick ?? seedPick(released, FISH_SEED_POPULATION[view], FISH_CAPS[view]);
}

/** Where a dragged row drops, as an index in the list without it: how many other rows' midpoints sit above `y`. */
export function dropIndex(y: number, rows: ({ top: number; height: number } | null)[], from: number, length: number): number {
  return rows.reduce((n, r, i) => {
    if (!r || i === from || i >= length) return n;
    return y > r.top + r.height / 2 ? n + 1 : n;
  }, 0);
}

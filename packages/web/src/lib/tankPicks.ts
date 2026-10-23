import { FISH_CAPS, type FishView } from '@gtr/shared';
import type { ReefFishPicks, ReefPending, ReefSpeciesRow } from './api';
import type { ReleaseStep } from './tankRelease';

// Hand-picked tank fish (docs/superpowers/specs/2026-10-22-reef-fish-picker-design.md): one list per view.

export { FISH_CAPS, type FishView };

export interface RosterFish {
  species: number;
  shiny: boolean;
  name: string;
  rarity: ReefSpeciesRow['rarity'];
  bestSize: number;
  count: number;
  firstCaught: number;
  firstProject: string;
}

export const RARITY_RANK: Record<string, number> = { epic: 0, rare: 1, uncommon: 2, common: 3, legendary: 4 };

// One fish per species, drawn shiny if any shiny of it was caught.
function toRoster(s: ReefSpeciesRow): RosterFish {
  return {
    species: s.species,
    shiny: s.shiny_count > 0,
    name: s.name,
    rarity: s.rarity,
    bestSize: s.best_size,
    count: s.count,
    firstCaught: s.first_caught,
    firstProject: s.first_project,
  };
}

/** The automatic roster: rarest first so epics and shinies always swim; ties go to the latest catch. */
export function pickRoster(species: ReefSpeciesRow[], n: number): RosterFish[] {
  return [...species]
    .filter((s) => s.rarity !== 'legendary')
    .sort((a, b) => (RARITY_RANK[a.rarity] ?? 9) - (RARITY_RANK[b.rarity] ?? 9) || b.last_caught - a.last_caught)
    .slice(0, n)
    .map(toRoster);
}

/** Picked fish in pick order (capped), then this session's guests on top of the cap; ids not in `species` are skipped. */
export function rosterFromPick(species: ReefSpeciesRow[], pick: number[], guests: number[], cap: number): RosterFish[] {
  const rows = new Map(species.filter((s) => s.rarity !== 'legendary').map((s) => [s.species, s]));
  const picked = [...new Set(pick)].flatMap((id) => rows.get(id) ?? []).slice(0, cap);
  const used = new Set(picked.map((s) => s.species));
  const extra = guests.flatMap((id) => {
    const s = rows.get(id);
    if (!s || used.has(id)) return [];
    used.add(id);
    return [s];
  });
  return [...picked, ...extra].map(toRoster);
}

/** A view's first pick: exactly what the automatic roster shows at that view's population, clamped to the cap. */
export function seedPick(species: ReefSpeciesRow[], population: number, cap: number): number[] {
  return pickRoster(species, population).slice(0, cap).map((r) => r.species);
}

/** Guests after a release's "+N more" step: first-ever species among the held catches that got no step of their own. */
export function overflowGuests(held: ReefPending['all'], shownIds: Set<number>, known: Set<number>, guests: number[]): number[] {
  const have = new Set(guests);
  const extra: number[] = [];
  for (const h of held) {
    if (shownIds.has(h.id) || h.rarity === 'legendary' || known.has(h.species) || have.has(h.species)) continue;
    have.add(h.species);
    extra.push(h.species);
  }
  return extra.length ? [...guests, ...extra] : guests;
}

/** Guests after a release step: a drop adds its species, the "+N more" step adds first-ever overflow species (see overflowGuests). */
export function guestsAfterStep(
  step: ReleaseStep, guests: number[], held: ReefPending['all'], shownIds: Set<number>, known: Set<number>,
): number[] {
  if (step.kind === 'more') return overflowGuests(held, shownIds, known, guests);
  if (step.kind !== 'drop' || guests.includes(step.catch.species)) return guests;
  return [...guests, step.catch.species];
}

/** The tank knows which fish it shows: the picks answered and this view has a pick, or the failure chip is up. */
export function picksSettled(fish: { data: ReefFishPicks | undefined; isError: boolean }, pick: number[] | null, picksFailed: boolean): boolean {
  return (!!fish.data || fish.isError) && (pick !== null || picksFailed);
}

/** A view's one-time seed may run: unset, not yet seeded, picks fresh, data in, the release queue healthy, no release running. */
export function seedReady(s: {
  unset: boolean; alreadySeeded: boolean; picksError: boolean; picksFresh: boolean; dataReady: boolean; queueError: boolean; releasing: boolean;
}): boolean {
  // A failed pending leaves unreleased catches unmasked, and a seed would save them into the pick for good.
  return s.unset && !s.alreadySeeded && !s.picksError && s.picksFresh && s.dataReady && !s.queueError && !s.releasing;
}

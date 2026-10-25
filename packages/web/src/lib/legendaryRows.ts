import { LEGENDARY_DEFS, LEGENDARY_ID_BASE, legendaryAwards, legendaryThreshold, nextLegendary, type LegendaryAward } from '@gtr/shared';
import type { ReefCollection, ReefSpeciesRow } from './api';

type LegendaryCatch = ReefCollection['legendary'][number];

/** One species row per legendary, so the tank, picker and plaque treat it like any caught species. */
export function legendaryRows(catches: LegendaryCatch[]): ReefSpeciesRow[] {
  const rows = new Map<number, ReefSpeciesRow>();
  for (const c of catches) {
    const r = rows.get(c.species);
    if (!r) {
      rows.set(c.species, {
        species: c.species, name: c.name, rarity: 'legendary', count: 1, shiny_count: c.shiny ? 1 : 0,
        best_size: c.size, first_caught: c.caught_at, last_caught: c.caught_at, first_project: c.project, released_best_size: null,
      });
      continue;
    }
    r.count++;
    r.shiny_count += c.shiny ? 1 : 0;
    r.best_size = Math.max(r.best_size, c.size);
    if (c.caught_at < r.first_caught) {
      r.first_caught = c.caught_at;
      r.first_project = c.project;
    }
    r.last_caught = Math.max(r.last_caught, c.caught_at);
  }
  return [...rows.values()];
}

/** Dev-only `?reefLegends=preview`: every legendary, regular and shiny, as if caught. */
export function previewLegendary(): LegendaryCatch[] {
  return LEGENDARY_DEFS.flatMap((d, i) =>
    [0, 1].map((shiny) => ({
      species: LEGENDARY_ID_BASE + i, name: d.name, shiny, size: 0, caught_at: 1_700_000_000 + i * 86_400 + shiny,
      depth_tokens: 0, project: '/preview',
    })),
  );
}

/** Catalog species plus legendary rows; with `preview`, the legendaries are the made-up set. */
export function allSpecies(col: Pick<ReefCollection, 'species' | 'legendary'>, preview: boolean): ReefSpeciesRow[] {
  return [...col.species, ...legendaryRows(preview ? previewLegendary() : col.legendary)];
}

/** The one tier a collection slot shows: shiny once caught, else the regular, with the next threshold to chase. */
export function legendarySlot(catches: LegendaryCatch[], index: number): { shiny: boolean; caught: LegendaryCatch | undefined; next: number | null } {
  const mine = catches.filter((c) => c.species === LEGENDARY_ID_BASE + index);
  const shiny = mine.find((c) => c.shiny);
  if (shiny) return { shiny: true, caught: shiny, next: null };
  const regular = mine.find((c) => !c.shiny);
  return { shiny: false, caught: regular, next: legendaryThreshold(index, !!regular) };
}

/** Where the ladder stands: from the last threshold passed to the next award, as a percentage. */
export function legendaryProgress(ladderTokens: number): { from: number; next: LegendaryAward | null; pct: number } {
  const from = legendaryAwards(ladderTokens).at(-1)?.threshold ?? 0;
  const next = nextLegendary(ladderTokens);
  if (!next) return { from, next: null, pct: 100 };
  return { from, next, pct: Math.min(100, Math.max(0, ((ladderTokens - from) / (next.threshold - from)) * 100)) };
}

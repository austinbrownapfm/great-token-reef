// The Reef — deterministic fish, v2: real species (Reef Dex, approved
// 2026-08-27; roster: docs/reef-dex-roster.md; plan: docs/reef-dex-plan.md.
// v1 procedural design record: .superpowers/brainstorm/cc-usage-20260818/).
//
// One implementation shared by server and web so both derive identical fish
// from a catch seed: the server picks species/rarity/shiny/size when a catch
// is recorded; the web renders the SVG. The catalog has 256 entries — 48 real
// species × real variant forms (life stages, regional phases, pigment
// morphs); the entry index is the `species` column in cc_catches.
// A given entry always looks the same — art derives from the catalog, never
// the catch seed — so the collection reads like a field guide.

import {
  ENTRIES,
  SPECIES_DEFS,
  resolveEntry,
  type Palette,
  type Water,
} from './fishCatalog.ts';
import * as art from './fishArt.ts';
import { LEGENDARY_DEFS, isLegendary, legendaryIndex } from './legendaries.ts';
import { LEGENDARY_LOOKS, LEGENDARY_PLANS } from './legendaryArt.ts';

export { ENTRIES, SPECIES_DEFS, resolveEntry } from './fishCatalog.ts';
export type { Palette, Water, CatalogEntryData, FishSpeciesDef } from './fishCatalog.ts';
export {
  BACKDROP_FOR_WATER,
  DECOR_FOR_FAMILY,
  FAMILY_LABEL,
  FISH_SETS,
  setProgress,
  setsCompletedBy,
  setsContaining,
} from './fishSets.ts';
export type { FishSet, SetLevel } from './fishSets.ts';

// ---------------------------------------------------------------------------
// Seeded RNG (FNV-1a hash → mulberry32). Never Math.random(): catches must be
// reproducible from the JSONL alone.

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function seededRng(seed: string): () => number {
  let a = hashString(seed);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Species space. Rarity is explicit per catalog entry (real color morphs ARE
// the rarity ladder); depth tiers change which rarity you ROLL, then an entry
// is drawn from that rarity's pool. Distribution (149/60/35/12) only paces
// collection completion — catch odds come from TIER_WEIGHTS.

export const SPECIES_COUNT = ENTRIES.length; // 256 — permanent

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export function speciesName(species: number): string {
  if (isLegendary(species)) return LEGENDARY_DEFS[legendaryIndex(species)]!.name;
  return resolveEntry(species).name;
}

export function speciesRarity(species: number): Rarity {
  if (isLegendary(species)) return 'legendary';
  return ENTRIES[species]!.r;
}

/** Full field-guide info for a catalog entry (collection detail view). */
export function speciesInfo(species: number): {
  name: string; base: string; sci: string; morph: string | null;
  water: Water; rarity: Rarity; marks: string; baseSpecies: number;
} {
  if (isLegendary(species)) {
    const d = LEGENDARY_DEFS[legendaryIndex(species)]!;
    return {
      name: d.name, base: d.name, sci: d.sci, morph: null,
      water: 'salt', rarity: 'legendary', marks: '', baseSpecies: species,
    };
  }
  const { def, entry, name } = resolveEntry(species);
  return {
    name, base: def.name, sci: def.sci, morph: entry.m,
    water: def.water, rarity: entry.r, marks: def.marks, baseSpecies: entry.s,
  };
}

const POOLS: Record<Exclude<Rarity, 'legendary'>, number[]> = {
  common: [], uncommon: [], rare: [], epic: [],
};
for (let i = 0; i < SPECIES_COUNT; i++) POOLS[ENTRIES[i]!.r].push(i);

/** Rarity roll weights per depth tier (catch index within a session). */
const TIER_WEIGHTS: [number, number, number, number][] = [
  [0.70, 0.24, 0.05, 0.01], // tier 0 — shallows (2M)
  [0.50, 0.30, 0.15, 0.05], // tier 1 — reef (8M)
  [0.30, 0.35, 0.25, 0.10], // tier 2 — drop-off (32M)
  [0.10, 0.30, 0.35, 0.25], // tier 3+ — abyss (128M+)
];

export interface CatchRoll {
  species: number;
  name: string;
  rarity: Rarity;
  shiny: boolean;
  /** cm; scales with depth tier, drives the personal-best mechanic. */
  size: number;
}

/**
 * Roll a catch. Deterministic: same seed + tier → same fish, forever.
 * Draw order (rarity → species → shiny → size) is load-bearing — do not
 * reorder or add draws before `size`. The entry's size bias (juvenile /
 * trophy form) multiplies the size AFTER the draws, keeping the seed
 * contract intact.
 */
export function rollCatch(seed: string, tier: number): CatchRoll {
  const rng = seededRng(seed);
  const weights = TIER_WEIGHTS[Math.min(tier, TIER_WEIGHTS.length - 1)]!;
  const x = rng();
  let acc = 0;
  let rarity: Exclude<Rarity, 'legendary'> = 'epic';
  const names = ['common', 'uncommon', 'rare', 'epic'] as const;
  for (let i = 0; i < 4; i++) {
    acc += weights[i]!;
    if (x < acc) { rarity = names[i]!; break; }
  }
  const pool = POOLS[rarity];
  const species = pool[Math.floor(rng() * pool.length)]!;
  const shiny = rng() < 1 / 64;
  const bias = ENTRIES[species]!.b;
  const sizeMul = bias === 's' ? 0.5 : bias === 'L' ? 1.6 : 1;
  const size = Math.round((14 + tier * 12 + rng() * 26) * sizeMul * 10) / 10;
  return { species, name: speciesName(species), rarity, shiny, size };
}

// ---------------------------------------------------------------------------
// Rendering. Art derives from the catalog entry (body plan + palette); shiny
// is an iridescent sheen overlay on any form, independent of the morph.

const PLANS: Record<string, art.PlanBuilder> = {
  bass: art.bass,
  panfish: art.panfish,
  salmonid: art.salmonid,
  catfish: art.catfish,
  reef: art.reef,
  pelagic: art.pelagic,
  pike: art.pike,
  gar: art.gar,
  carp: art.carp,
  sturgeon: art.sturgeon,
  eel: art.eel,
  heavy: art.heavy,
  flatfish: art.flatfish,
  mahi: art.mahi,
  billfish: art.billfish,
  wrasse: art.wrasse,
  lionfish: art.lionfish,
  puffer: art.puffer,
  shark: art.shark,
  ray: art.ray,
  seahorse: art.seahorse,
};

function shinySheen(id: string): string {
  return `<defs><linearGradient id="${id}-sh" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0.25" stop-color="#ffffff" stop-opacity="0"/>
    <stop offset="0.42" stop-color="#fff6d8" stop-opacity="0.34"/>
    <stop offset="0.5" stop-color="#d8f4ff" stop-opacity="0.4"/>
    <stop offset="0.58" stop-color="#ffe2f4" stop-opacity="0.3"/>
    <stop offset="0.75" stop-color="#ffffff" stop-opacity="0"/>
  </linearGradient>
  <mask id="${id}-shm" mask-type="alpha" style="mask-type:alpha"><use href="#${id}-fish"/></mask></defs>
  <rect x="0" y="0" width="320" height="180" fill="url(#${id}-sh)" mask="url(#${id}-shm)"/>
  <text x="284" y="34" font-size="16">✨</text>`;
}

/**
 * SVG for a catalog entry (viewBox 0 0 320 180, fish faces left). `idPrefix`
 * must be unique per rendered instance — gradient ids are global in HTML.
 */
export function fishSvg(species: number, shiny: boolean, idPrefix: string): string {
  const id = `nbf-${idPrefix}`;
  let svg: string;
  if (isLegendary(species)) {
    const i = legendaryIndex(species);
    const { palette, planOpts } = LEGENDARY_LOOKS[i]!;
    svg = LEGENDARY_PLANS[LEGENDARY_DEFS[i]!.plan](id, palette, planOpts);
  } else {
    const { def, palette, planOpts } = resolveEntry(species);
    const builder = PLANS[def.plan] ?? art.bass;
    svg = builder(id, palette as Palette, planOpts);
  }
  if (shiny) {
    // The sheen is masked to the fish's own outline, so the artwork goes in a referenceable group.
    const open = svg.slice(0, svg.indexOf('>') + 1);
    const inner = svg.slice(open.length, svg.lastIndexOf('</svg>'));
    svg = `${open}<g id="${id}-fish">${inner}</g>${shinySheen(id)}</svg>`;
  }
  return svg;
}

// ---------------------------------------------------------------------------
// Depth milestones. Calibrated 2026-08-18: a LIGHT day is ~22M total
// tokens (cache included), so the ladder
// starts at 2M and quadruples: 2M, 8M, 32M, 128M, 512M, … A normal session
// lands 1–2 catches; the abyss tier is a genuine event.

export const MILESTONE_BASE = 2_000_000;
export const MILESTONE_FACTOR = 4;

export function milestoneAt(index: number, base = MILESTONE_BASE, factor = MILESTONE_FACTOR): number {
  return base * factor ** index;
}

/** How many catches a session with `totalTokens` has earned. */
export function catchesEarned(totalTokens: number, base = MILESTONE_BASE, factor = MILESTONE_FACTOR): number {
  let n = 0;
  while (totalTokens >= milestoneAt(n, base, factor)) n++;
  return n;
}

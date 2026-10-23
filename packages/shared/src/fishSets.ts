// Collection sets derived from the catalog, so new entries join their sets without a hand list.

import { ENTRIES, SPECIES_DEFS, type Water } from './fishCatalog.ts';

export type SetLevel = 'species' | 'family' | 'water';

export interface FishSet {
  id: string;
  level: SetLevel;
  label: string;
  /** Catalog entry indices (0..255) in the set. */
  readonly entries: readonly number[];
}

export const FAMILY_LABEL: Record<string, string> = {
  bass: 'Bass & perch',
  panfish: 'Sunfish',
  salmonid: 'Trout & salmon',
  catfish: 'Catfish',
  reef: 'Reef fish',
  pelagic: 'Tuna',
  pike: 'Pike & barracuda',
  gar: 'Gar',
  carp: 'Carp',
  sturgeon: 'Sturgeon',
  eel: 'Eels',
  heavy: 'Heavy-bodied fish',
  flatfish: 'Flatfish',
  mahi: 'Mahi-mahi',
  billfish: 'Billfish',
  wrasse: 'Wrasses & parrotfish',
  lionfish: 'Lionfish',
  puffer: 'Pufferfish',
  shark: 'Sharks',
  ray: 'Rays',
  seahorse: 'Seahorses',
};

const WATER_LABEL: Record<Water, string> = {
  fresh: 'Freshwater',
  salt: 'Saltwater',
  anadromous: 'Sea-run',
};

export const DECOR_FOR_FAMILY: Record<string, string> = {
  bass: 'rowboat',
  panfish: 'tackle-box',
  salmonid: 'log',
  catfish: 'barrel',
  reef: 'treasure-chest',
  pelagic: 'buoy',
  pike: 'canoe',
  gar: 'old-boot',
  carp: 'pagoda',
  sturgeon: 'stone-arch',
  eel: 'amphora',
  heavy: 'lobster-pot',
  flatfish: 'anchor',
  mahi: 'surfboard',
  billfish: 'ship-wheel',
  wrasse: 'giant-clam',
  lionfish: 'cannon',
  puffer: 'diver-helmet',
  shark: 'shipwreck',
  ray: 'treasure-map',
  seahorse: 'castle',
};

export const BACKDROP_FOR_WATER: Record<Water, string> = {
  fresh: 'river-rock',
  salt: 'coral-wall',
  anadromous: 'kelp-forest',
};

function buildSets(): FishSet[] {
  const groups = new Map<string, FishSet & { entries: number[] }>();
  const add = (id: string, level: SetLevel, label: string, entry: number) => {
    let set = groups.get(id);
    if (!set) groups.set(id, (set = { id, level, label, entries: [] }));
    set.entries.push(entry);
  };
  ENTRIES.forEach((e, i) => {
    const def = SPECIES_DEFS[e.s]!;
    add(`species:${e.s}`, 'species', def.name, i);
    add(`family:${def.plan}`, 'family', FAMILY_LABEL[def.plan] ?? def.plan, i);
    add(`water:${def.water}`, 'water', WATER_LABEL[def.water], i);
  });
  const order: Record<SetLevel, number> = { species: 0, family: 1, water: 2 };
  return [...groups.values()].sort((a, b) => order[a.level] - order[b.level]);
}

export const FISH_SETS: FishSet[] = buildSets();

const SETS_BY_ENTRY: FishSet[][] = ENTRIES.map(() => []);
for (const set of FISH_SETS) for (const e of set.entries) SETS_BY_ENTRY[e]!.push(set);

export function setProgress(set: FishSet, caught: Set<number>): { have: number; total: number } {
  let have = 0;
  for (const e of set.entries) if (caught.has(e)) have++;
  return { have, total: set.entries.length };
}

export function setsCompletedBy(caught: Set<number>): FishSet[] {
  return FISH_SETS.filter((s) => s.entries.every((e) => caught.has(e)));
}

export function setsContaining(entry: number): readonly FishSet[] {
  return SETS_BY_ENTRY[entry] ?? [];
}

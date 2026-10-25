import { describe, expect, it } from 'vitest';
import {
  BACKDROP_FOR_WATER,
  DECOR_FOR_FAMILY,
  FAMILY_LABEL,
  ENTRIES,
  FISH_SETS,
  SPECIES_COUNT,
  SPECIES_DEFS,
  setProgress,
  setsCompletedBy,
  setsContaining,
  type SetLevel,
} from './fish.ts';

const ALL = new Set(Array.from({ length: SPECIES_COUNT }, (_, i) => i));
const byLevel = (level: SetLevel) => FISH_SETS.filter((s) => s.level === level);

describe('fish sets', () => {
  it('derives 48 species, 21 family and 3 water sets', () => {
    expect(byLevel('species')).toHaveLength(48);
    expect(byLevel('family')).toHaveLength(21);
    expect(byLevel('water')).toHaveLength(3);
    expect(FISH_SETS).toHaveLength(72);
    expect(new Set(FISH_SETS.map((s) => s.id)).size).toBe(72);
  });

  it('places every entry in exactly one set per level', () => {
    for (const level of ['species', 'family', 'water'] as const) {
      const seen = new Map<number, number>();
      for (const s of byLevel(level)) for (const e of s.entries) seen.set(e, (seen.get(e) ?? 0) + 1);
      expect(seen.size).toBe(SPECIES_COUNT);
      for (const n of seen.values()) expect(n).toBe(1);
    }
  });

  it('keys ids and membership off the catalog', () => {
    const def = SPECIES_DEFS[ENTRIES[0]!.s]!;
    const ids = setsContaining(0).map((s) => s.id).sort();
    expect(ids).toEqual([`family:${def.plan}`, `species:${ENTRIES[0]!.s}`, `water:${def.water}`].sort());
    const sp = FISH_SETS.find((s) => s.id === 'species:0')!;
    expect(sp.label).toBe(SPECIES_DEFS[0]!.name);
    expect(sp.entries).toEqual(ENTRIES.flatMap((e, i) => (e.s === 0 ? [i] : [])));
  });

  it('hands out sets callers cannot mutate', () => {
    const sets = setsContaining(0);
    // @ts-expect-error readonly: the shared index must not be mutated by a caller
    expect(() => sets.push(sets[0]!)).toBeTypeOf('function');
    // @ts-expect-error readonly entries
    expect(() => sets[0]!.entries.push(1)).toBeTypeOf('function');
  });

  it('completes all 72 sets when everything is caught, none when nothing is', () => {
    expect(setsCompletedBy(ALL)).toHaveLength(72);
    expect(setsCompletedBy(new Set())).toHaveLength(0);
  });

  it('completes a species set only when every one of its entries is caught', () => {
    const sp = FISH_SETS.find((s) => s.id === 'species:0')!;
    const caught = new Set(sp.entries);
    expect(setsCompletedBy(caught).map((s) => s.id)).toEqual(['species:0']);
    caught.delete(sp.entries[0]!);
    expect(setsCompletedBy(caught)).toHaveLength(0);
    expect(setProgress(sp, caught)).toEqual({ have: sp.entries.length - 1, total: sp.entries.length });
  });

  it('has a readable label for every plan in the catalog', () => {
    const plans = new Set(SPECIES_DEFS.map((d) => d.plan));
    expect(Object.keys(FAMILY_LABEL).sort()).toEqual([...plans].sort());
    for (const s of byLevel('family')) expect(s.label).toBe(FAMILY_LABEL[s.id.slice('family:'.length)]);
  });

  it('maps every family to a distinct decor item and every water to its backdrop', () => {
    const plans = byLevel('family').map((s) => s.id.slice('family:'.length));
    expect(Object.keys(DECOR_FOR_FAMILY).sort()).toEqual([...plans].sort());
    const keys = Object.values(DECOR_FOR_FAMILY);
    expect(new Set(keys).size).toBe(21);
    for (const k of keys) expect(k).toMatch(/^[a-z]+(-[a-z]+)*$/);
    expect(BACKDROP_FOR_WATER).toEqual({ fresh: 'river-rock', salt: 'coral-wall', anadromous: 'kelp-forest' });
  });
});

import { describe, expect, it } from 'vitest';
import {
  ENTRIES,
  SPECIES_COUNT,
  SPECIES_DEFS,
  fishSvg,
  resolveEntry,
  rollCatch,
  speciesInfo,
  speciesName,
  speciesRarity,
} from './fish.ts';

describe('Reef Dex catalog', () => {
  it('has exactly 256 permanent entries over 48 species', () => {
    expect(SPECIES_COUNT).toBe(256);
    expect(SPECIES_DEFS).toHaveLength(48);
    const referenced = new Set(ENTRIES.map((e) => e.s));
    expect(referenced.size).toBe(48);
    for (const e of ENTRIES) expect(SPECIES_DEFS[e.s]).toBeDefined();
  });

  it('every species has a real length and a fact', () => {
    for (const d of SPECIES_DEFS) {
      expect(d.lengthCm, d.name).toBeGreaterThanOrEqual(5);
      expect(d.lengthCm, d.name).toBeLessThanOrEqual(800);
      expect(d.fact.length, d.name).toBeGreaterThanOrEqual(20);
      expect(d.fact.length, d.name).toBeLessThanOrEqual(140);
      expect(d.fact, d.name).not.toBe(d.marks);
    }
    const len = (n: string) => SPECIES_DEFS.find((d) => d.name === n)!.lengthCm;
    expect(len('Lined Seahorse')).toBeLessThan(20);
    expect(len('Giant Manta Ray')).toBeGreaterThan(400);
    expect(len('Bluegill')).toBeLessThan(30);
    expect(len('Lake Sturgeon')).toBeGreaterThan(100);
  });

  it('keeps the reviewed rarity distribution (149/60/35/12)', () => {
    const counts = { common: 0, uncommon: 0, rare: 0, epic: 0 };
    for (let i = 0; i < SPECIES_COUNT; i++) counts[speciesRarity(i) as keyof typeof counts]++;
    expect(counts).toEqual({ common: 149, uncommon: 60, rare: 35, epic: 12 });
  });

  it('names every entry: morph-prefixed, standard = plain species name', () => {
    for (let i = 0; i < SPECIES_COUNT; i++) {
      const { entry, def, name } = resolveEntry(i);
      expect(name).toBe(entry.m ? `${entry.m} ${def.name}` : def.name);
      expect(name).not.toContain('undefined');
    }
  });

  it('resolves a palette and known body plan for every entry', () => {
    const knownPlans = new Set(['bass', 'panfish', 'pike', 'catfish', 'carp', 'salmonid',
      'sturgeon', 'eel', 'gar', 'heavy', 'flatfish', 'pelagic', 'mahi', 'billfish', 'reef',
      'wrasse', 'lionfish', 'puffer', 'shark', 'ray', 'seahorse']);
    for (let i = 0; i < SPECIES_COUNT; i++) {
      const { def, palette } = resolveEntry(i);
      expect(knownPlans.has(def.plan)).toBe(true);
      for (const k of ['back', 'mid', 'belly', 'fin', 'mark'] as const) {
        expect(palette[k]).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it('renders a well-formed SVG for every entry, plus the shiny sheen', () => {
    for (let i = 0; i < SPECIES_COUNT; i++) {
      const svg = fishSvg(i, false, `t${i}`);
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg.endsWith('</svg>')).toBe(true);
      expect(svg).toContain(`nbf-t${i}-b`); // instance-unique gradient id
    }
    expect(fishSvg(0, true, 's')).toContain('nbf-s-sh');
  });

  it('masks the shiny sheen to the fish outline instead of the whole canvas', () => {
    for (let i = 0; i < SPECIES_COUNT; i++) {
      const svg = fishSvg(i, true, `m${i}`);
      expect(svg).toContain(`<g id="nbf-m${i}-fish">`);
      expect(svg).toContain(`<use href="#nbf-m${i}-fish"/>`);
      expect(svg).toContain(`mask="url(#nbf-m${i}-shm)"`);
      expect(svg.endsWith('</svg>')).toBe(true);
    }
  });

  it('albino entries get the red eye; melanistic stays dark', () => {
    const albino = ENTRIES.findIndex((e) => e.m === 'Albino' && e.s === 0);
    expect(resolveEntry(albino).palette.iris).toBe('#d24a4a');
    const mel = ENTRIES.findIndex((e) => e.m === 'Melanistic');
    const { palette } = resolveEntry(mel);
    expect(parseInt(palette.back.slice(1, 3), 16)).toBeLessThan(0x40);
  });

  it('every morph-override key matches a real catalog entry (rename guard)', async () => {
    const { MORPH_PALETTES, MORPH_PLAN_OPTS } = await import('./fishCatalog.ts');
    const valid = new Set(
      ENTRIES.filter((e) => e.m).map((e) => `${SPECIES_DEFS[e.s]!.name}|${e.m}`),
    );
    for (const key of [...Object.keys(MORPH_PALETTES), ...Object.keys(MORPH_PLAN_OPTS)]) {
      expect(valid.has(key), `orphaned morph-override key: ${key}`).toBe(true);
    }
  });

  it('variants of a species draw differently unless they differ only by size', () => {
    const seen = new Map<string, number>();
    ENTRIES.forEach((e, i) => {
      if (e.b) return;
      const key = `${e.s}|${fishSvg(i, false, 'x')}`;
      expect(seen.has(key), `${speciesName(i)} draws the same as ${speciesName(seen.get(key) ?? i)}`).toBe(false);
      seen.set(key, i);
    });
  });

  it('no entry name contains the word "Phase"', () => {
    for (let i = 0; i < SPECIES_COUNT; i++) expect(speciesName(i)).not.toMatch(/\bPhase\b/);
  });

  it('speciesInfo exposes field-guide data', () => {
    const info = speciesInfo(0);
    expect(info.base).toBe('Largemouth Bass');
    expect(info.sci).toBe('Micropterus nigricans');
    expect(info.marks).toContain('Jaw hinge');
  });
});

describe('rollCatch (v2)', () => {
  it('is deterministic and rarity-consistent with the catalog', () => {
    for (const seed of ['session-a#0', 'session-a#1', 'weird#seed#3']) {
      for (let tier = 0; tier < 4; tier++) {
        const a = rollCatch(seed, tier);
        const b = rollCatch(seed, tier);
        expect(b).toEqual(a);
        expect(speciesRarity(a.species)).toBe(a.rarity);
        expect(a.name).toBe(speciesName(a.species));
        expect(a.size).toBeGreaterThan(0);
      }
    }
  });

  it('applies size bias: juvenile forms roll small, trophy forms large', () => {
    // Scan seeds until we hit a juvenile ('s') and a trophy ('L') entry, then
    // verify the multiplier against the un-biased size formula bounds.
    let sawS = false, sawL = false;
    for (let i = 0; i < 4000 && !(sawS && sawL); i++) {
      const roll = rollCatch(`bias-scan#${i}`, 1);
      const bias = ENTRIES[roll.species]!.b;
      if (bias === 's') { expect(roll.size).toBeLessThanOrEqual(26); sawS = true; }
      if (bias === 'L') { expect(roll.size).toBeGreaterThanOrEqual(41.6); sawL = true; }
    }
    expect(sawS && sawL).toBe(true);
  });

  it('locks the draw contract for known seeds (regression pin)', () => {
    // If this test breaks, the seed contract broke: historical catches would
    // no longer reproduce. Never "fix" it by updating the numbers — fix the
    // draw order instead. (Pinned when v2 shipped.)
    const pin = [0, 1, 2, 3].map((t) => rollCatch('reef-dex-v2-pin#0', t));
    expect(pin).toEqual([
      { species: 232, name: 'Red Lionfish', rarity: 'uncommon', shiny: false, size: 36 },
      { species: 232, name: 'Red Lionfish', rarity: 'uncommon', shiny: false, size: 48 },
      { species: 242, name: 'Banana Moray (Xanthic) Green Moray', rarity: 'rare', shiny: false, size: 60 },
      { species: 250, name: 'Giant Manta Ray', rarity: 'epic', shiny: false, size: 72 },
    ]);
  });
});

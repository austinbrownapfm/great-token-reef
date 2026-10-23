import { describe, expect, it } from 'vitest';
import { fishSvg } from './fish.ts';
import { LEGENDARY_DEFS, LEGENDARY_ID_BASE } from './legendaries.ts';

const ids = LEGENDARY_DEFS.map((_, i) => LEGENDARY_ID_BASE + i);

describe('legendary art', () => {
  it('draws every legendary, plain and shiny, as clean SVG with instance-unique ids', () => {
    expect(ids).toHaveLength(12);
    for (const species of ids) {
      for (const shiny of [false, true]) {
        const prefix = `lg${species}${shiny ? 's' : 'n'}`;
        const svg = fishSvg(species, shiny, prefix);
        expect(svg.startsWith('<svg'), `${species}`).toBe(true);
        expect(svg.endsWith('</svg>'), `${species}`).toBe(true);
        expect(svg).toContain('viewBox="0 0 320 180"');
        expect(svg).not.toMatch(/undefined|NaN/);
        const allIds = [...svg.matchAll(/\bid="([^"]*)"/g)].map((m) => m[1]!);
        expect(allIds.length, `${species}`).toBeGreaterThan(0);
        for (const id of allIds) expect(id.startsWith(`nbf-${prefix}-`), `${species}: ${id}`).toBe(true);
        if (shiny) {
          expect(svg).toContain(`<g id="nbf-${prefix}-fish">`);
          expect(svg).toContain(`<mask id="nbf-${prefix}-shm"`);
          expect(svg).toContain(`mask="url(#nbf-${prefix}-shm)"`);
        }
      }
    }
  });

  it('gives each legendary its own art', () => {
    const plain = ids.map((species) => fishSvg(species, false, 'same'));
    expect(new Set(plain).size).toBe(plain.length);
  });

  it('labels each drawing with the creature name', () => {
    ids.forEach((species, i) => {
      expect(fishSvg(species, false, 'l')).toContain(`aria-label="${LEGENDARY_DEFS[i]!.name}"`);
    });
  });
});

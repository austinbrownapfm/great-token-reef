import { describe, expect, it } from 'vitest';
import { ENTRIES, SPECIES_DEFS } from '@gtr/shared';
import type { ReefSpeciesRow } from './api';
import { hold, spawn, step, type Swimmer } from './tankSim';
import { hudReserve, isPlaqueEscape, keepHeld, plaqueFor, plaqueLines, plaquePlace, shouldClosePlaque } from './tankPlaque';
import { hiddenCatches, releasedRows } from './tankRelease';

const bassEntries = ENTRIES.flatMap((e, i) => (e.s === 0 ? [i] : []));

function row(species: number, over: Partial<ReefSpeciesRow> = {}): ReefSpeciesRow {
  return {
    species, name: 'Largemouth Bass', rarity: 'uncommon', count: 3, shiny_count: 0,
    best_size: 47, first_caught: 1_790_000_000, last_caught: 1_800_000_000,
    first_project: '/p/my-app', released_best_size: 47, ...over,
  };
}

describe('plaqueLines', () => {
  it('carries the species name, scientific name, marks and fact', () => {
    const lines = plaqueLines(bassEntries[0]!, row(bassEntries[0]!), new Set());
    const def = SPECIES_DEFS[0]!;
    expect(lines.name).toBe('Largemouth Bass');
    expect(lines.sci).toBe(def.sci);
    expect(lines.marks).toBe(def.marks);
    expect(lines.fact).toBe(def.fact);
    expect(lines.fact.length).toBeGreaterThan(10);
    expect(lines.rarity).toBe('uncommon');
  });

  it('counts species-set progress from the caught entries', () => {
    expect(bassEntries).toHaveLength(10);
    const caught = new Set([...bassEntries.slice(0, 6), 200, 201]);
    const lines = plaqueLines(bassEntries[0]!, row(bassEntries[0]!), caught);
    expect(lines.set).toBe('Largemouth Bass set: 6 of 10');
    expect(lines.setDone).toBe(false);
    const all = plaqueLines(bassEntries[0]!, row(bassEntries[0]!), new Set(bassEntries));
    expect(all.set).toBe('Largemouth Bass set: 10 of 10');
    expect(all.setDone).toBe(true);
  });

  it('formats personal best, count and first catch with the project basename', () => {
    const lines = plaqueLines(bassEntries[0]!, row(bassEntries[0]!), new Set());
    expect(lines.best).toBe('47 cm');
    expect(lines.count).toBe('×3');
    expect(lines.first).toMatch(/my-app$/);
    expect(lines.first).not.toContain('/Users');
    expect(plaqueLines(bassEntries[0]!, row(bassEntries[0]!, { first_project: '' }), new Set()).first).not.toContain(' in ');
  });

  it('marks a shiny row', () => {
    expect(plaqueLines(bassEntries[0]!, row(bassEntries[0]!, { shiny_count: 1 }), new Set()).shiny).toBe(true);
    expect(plaqueLines(bassEntries[0]!, row(bassEntries[0]!), new Set()).shiny).toBe(false);
  });
});

describe('plaqueFor (the tank call site)', () => {
  // The tank's path: pending past the mark → hidden → releasedRows → plaqueFor.
  const bass = bassEntries.slice(0, 4);
  const species = bass.map((e) => row(e, { count: 1 }));
  const pendingOf = (e: number, id: number) => ({ id, species: e, shiny: 0, rarity: 'uncommon' });

  it('counts set progress from released entries only, so a pending catch never spoils it', () => {
    const pending = [pendingOf(bass[3]!, 9)];
    const rows = releasedRows(species, hiddenCatches(pending, 0, []), new Map(), false);
    expect(plaqueFor(bass[0], rows)!.set).toBe('Largemouth Bass set: 3 of 10');
    // Once released (the mark passes it), the same catch counts.
    const after = releasedRows(species, hiddenCatches(pending, 9, []), new Map(), false);
    expect(plaqueFor(bass[0], after)!.set).toBe('Largemouth Bass set: 4 of 10');
  });

  it('a catch a running release still holds stays out too', () => {
    const rows = releasedRows(species, hiddenCatches([], 9, [pendingOf(bass[2]!, 8)]), new Map(), false);
    expect(plaqueFor(bass[0], rows)!.set).toBe('Largemouth Bass set: 3 of 10');
  });

  it('has no plaque for a still-pending species, no fish, or an unknown queue', () => {
    const rows = releasedRows(species, [pendingOf(bass[3]!, 9)], new Map(), false);
    expect(plaqueFor(bass[3], rows)).toBeNull();
    expect(plaqueFor(undefined, rows)).toBeNull();
    expect(plaqueFor(bass[0], releasedRows(species, [], new Map(), true))).toBeNull();
  });
});

describe('plaquePlace', () => {
  const bounds = { width: 800, height: 224 };
  const size = { w: 240, h: 180 };

  it('sits to the right of the fish, vertically centred, when there is room', () => {
    const p = plaquePlace({ x: 200, y: 112, width: 80, height: 45 }, size, bounds);
    expect(p.side).toBe('right');
    expect(p.left).toBe(200 + 40 + 12);
    expect(p.top).toBe(112 - 90);
  });

  it('flips to the left near the right wall', () => {
    const p = plaquePlace({ x: 700, y: 112, width: 80, height: 45 }, size, bounds);
    expect(p.side).toBe('left');
    expect(p.left).toBe(700 - 40 - 12 - 240);
  });

  it('clamps inside the tank on both axes', () => {
    const top = plaquePlace({ x: 200, y: 10, width: 80, height: 45 }, size, bounds);
    expect(top.top).toBe(8);
    const bottom = plaquePlace({ x: 200, y: 220, width: 80, height: 45 }, size, bounds);
    expect(bottom.top).toBe(224 - 180 - 8);
    const narrow = plaquePlace({ x: 150, y: 112, width: 200, height: 112 }, size, { width: 300, height: 224 });
    expect(narrow.left).toBeGreaterThanOrEqual(8);
    expect(narrow.left + size.w).toBeLessThanOrEqual(300 - 8);
  });

  it('pins to the top margin when the plaque is taller than the tank', () => {
    const p = plaquePlace({ x: 200, y: 112, width: 80, height: 45 }, { w: 240, h: 400 }, bounds);
    expect(p.top).toBe(8);
  });
});

describe('plaquePlace never covers the fish', () => {
  const big = { width: 1400, height: 900 };
  const size = { w: 300, h: 330 };
  type Box = { x: number; y: number; width: number; height: number };
  const overlaps = (f: Box, p: { left: number; top: number }) =>
    p.left < f.x + f.width / 2 && p.left + size.w > f.x - f.width / 2 &&
    p.top < f.y + f.height / 2 && p.top + size.h > f.y - f.height / 2;
  const inside = (p: { left: number; top: number }, b: { width: number; height: number }, reserve = 0) =>
    p.left >= 8 && p.top >= 8 && p.left + size.w <= b.width - 8 && p.top + size.h <= b.height - 8 - reserve;
  const cases: [string, Box][] = [
    ['middle', { x: 700, y: 450, width: 220, height: 124 }],
    ['long gar in the middle', { x: 700, y: 450, width: 760, height: 120 }],
    ['very long fish spanning the tank', { x: 700, y: 450, width: 1100, height: 150 }],
    ['near the left wall', { x: 90, y: 450, width: 160, height: 90 }],
    ['near the right wall', { x: 1320, y: 450, width: 160, height: 90 }],
    ['near the top', { x: 700, y: 60, width: 220, height: 124 }],
    ['near the bottom', { x: 700, y: 840, width: 220, height: 124 }],
    ['top-left corner', { x: 80, y: 50, width: 140, height: 80 }],
    ['bottom-right corner', { x: 1330, y: 850, width: 140, height: 80 }],
  ];
  for (const [label, fish] of cases) {
    it(`stays clear of the fish: ${label}`, () => {
      const p = plaquePlace(fish, size, big);
      expect(overlaps(fish, p)).toBe(false);
      expect(inside(p, big)).toBe(true);
    });
  }

  it('prefers the roomier side', () => {
    expect(plaquePlace({ x: 400, y: 450, width: 200, height: 100 }, size, big).side).toBe('right');
    expect(plaquePlace({ x: 1000, y: 450, width: 200, height: 100 }, size, big).side).toBe('left');
    expect(plaquePlace({ x: 700, y: 300, width: 1100, height: 100 }, size, big).side).toBe('below');
    expect(plaquePlace({ x: 700, y: 600, width: 1100, height: 100 }, size, big).side).toBe('above');
  });

  it('keeps clear of a reserved bottom band (fullscreen HUD)', () => {
    const fish = { x: 700, y: 820, width: 220, height: 124 };
    const p = plaquePlace(fish, size, big, 110);
    expect(inside(p, big, 110)).toBe(true);
    expect(overlaps(fish, p)).toBe(false);
  });

  it('keeps clear of a reserved top band (fullscreen HUD)', () => {
    for (const fish of [{ x: 700, y: 140, width: 220, height: 124 }, { x: 120, y: 160, width: 160, height: 90 }]) {
      const p = plaquePlace(fish, size, big, 0, 120);
      expect(p.top).toBeGreaterThanOrEqual(120);
      expect(overlaps(fish, p)).toBe(false);
    }
  });

  it('in a tank too small to avoid the fish, falls back to above/below', () => {
    const p = plaquePlace({ x: 150, y: 112, width: 260, height: 140 }, { w: 240, h: 180 }, { width: 300, height: 224 });
    expect(['above', 'below']).toContain(p.side);
    expect(p.left).toBeGreaterThanOrEqual(8);
    expect(p.top).toBeGreaterThanOrEqual(8);
  });
});

describe('keepHeld', () => {
  const spec = { id: 'g', width: 160, cruise: 60, depth: [0.3, 0.7] as [number, number], hoverBias: 0.5, dartBias: 0.5, habit: 'default' as const };
  const r = () => 0.5;
  const midTurn = (): Swimmer => {
    const [s] = spawn([spec], { width: 1200, height: 600 }, r, 0);
    s!.mode = 'turn';
    s!.turnStart = 0;
    s!.turnFrom = s!.heading;
    s!.resume = null;
    s!.modeUntil = 3;
    return s!;
  };

  it('a fish held mid-turn ends up held once the turn completes', () => {
    const s = midTurn();
    hold(s, true, 0.1);
    expect(s.mode).toBe('turn');
    let now = 0.1;
    for (let i = 0; i < 90; i++) {
      step([s], { width: 1200, height: 600 }, 1 / 60, r, (now += 1 / 60));
      keepHeld(s, now);
    }
    expect(s.mode).toBe('hover');
    expect(s.modeUntil).toBe(Number.POSITIVE_INFINITY);
  });

  it('without it the turn ends in a cruise (the bug)', () => {
    const s = midTurn();
    hold(s, true, 0.1);
    let now = 0.1;
    for (let i = 0; i < 90; i++) step([s], { width: 1200, height: 600 }, 1 / 60, r, (now += 1 / 60));
    expect(s.modeUntil).not.toBe(Number.POSITIVE_INFINITY);
  });
});

// Stand-ins for DOM nodes: a holder contains itself and its listed children.
const node = (name: string) => ({ name }) as unknown as Node;
const holder = (...kids: Node[]) => ({ contains: (n: Node | null) => n !== null && kids.includes(n) });

describe('shouldClosePlaque', () => {
  const inTank = node('water');
  const inPlaque = node('dex link');
  const page = node('nav');
  const tank = holder(inTank, inPlaque);
  const plaque = holder(inPlaque);
  it('closes for a press anywhere outside the tank and plaque', () => {
    expect(shouldClosePlaque(page, tank, plaque)).toBe(true);
  });
  it('leaves presses inside the tank or plaque to their own handlers', () => {
    expect(shouldClosePlaque(inTank, tank, plaque)).toBe(false);
    expect(shouldClosePlaque(inPlaque, tank, plaque)).toBe(false);
    expect(shouldClosePlaque(inPlaque, holder(), plaque)).toBe(false);
  });
});

describe('isPlaqueEscape', () => {
  const body = node('body');
  const fish = node('fish');
  const palette = node('palette input');
  const tank = holder(fish);
  const esc = (target: Node | null, over: Partial<{ key: string; defaultPrevented: boolean }> = {}) =>
    isPlaqueEscape({ key: 'Escape', defaultPrevented: false, target, ...over }, tank, body);
  it('takes Esc from inside the tank or with nothing focused', () => {
    expect(esc(fish)).toBe(true);
    expect(esc(body)).toBe(true);
  });
  it('leaves other keys, handled presses and Esc from elsewhere on the page alone', () => {
    expect(esc(fish, { key: 'Enter' })).toBe(false);
    expect(esc(fish, { defaultPrevented: true })).toBe(false);
    expect(esc(palette)).toBe(false);
  });
});

describe('hudReserve', () => {
  it('is the band bottom when the band is laid out, else nothing', () => {
    expect(hudReserve({ offsetTop: 12, offsetHeight: 80 } as HTMLElement)).toBe(92);
    expect(hudReserve({ offsetTop: 12, offsetHeight: 0 } as HTMLElement)).toBe(0);
    expect(hudReserve(null)).toBe(0);
  });
});

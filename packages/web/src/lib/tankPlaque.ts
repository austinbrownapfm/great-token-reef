import { ENTRIES, LEGENDARY_DEFS, SPECIES_DEFS, isLegendary, legendaryIndex, setProgress, setsContaining } from '@gtr/shared';
import type { ReefSpeciesRow } from './api';
import { formatDate } from './format';
import type { Bounds } from './tankMotion';
import { hold, type Swimmer } from './tankSim';

export interface PlaqueLines {
  name: string;
  sci: string;
  marks: string;
  fact: string;
  rarity: ReefSpeciesRow['rarity'];
  shiny: boolean;
  best: string;
  count: string;
  first: string;
  set: string;
  setDone: boolean;
}

// `caught` must hold released catalog entries only, so a pending catch never spoils set progress.
export function plaqueLines(entry: number, row: ReefSpeciesRow, caught: Set<number>): PlaqueLines {
  const def = isLegendary(entry) ? { ...LEGENDARY_DEFS[legendaryIndex(entry)]!, marks: '' } : SPECIES_DEFS[ENTRIES[entry]?.s ?? -1];
  const set = setsContaining(entry).find((s) => s.level === 'species');
  const { have, total } = set ? setProgress(set, caught) : { have: 0, total: 0 };
  const project = row.first_project.split('/').filter(Boolean).pop();
  return {
    name: row.name,
    sci: def?.sci ?? '',
    marks: def?.marks ?? '',
    fact: def?.fact ?? '',
    rarity: row.rarity,
    shiny: row.shiny_count > 0,
    best: `${row.best_size} cm`,
    count: `×${row.count}`,
    first: `${formatDate(row.first_caught)}${project ? ` in ${project}` : ''}`,
    set: set ? `${set.label} set: ${have} of ${total}` : '',
    setDone: total > 0 && have === total,
  };
}

/** A swimming fish's plaque from the released rows (releasedRows); null once its species is no longer among them. */
export function plaqueFor(species: number | undefined, released: ReefSpeciesRow[]): PlaqueLines | null {
  const row = species === undefined ? undefined : released.find((m) => m.species === species);
  return row ? plaqueLines(row.species, row, new Set(released.map((m) => m.species))) : null;
}

const GAP = 12;
const MARGIN = 8;

export type PlaqueSide = 'left' | 'right' | 'above' | 'below';

// Beside the fish without covering it: roomier of left/right, then above/below; overlap only when nothing fits.
export function plaquePlace(
  fish: { x: number; y: number; width: number; height: number },
  size: { w: number; h: number },
  bounds: { width: number; height: number },
  reserveBottom = 0,
  reserveTop = 0,
): { left: number; top: number; side: PlaqueSide } {
  const minX = MARGIN;
  const maxX = bounds.width - MARGIN;
  const minY = MARGIN + reserveTop;
  const maxY = bounds.height - MARGIN - reserveBottom;
  const fl = fish.x - fish.width / 2;
  const fr = fish.x + fish.width / 2;
  const ft = fish.y - fish.height / 2;
  const fb = fish.y + fish.height / 2;
  const clampX = (x: number) => Math.min(Math.max(minX, maxX - size.w), Math.max(minX, x));
  const clampY = (y: number) => Math.min(Math.max(minY, maxY - size.h), Math.max(minY, y));
  const fitsTall = size.h <= maxY - minY;
  const fitsWide = size.w <= maxX - minX;
  const across: { side: PlaqueSide; room: number; x: number }[] = [
    { side: 'right', room: maxX - fr, x: fr + GAP },
    { side: 'left', room: fl - minX, x: fl - GAP - size.w },
  ];
  const updown: { side: PlaqueSide; room: number; y: number }[] = [
    { side: 'below', room: maxY - fb, y: fb + GAP },
    { side: 'above', room: ft - minY, y: ft - GAP - size.h },
  ];
  const byRoom = <T extends { room: number }>(a: T[]) => [...a].sort((p, q) => q.room - p.room);
  const out = (left: number, top: number, side: PlaqueSide) => ({ left: Math.round(left), top: Math.round(top), side });
  for (const c of byRoom(across)) {
    if (fitsTall && c.room >= size.w + GAP) return out(c.x, clampY(fish.y - size.h / 2), c.side);
  }
  const vertical = byRoom(updown);
  for (const c of vertical) {
    if (fitsWide && c.room >= size.h + GAP) return out(clampX(fish.x - size.w / 2), c.y, c.side);
  }
  const best = vertical[0]!;
  return out(clampX(fish.x - size.w / 2), clampY(best.y), best.side);
}

// hold() ignores a fish mid-turn, so the loop re-pins a plaque's fish until it is truly held.
export function keepHeld(s: Swimmer, now: number): void {
  if (s.mode !== 'hover' || s.modeUntil !== Number.POSITIVE_INFINITY) hold(s, true, now);
}

// Transform, not left/top, so following the fish every frame never triggers layout.
export function placePlaque(el: HTMLElement, s: Swimmer, b: Bounds, reserveTop: number, size = { w: el.offsetWidth, h: el.offsetHeight }) {
  const p = plaquePlace(s, size, b, 0, reserveTop);
  const t = `translate(${p.left}px, ${p.top}px)`;
  if (el.style.transform !== t) el.style.transform = t;
}

// The fullscreen HUD band across the top, which the plaque keeps clear of.
export function hudReserve(hud: HTMLElement | null): number {
  return hud && hud.offsetHeight > 0 ? hud.offsetTop + hud.offsetHeight : 0;
}

interface Holder { contains(other: Node | null): boolean }

// Clicks inside the tank have their own handling (feed, other fish); only the rest of the page closes the plaque.
export function shouldClosePlaque(target: Node | null, tank: Holder | null, plaque: Holder | null): boolean {
  return !tank?.contains(target) && !plaque?.contains(target);
}

// Esc from the tank or with nothing focused (target = body) is the plaque's; Esc from elsewhere (e.g. the palette) is not.
export function isPlaqueEscape(
  e: { key: string; defaultPrevented: boolean; target: Node | null },
  tank: Holder | null,
  body: Node | null,
): boolean {
  if (e.key !== 'Escape' || e.defaultPrevented) return false;
  return e.target === body || !!tank?.contains(e.target);
}

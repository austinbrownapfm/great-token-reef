import { setsContaining } from '@gtr/shared';
import type { ReefEvent, ReefRewards } from './api';

// Set rewards in the tank (living-tank spec §4): decor registry, sand layout and set-event parsing; the art is components/TankDecor.tsx.

/** Base size in px at scenery scale 1; the art's viewBox is `0 0 w h`, foot on y = h. */
export interface DecorMeta { label: string; w: number; h: number }

export const DECOR_META: Record<string, DecorMeta> = {
  rowboat: { label: 'Rowboat', w: 120, h: 46 },
  'tackle-box': { label: 'Tackle box', w: 66, h: 44 },
  log: { label: 'Sunken log', w: 132, h: 38 },
  barrel: { label: 'Barrel', w: 58, h: 62 },
  'treasure-chest': { label: 'Treasure chest', w: 66, h: 54 },
  buoy: { label: 'Buoy', w: 48, h: 84 },
  canoe: { label: 'Canoe', w: 144, h: 36 },
  'old-boot': { label: 'Old boot', w: 58, h: 52 },
  pagoda: { label: 'Pagoda', w: 64, h: 90 },
  'stone-arch': { label: 'Stone arch', w: 112, h: 72 },
  amphora: { label: 'Amphora', w: 50, h: 72 },
  'lobster-pot': { label: 'Lobster pot', w: 84, h: 56 },
  anchor: { label: 'Anchor', w: 66, h: 84 },
  surfboard: { label: 'Surfboard', w: 44, h: 100 },
  'ship-wheel': { label: "Ship's wheel", w: 74, h: 74 },
  'giant-clam': { label: 'Giant clam', w: 84, h: 48 },
  cannon: { label: 'Cannon', w: 104, h: 48 },
  'diver-helmet': { label: 'Diving helmet', w: 62, h: 66 },
  shipwreck: { label: 'Shipwreck', w: 210, h: 96 },
  'treasure-map': { label: 'Treasure map', w: 72, h: 40 },
  castle: { label: 'Castle', w: 104, h: 104 },
};

export const OPEN_WATER = 'open-water';

export const BACKDROP_META: Record<string, { label: string }> = {
  [OPEN_WATER]: { label: 'Open water' },
  'river-rock': { label: 'River rock' },
  'coral-wall': { label: 'Coral wall' },
  'kelp-forest': { label: 'Kelp forest' },
};

/** Minimum distance between two auto-placed pieces, px. */
export const DECOR_GAP = 60;
/** Extra clearance past a rock's half-width before a piece may sit there. */
const ROCK_PAD = 20;
const CANDIDATES = 96;
const GOLDEN = 0.6180339887;

/**
 * Shown pieces only, in input order. A saved `xFrac` is used as is; the rest take the first free
 * spot of a fixed golden-ratio sequence (off the rocks, ≥ DECOR_GAP from every placed piece), so a
 * new piece never moves an earlier one. Hidden pieces keep their spots reserved, so hiding one never
 * moves another. A tank too crowded for that gets the roomiest spot left.
 */
export function layoutDecor(
  decor: ReefRewards['decor'],
  width: number,
  rocks: { x: number; w: number }[] = [],
): { item: string; x: number }[] {
  if (width <= 0) return [];
  const taken = decor.flatMap((d) => (d.xFrac === null ? [] : [d.xFrac * width]));
  const lo = Math.min(width / 2, Math.max(24, width * 0.04));
  const span = width - 2 * lo;
  const spots = Array.from({ length: CANDIDATES }, (_, k) => lo + ((0.5 + k * GOLDEN) % 1) * span);
  const clear = (x: number) => rocks.every((r) => Math.abs(x - r.x) > r.w / 2 + ROCK_PAD);
  const room = (x: number) => taken.reduce((m, t) => Math.min(m, Math.abs(x - t)), Infinity);
  const placed = decor.map((d) => {
    if (d.xFrac !== null) return { item: d.item, x: d.xFrac * width, shown: d.shown };
    let x = spots.find((s) => clear(s) && room(s) >= DECOR_GAP);
    if (x === undefined) {
      const pool = spots.some(clear) ? spots.filter(clear) : spots;
      x = pool.reduce((best, s) => (room(s) > room(best) ? s : best), pool[0]!);
    }
    taken.push(x);
    return { item: d.item, x, shown: d.shown };
  });
  return placed.filter((p) => p.shown).map(({ item, x }) => ({ item, x }));
}

/** Same scenery scale as the rocks (TankRocks rocksFor): shrinks with a short strip, bigger in fullscreen. */
export function decorSize(item: string, height: number, fullscreen: boolean): { w: number; h: number } {
  const meta = DECOR_META[item] ?? { label: item, w: 60, h: 60 };
  const scale = fullscreen ? 1.6 : Math.min(1, Math.max(0.5, height / 360));
  return { w: meta.w * scale, h: meta.h * scale };
}

export interface DecorPlacement { item: string; x: number; w: number; h: number; left: number; top: number }

/** Pieces on the sand in tank px; the foot sinks a little so the sand strip covers it, like the rocks. */
export function placeDecor(
  decor: ReefRewards['decor'],
  bounds: { width: number; height: number },
  floor: number,
  fullscreen: boolean,
  rocks: { x: number; w: number }[] = [],
): DecorPlacement[] {
  const base = bounds.height - floor + 5;
  return layoutDecor(decor, bounds.width, rocks).map(({ item, x }) => {
    const { w, h } = decorSize(item, bounds.height, fullscreen);
    return { item, x, w, h, left: x - w / 2, top: base - h };
  });
}

/** Where reef fish and groupers linger: just above a piece's middle. */
export function decorAnchor(p: DecorPlacement): { x: number; y: number } {
  return { x: p.x, y: p.top + p.h * 0.35 };
}

export type SetReward = { type: 'badge' } | { type: 'decor'; item: string } | { type: 'backdrop'; item: string };
export interface SetRewardEvent { setId: string; level: string; label: string; reward: SetReward }

/** The `set` event payload (server reefSets.ts), or null when it is not one. */
export function setRewardOf(event: ReefEvent): SetRewardEvent | null {
  const p = event.payload as Record<string, unknown> | null;
  if (!p || typeof p !== 'object' || typeof p.setId !== 'string') return null;
  const r = p.reward as Record<string, unknown> | null | undefined;
  if (!r || typeof r !== 'object') return null;
  let reward: SetReward;
  if (r.type === 'badge') reward = { type: 'badge' };
  else if ((r.type === 'decor' || r.type === 'backdrop') && typeof r.item === 'string') reward = { type: r.type, item: r.item };
  else return null;
  return {
    setId: p.setId,
    level: typeof p.level === 'string' ? p.level : '',
    label: typeof p.label === 'string' && p.label ? p.label : p.setId,
    reward,
  };
}

export function decorKey(item: string): string {
  return `decor:${item}`;
}

/** One key per reward, matching what ReefRewards lists: badges by set id, pieces and backdrops by item. */
export function rewardKey(e: SetRewardEvent): string {
  if (e.reward.type === 'badge') return e.setId;
  return e.reward.type === 'decor' ? decorKey(e.reward.item) : `backdrop:${e.reward.item}`;
}

/** "Nothing held", one shared set so a release clearing its hold does not re-render the page for an equal empty set. */
export const NO_HELD_REWARDS: ReadonlySet<string> = new Set();

/** An empty hold is always NO_HELD_REWARDS. */
export const heldOrNone = (held: ReadonlySet<string>): ReadonlySet<string> => (held.size === 0 ? NO_HELD_REWARDS : held);

/** The rewards a release holds back from its start: one key per set event whose reward reads. */
export function heldRewardsOf(events: ReefEvent[]): ReadonlySet<string> {
  return heldOrNone(new Set(events.flatMap((e) => {
    const r = e.kind === 'set' ? setRewardOf(e) : null;
    return r ? [rewardKey(r)] : [];
  })));
}

/** A reward step lets its own reward go; the rest stay held. */
export function releaseHeldReward(held: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(held);
  next.delete(key);
  return heldOrNone(next);
}

/** What the Dex, the Inventory and the tank may show: earned rewards minus those a running release still holds back for their unveil. */
export function visibleRewards(rewards: ReefRewards, held: ReadonlySet<string>): ReefRewards {
  if (held.size === 0) return rewards;
  const backdrops = rewards.backdrops.filter((b) => !held.has(`backdrop:${b}`));
  return {
    badges: rewards.badges.filter((b) => !held.has(b)),
    decor: rewards.decor.filter((d) => !held.has(decorKey(d.item))),
    backdrops,
    activeBackdrop: held.has(`backdrop:${rewards.activeBackdrop}`) ? OPEN_WATER : rewards.activeBackdrop,
  };
}

export interface BackdropLayer { item: string; id: number; fresh: boolean }

/** The first known backdrop lands as-is; only a later change fades in over the old one. */
export function backdropLayers(layers: BackdropLayer[], active: string | null): BackdropLayer[] {
  if (active === null) return layers;
  const top = layers[layers.length - 1];
  if (!top) return [{ item: active, id: 0, fresh: false }];
  return top.item === active ? layers : [...layers, { item: active, id: top.id + 1, fresh: true }];
}

/** Species set id (`species:<defIndex>`) of a catalog entry. */
export function speciesSetOf(entry: number): string | undefined {
  return setsContaining(entry).find((s) => s.level === 'species')?.id;
}

/** Dev-only `?reefDecor=all` or a comma list of decor keys. */
export function parseDevDecor(v: unknown): string | undefined {
  if (typeof v !== 'string' || !v) return undefined;
  if (v === 'all') return v;
  return v.split(',').every((k) => k in DECOR_META) ? v : undefined;
}

/** Dev-only `?reefBackdrop=<key>`. */
export function parseDevBackdrop(v: unknown): string | undefined {
  return typeof v === 'string' && v in BACKDROP_META ? v : undefined;
}

/** The dev override's pieces, all shown and auto-placed. */
export function devDecor(v: string): ReefRewards['decor'] {
  const keys = v === 'all' ? Object.keys(DECOR_META) : v.split(',');
  return keys.map((item) => ({ item, shown: true, xFrac: null }));
}

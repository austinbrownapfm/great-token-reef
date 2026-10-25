import { BACKDROP_FOR_WATER, DECOR_FOR_FAMILY, FISH_SETS, type FishSet } from '@gtr/shared';
import type { ReefRewards, ReefSpeciesRow } from './api';
import { BACKDROP_META, DECOR_META, OPEN_WATER, decorSize, layoutDecor, visibleRewards } from './tankDecor';

// The Inventory tab (living-tank spec §4): earned decor, backdrops, and what each unfinished set still needs.

export interface LockedSet {
  setId: string;
  label: string;
  /** The decor piece or backdrop the set unlocks; null for a species badge. */
  item: string | null;
  have: number;
  total: number;
  toGo: number;
  /** Every entry released but the set's reward event still waits in the release queue. */
  waiting: boolean;
}

export interface InventoryModel {
  decor: { item: string; label: string; shown: boolean; xFrac: number | null }[];
  /** Unfinished family sets, closest first. */
  locked: LockedSet[];
  /** Open water first, then each water set's backdrop. */
  backdrops: { item: string; label: string; earned: boolean; active: boolean; locked: LockedSet | null }[];
  badges: { earned: string[]; total: number; next: LockedSet[] };
}

const NEXT_BADGES = 5;

function rewardItem(set: FishSet): string | null {
  const key = set.id.slice(set.id.indexOf(':') + 1);
  if (set.level === 'family') return DECOR_FOR_FAMILY[key] ?? null;
  if (set.level === 'water') return BACKDROP_FOR_WATER[key as keyof typeof BACKDROP_FOR_WATER] ?? null;
  return null;
}

const closest = (a: LockedSet, b: LockedSet) => a.toGo - b.toGo || b.have - a.have || a.label.localeCompare(b.label);

/**
 * `caught` is every caught catalog entry, `released` those already released into the tank. Progress
 * counts only entries in both, so a set finished by a pending catch still shows as locked.
 */
export function inventoryModel(rewards: ReefRewards, caught: Set<number>, released: Set<number>): InventoryModel {
  const lock = (set: FishSet): LockedSet => {
    const have = set.entries.filter((e) => caught.has(e) && released.has(e)).length;
    const total = set.entries.length;
    return { setId: set.id, label: set.label, item: rewardItem(set), have, total, toGo: total - have, waiting: have === total };
  };
  const earnedDecor = new Set(rewards.decor.map((d) => d.item));
  const earnedBackdrops = new Set(rewards.backdrops);
  const badges = new Set(rewards.badges);
  const families = FISH_SETS.filter((s) => s.level === 'family');
  const waters = Object.keys(BACKDROP_FOR_WATER).flatMap((w) => FISH_SETS.filter((s) => s.id === `water:${w}`));
  const species = FISH_SETS.filter((s) => s.level === 'species');
  return {
    decor: rewards.decor.map((d) => ({ item: d.item, label: DECOR_META[d.item]?.label ?? d.item, shown: d.shown, xFrac: d.xFrac })),
    locked: families.filter((s) => !earnedDecor.has(rewardItem(s) ?? '')).map(lock).sort(closest),
    backdrops: [
      { item: OPEN_WATER, label: BACKDROP_META[OPEN_WATER]!.label, earned: true, active: rewards.activeBackdrop === OPEN_WATER, locked: null },
      ...waters.map((s) => {
        const item = rewardItem(s)!;
        const earned = earnedBackdrops.has(item);
        return { item, label: BACKDROP_META[item]?.label ?? item, earned, active: rewards.activeBackdrop === item, locked: earned ? null : lock(s) };
      }),
    ],
    badges: {
      earned: rewards.badges,
      total: species.length,
      next: species.filter((s) => !badges.has(s.id)).map(lock).sort(closest).slice(0, NEXT_BADGES),
    },
  };
}

type DecorRow = ReefRewards['decor'][number];

/** Arrange mode starts from every shown piece pinned where it stands, so hiding one never moves the rest. */
export function pinDecor(decor: DecorRow[], width: number, rocks: { x: number; w: number }[] = []): DecorRow[] {
  const at = new Map(layoutDecor(decor, width, rocks).map((p) => [p.item, p.x / width]));
  return decor.map((d) => (d.shown && d.xFrac === null && at.has(d.item) ? { ...d, xFrac: at.get(d.item)! } : d));
}

/** The PUTs that turn `saved` into `draft`; a hidden piece keeps whatever spot it had. */
export function arrangeChanges(saved: DecorRow[], draft: DecorRow[]): { item: string; patch: { shown?: boolean; xFrac?: number } }[] {
  const before = new Map(saved.map((d) => [d.item, d]));
  return draft.flatMap((d) => {
    const b = before.get(d.item);
    if (!b) return [];
    const patch: { shown?: boolean; xFrac?: number } = {};
    if (d.shown !== b.shown) patch.shown = d.shown;
    if (d.shown && d.xFrac !== null && d.xFrac !== b.xFrac) patch.xFrac = d.xFrac;
    return Object.keys(patch).length ? [{ item: d.item, patch }] : [];
  });
}

/** A piece's centre as a fraction of the tank, kept far enough in that the whole piece shows. */
export function clampFrac(x: number, pieceWidth: number, width: number): number {
  const half = Math.min(pieceWidth / 2, width / 2);
  return Math.min(width - half, Math.max(half, x)) / width;
}

/** The `reef.tank.arrange` detail for arrange mode ending; null when one of our own exits (cancel, save) already logged it. */
export function arrangeExitDetail(wasArranging: boolean, ownExit: boolean): string | null {
  return wasArranging && !ownExit ? 'back' : null;
}

/** The Inventory tab's model: held rewards stay out and progress counts `released` rows only (the collection, pending masked out). */
export function releasedInventory(
  rewards: ReefRewards, held: ReadonlySet<string>, species: ReefSpeciesRow[], released: ReefSpeciesRow[],
): InventoryModel {
  return inventoryModel(visibleRewards(rewards, held), new Set(species.map((s) => s.species)), new Set(released.map((s) => s.species)));
}

/** A locked set's progress line. */
export function toGoLabel(l: LockedSet): string {
  return l.waiting ? '🏆 waiting to release' : `${l.toGo} to go`;
}

/** The Inventory header counts; open water is free, so it counts toward neither backdrop number. */
export function inventoryCounts(m: InventoryModel): { decor: number; decorTotal: number; backdrops: number; backdropTotal: number } {
  return {
    decor: m.decor.length,
    decorTotal: m.decor.length + m.locked.length,
    backdrops: m.backdrops.filter((b) => b.earned).length - 1,
    backdropTotal: m.backdrops.length - 1,
  };
}

export type ArrangeStage = 'asked' | 'in' | null;

/** One arrange-mode tick while active: ask for fullscreen once on entry; once in, leaving fullscreen cancels. */
export function arrangeStage(stage: ArrangeStage, fullscreen: boolean): { stage: ArrangeStage; action: 'toggle' | 'cancel' | null } {
  if (fullscreen) return { stage: 'in', action: null };
  if (stage === 'in') return { stage, action: 'cancel' };
  if (stage === null) return { stage: 'asked', action: 'toggle' };
  return { stage, action: null };
}

/** Fraction of the tank an arrow key steps a piece. */
const KEY_STEP = 0.02;

/** A piece's new centre fraction for an arrow key (kept whole in the tank); null for any other key. */
export function arrowNudge(key: string, x: number, pieceWidth: number, width: number): number | null {
  const dir = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0;
  return dir ? clampFrac(x + dir * KEY_STEP * width, pieceWidth, width) : null;
}

type Rect = { left: number; right: number; top: number; bottom: number };

/** Where a piece dragged out of the tray lands, as a centre fraction; null when dropped back on the tray or with no tank. */
export function trayDrop(
  item: string, at: { x: number; y: number }, tray: Rect | undefined, tank: (Rect & { height: number }) | undefined,
  width: number, fullscreen: boolean,
): number | null {
  const inTray = !!tray && at.x >= tray.left && at.x <= tray.right && at.y >= tray.top && at.y <= tray.bottom;
  if (!tank || inTray) return null;
  return clampFrac(at.x - tank.left, decorSize(item, tank.height, fullscreen).w, width);
}

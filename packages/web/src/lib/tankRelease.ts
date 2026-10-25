import type { ReefCatch, ReefEvent, ReefEventKind, ReefPending, ReefSpeciesRow } from './api';

// The waiting queue (living-tank spec §1): pure planning for the release button — fish, visitors and set rewards.

export type ReleaseStep =
  | { kind: 'drop' | 'upgrade' | 'banner'; catch: ReefCatch; pb?: { from: number; to: number } }
  | { kind: 'more'; count: number }
  | { kind: 'visitor'; event: ReefEvent }
  | { kind: 'visitorBatch'; eventKind: 'pr' | 'ticket'; events: ReefEvent[] }
  | { kind: 'reward'; event: ReefEvent };

export type QueueCounts = Record<'fish' | ReefEventKind, number>;

const QUEUE_ORDER = ['fish', 'pr', 'ticket', 'whale', 'set'] as const;
const QUEUE_EMOJI: Record<keyof QueueCounts, string> = { fish: '🎣', pr: '📦', ticket: '🍾', whale: '🐋', set: '🏆' };
/** More than this many PRs (or tickets) in one release fold into a single chest (or bottle). */
const BATCH_OVER = 3;

/** Roster identity of a swimming fish: one per species, plain or shiny. */
export const fishKey = (species: number, shiny: boolean): string => `${species}-${shiny ? 1 : 0}`;

/** Catches kept out of the tank: pending past the released mark plus those a release still holds, each once. */
export function hiddenCatches(pending: ReefPending['all'], mark: number, held: ReefPending['all']): ReefPending['all'] {
  const ids = new Set(held.map((h) => h.id));
  return [...held, ...pending.filter((p) => p.id > mark && !ids.has(p.id))];
}

/**
 * The collection as it was before the pending catches landed. A held species draws at its
 * pre-release best: `bests` (species → best, owned by a running release) else the server's released best.
 */
export function maskCollection(
  species: ReefSpeciesRow[],
  pending: ReefPending['all'],
  bests: Map<number, number> = new Map(),
): ReefSpeciesRow[] {
  const held = new Map<number, { count: number; shiny: number }>();
  for (const p of pending) {
    const h = held.get(p.species) ?? { count: 0, shiny: 0 };
    h.count++;
    if (p.shiny) h.shiny++;
    held.set(p.species, h);
  }
  if (held.size === 0) return species;
  const out: ReefSpeciesRow[] = [];
  for (const s of species) {
    const h = held.get(s.species);
    if (!h) {
      out.push(s);
      continue;
    }
    const count = s.count - h.count;
    if (count <= 0) continue;
    const best = bests.get(s.species) ?? s.released_best_size ?? s.best_size;
    out.push({ ...s, count, shiny_count: Math.max(0, s.shiny_count - h.shiny), best_size: best });
  }
  return out;
}

/**
 * One step per catch, oldest first; `catches` arrive newest first, capped by the server.
 * `known` = catalog entries caught before this release; only a first-ever catch drops in.
 * `prevBest` is each swimming fish's best size before these catches, keyed by `fishKey`.
 */
export function planRelease(
  catches: ReefCatch[],
  total: number,
  swimming: Set<string>,
  known: Set<number>,
  prevBest: Map<string, number>,
): ReleaseStep[] {
  const live = new Set(swimming);
  const seen = new Set(known);
  // best_size is per species, so a plain and a shiny catch grow the same fish.
  const best = new Map<number, number>();
  const steps: ReleaseStep[] = [];
  for (const c of [...catches].reverse()) {
    const key = fishKey(c.species, !!c.shiny);
    const plain = fishKey(c.species, false);
    let step: Extract<ReleaseStep, { catch: ReefCatch }>;
    if (live.has(key)) {
      step = { kind: 'banner', catch: c };
    } else if (c.shiny && live.has(plain)) {
      step = { kind: 'upgrade', catch: c };
      live.delete(plain);
      live.add(key);
    } else if (seen.has(c.species)) {
      step = { kind: 'banner', catch: c };
    } else {
      step = { kind: 'drop', catch: c };
      live.add(key);
    }
    seen.add(c.species);
    if (c.rarity !== 'legendary') {
      const from = best.get(c.species) ?? prevBest.get(fishKey(c.species, true)) ?? prevBest.get(plain);
      if (from !== undefined && c.size > from) step.pb = { from, to: c.size };
      best.set(c.species, Math.max(from ?? c.size, c.size));
    }
    steps.push(step);
  }
  if (total > catches.length) steps.push({ kind: 'more', count: total - catches.length });
  return steps;
}

/** Fish (v3 rules) and events merged oldest first; sets and whales never fold, so a merge day can't bury them. */
export function planQueue(
  catches: ReefCatch[],
  catchTotal: number,
  events: ReefEvent[],
  swimming: Set<string>,
  known: Set<number>,
  prevBest: Map<string, number>,
): ReleaseStep[] {
  // Plan fish in play order (catch time, then id): ingest order can disagree, and PB chains and upgrades depend on order.
  const ordered = [...catches].sort((a, b) => b.caught_at - a.caught_at || b.id - a.id);
  const fish = planRelease(ordered, catchTotal, swimming, known, prevBest);
  const more = fish.filter((s) => s.kind === 'more');
  const timed: { at: number; step: ReleaseStep }[] = fish.flatMap((s) => ('catch' in s ? [{ at: s.catch.caught_at, step: s }] : []));
  const byId = [...events].sort((a, b) => a.id - b.id);
  for (const kind of ['pr', 'ticket'] as const) {
    const group = byId.filter((e) => e.kind === kind);
    if (group.length > BATCH_OVER) {
      timed.push({ at: Math.max(...group.map((e) => e.created_at)), step: { kind: 'visitorBatch', eventKind: kind, events: group } });
    } else {
      for (const e of group) timed.push({ at: e.created_at, step: { kind: 'visitor', event: e } });
    }
  }
  for (const e of byId) {
    if (e.kind === 'whale') timed.push({ at: e.created_at, step: { kind: 'visitor', event: e } });
    else if (e.kind === 'set') timed.push({ at: e.created_at, step: { kind: 'reward', event: e } });
  }
  // Stable sort: on a tie fish come first, then events in the order pushed.
  timed.sort((a, b) => a.at - b.at);
  return [...timed.map((t) => t.step), ...more];
}

export function queueCounts(fish: number, events: ReefEvent[]): QueueCounts {
  const counts: QueueCounts = { fish, pr: 0, ticket: 0, whale: 0, set: 0 };
  for (const e of events) counts[e.kind]++;
  return counts;
}

/** Button label, e.g. `🎣 3 · 📦 1 · 🏆 1`; kinds with nothing waiting are left out. */
export function queueLabel(counts: QueueCounts): string {
  return QUEUE_ORDER.filter((k) => counts[k] > 0).map((k) => `${QUEUE_EMOJI[k]} ${counts[k]}`).join(' · ');
}

/** `reef.tank.release` telemetry detail, e.g. `fish:3 pr:1 set:1 tank`. */
export function releaseDetail(counts: QueueCounts, source: string): string {
  return [...QUEUE_ORDER.filter((k) => counts[k] > 0).map((k) => `${k}:${counts[k]}`), source].join(' ');
}

/** While the release queue (pending) loads or has failed, released fish cannot be told from waiting ones: the tank holds empty. */
export function queueUnknown(pending: { isPending: boolean; isError: boolean }): boolean {
  return pending.isPending || pending.isError;
}

/** Whether the tank may start a release: `autoStart` for the widget's ?release=1 link, `canRelease` for the button. */
export function releaseGates(s: {
  collection: { data: unknown; isError: boolean; isFetchedAfterMount: boolean; isFetching: boolean };
  pending: { isPending: boolean; isError: boolean; isFetchedAfterMount: boolean; isFetching: boolean };
  width: number;
  picksReady: boolean;
}): { dataReady: boolean; autoStart: boolean; canRelease: boolean } {
  const queueHeld = queueUnknown(s.pending);
  // Without the collection every catch would play as a first-ever drop and swim as a guest outside the pick.
  const collectionOk = !!s.collection.data && !s.collection.isError;
  // Fetched since this mount: unmounted queries miss the reef SSE refetch, so cache alone may be stale.
  const dataReady =
    collectionOk && s.collection.isFetchedAfterMount && !s.collection.isFetching &&
    s.pending.isFetchedAfterMount && !s.pending.isFetching && !queueHeld && s.width > 0;
  return { dataReady, autoStart: dataReady && s.picksReady, canRelease: s.picksReady && !queueHeld && collectionOk };
}

export interface ReleaseBatch {
  all: ReefPending['all'];
  events: ReefEvent[];
  catches: ReefCatch[];
  maxId: number;
  maxEventId: number | undefined;
}

/** What a release takes: everything past the fish and event marks; null when nothing waits. */
export function releaseBatch(p: ReefPending, mark: number, eventMark: number): ReleaseBatch | null {
  const all = p.all.filter((a) => a.id > mark);
  const events = (p.events ?? []).filter((e) => e.id > eventMark);
  if (all.length === 0 && events.length === 0) return null;
  return {
    all,
    events,
    catches: p.catches.filter((c) => c.id > mark),
    maxId: all.length ? Math.max(...all.map((a) => a.id)) : p.releasedId,
    maxEventId: events.length ? Math.max(...events.map((e) => e.id)) : undefined,
  };
}

/** The marks once the server answers: never behind what was sent, what the server says, or (events) where they stood. */
export function marksAfterRelease(
  sent: { maxId: number; maxEventId: number | undefined },
  server: { releasedId: number; releasedEventId: number },
  eventMark: number,
): { mark: number; eventMark: number } {
  return {
    mark: Math.max(sent.maxId, server.releasedId),
    eventMark: Math.max(sent.maxEventId ?? 0, server.releasedEventId, eventMark),
  };
}

/** What a step unmasks: "+N more" all it covered, a drop, upgrade or best banner its own catch (and new size); null if nothing. */
export function revealForStep(
  step: ReleaseStep, held: ReefPending['all'], bests: Map<number, number>, shown: Set<number>,
): { held: ReefPending['all']; bests: Map<number, number> } | null {
  if (step.kind === 'more') return { held: held.filter((p) => shown.has(p.id)), bests };
  if (step.kind !== 'drop' && step.kind !== 'upgrade' && step.kind !== 'banner') return null;
  if (step.kind === 'banner' && !step.pb) return null;
  const next = step.pb ? new Map(bests).set(step.catch.species, step.pb.to) : bests;
  return { held: held.filter((p) => p.id !== step.catch.id), bests: next };
}

/** Fish that join and fish that leave the roster between two reveals, by roster key. */
export function rosterChange<F>(before: F[], after: F[], keyOf: (f: F) => string): { arrivals: F[]; departures: F[] } {
  const beforeKeys = new Set(before.map(keyOf));
  const afterKeys = new Set(after.map(keyOf));
  return {
    arrivals: after.filter((f) => !beforeKeys.has(keyOf(f))),
    departures: before.filter((f) => !afterKeys.has(keyOf(f))),
  };
}

export type SplashTone = 'plain' | 'shiny' | 'epic';

/** How hard the surface reacts to a catch landing: shinies sparkle, epics and legendaries splash big, the rest plainly. */
export function splashFor(c: Pick<ReefCatch, 'shiny' | 'rarity'>): { tone: SplashTone; big: boolean } {
  const tone: SplashTone = c.shiny ? 'shiny' : c.rarity === 'epic' || c.rarity === 'legendary' ? 'epic' : 'plain';
  return { tone, big: tone !== 'plain' };
}

/** A catch banner's ring: gold shimmer for a shiny or a legendary, purple for an epic, faint otherwise. */
export function bannerGlow(c: Pick<ReefCatch, 'shiny' | 'rarity'>): string {
  return c.shiny || c.rarity === 'legendary' ? 'reef-banner-shiny ring-amber-300/70' : c.rarity === 'epic' ? 'ring-purple-400/60' : 'ring-white/15';
}

/** Released catches only (every row a caught catalog entry), for the plaque and silhouettes; nothing while the queue is unknown. */
export function releasedRows(
  species: ReefSpeciesRow[], hidden: ReefPending['all'], bests: Map<number, number>, queueHeld: boolean,
): ReefSpeciesRow[] {
  return queueHeld ? [] : maskCollection(species, hidden, bests);
}

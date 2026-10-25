import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { api, type ReefPending } from '../lib/api';
import { NO_HELD_REWARDS, heldOrNone, heldRewardsOf, releaseHeldReward, rewardKey, setRewardOf, speciesSetOf } from '../lib/tankDecor';
import { guestsAfterStep } from '../lib/tankPicks';
import {
  fishKey, hiddenCatches, marksAfterRelease, planQueue, queueCounts, releaseBatch, releaseDetail, revealForStep, rosterChange, splashFor,
  type ReleaseStep, type SplashTone,
} from '../lib/tankRelease';
import type { SwimmerSpec } from '../lib/tankSim';
import {
  admitVisitor, cardWidth, isDemoVisitor, placeBottle, placeChest, respotChests, restingCards, visitorKind,
  type VisitorMoment, type VisitorStep,
} from '../lib/tankVisitors';
import { demoVisitorSteps } from '../lib/tankVisitorDemo';
import { uiEvent } from '../lib/telemetry';

// Release orchestration (reef-alive §1, living-tank §1): fish stay masked until their step; visitors and rewards share the queue.

export const STEP_MS = 2500;
export const BANNER_MS = 3000;
/** How long an unveiled piece keeps its settle-and-sparkle class, or a fish its gold flash. */
export const UNVEIL_MS = 3200;
const SPLASH_MS = 1700;
const LEAD_MS = 250;
/** A dismissed visitor leaves when its exit animation ends; this backstop clears one whose animation never ends. */
const VISITOR_EXIT_BACKSTOP_MS = 6000;

type Hidden = ReefPending['all'];
type Bests = Map<number, number>;
const NO_BESTS: Bests = new Map();
type Source = 'tank' | 'widget';

export interface ReleaseBanner { key: number; step: ReleaseStep }
export type { VisitorMoment };
/** Where visitors may rest, kept current by TankRelease: tank width (px), sand taken by rocks and decor (centre x, width, px), bobber xs, chest width. */
export interface VisitorSpots { width: number; taken: { x: number; w: number }[]; bobbers: number[]; chestW: number; fullscreen: boolean }
/** A reward being unveiled in the tank: a decor piece settling (`id` = item) or a species badge flashing (`id` = set id). */
export interface Unveil { key: number; kind: 'decor' | 'badge'; id: string }
export interface ReleaseSplash { key: number; x: number; big: boolean; tone: SplashTone }
/** Shared with the swim loop: newcomers to drop in (id → surface x), fish to send off-edge, fish to swell on their next resize, exit callback. */
export interface ReleaseMotion { dropIns: Map<string, number>; leaving: Set<string>; swells: Set<string>; onGone: (id: string) => void }

interface Deps<F> {
  pending: ReefPending | undefined;
  /** `bests`: per-species best a running release has shown so far (see maskCollection); `guests`: see the hook's return */
  rosterFor: (hidden: Hidden, bests: Bests, guests: number[]) => F[];
  /** Catalog entries in the collection with `hidden` masked out: what had been caught before a release. */
  knownFor: (hidden: Hidden) => Set<number>;
  specOf: (id: string) => SwimmerSpec | undefined;
  width: number;
  reduced: boolean;
  /** collection, pending, bounds and this view's fish pick are in: safe to auto-start from the widget link */
  ready: boolean;
  /** told every time the held rewards change, and with none on unmount */
  onHeldRewards: (held: ReadonlySet<string>) => void;
}

const keyOf = (f: { species: number; shiny: boolean }) => fishKey(f.species, f.shiny);

export function useTankRelease<F extends { species: number; shiny: boolean; bestSize: number }>(deps: Deps<F>) {
  const queryClient = useQueryClient();
  const navigate = useNavigate({ from: '/' });
  const { release, reefVisitors } = useSearch({ strict: false }) as { release?: 1; reefVisitors?: 'demo' };
  const depsRef = useRef(deps);
  useEffect(() => {
    depsRef.current = deps;
  });

  const [held, setHeld] = useState<Hidden>([]);
  const heldRef = useRef<Hidden>([]);
  // Snapshot at release start: the release's own SSE refetch makes the server's released best count held catches.
  const [bests, setBests] = useState<Bests>(NO_BESTS);
  const bestsRef = useRef<Bests>(NO_BESTS);
  const [mark, setMark] = useState(0);
  const markRef = useRef(0);
  const [eventMark, setEventMark] = useState(0);
  const eventMarkRef = useRef(0);
  // First-ever catches dropped in this page session; they swim in both views on top of the picks.
  const [guests, setGuests] = useState<number[]>([]);
  const guestsRef = useRef<number[]>([]);
  // Species caught before the running release, from its start; the "+N more" step reads it.
  const knownRef = useRef<Set<number>>(new Set());
  const [releasing, setReleasing] = useState(false);
  const busy = useRef(false);
  const [banners, setBanners] = useState<ReleaseBanner[]>([]);
  const [splashes, setSplashes] = useState<ReleaseSplash[]>([]);
  // Visitors rest until clicked, for this page session only; the ref mirrors state so placement reads the live list.
  const [visitors, setVisitors] = useState<VisitorMoment[]>([]);
  const visitorsRef = useRef<VisitorMoment[]>([]);
  const spots = useRef<VisitorSpots>({ width: 0, taken: [], bobbers: [], chestW: 44, fullscreen: false });
  const commitVisitors = useCallback((next: VisitorMoment[]) => {
    visitorsRef.current = next;
    setVisitors(next);
  }, []);
  const removeVisitor = useCallback(
    (key: number) => commitVisitors(visitorsRef.current.filter((v) => v.key !== key)),
    [commitVisitors],
  );
  // Rewards of set events in a running release stay out of the tank until their own step (keys from rewardKey).
  const [heldRewards, setHeldRewards] = useState<ReadonlySet<string>>(NO_HELD_REWARDS);
  const heldRewardsRef = useRef<ReadonlySet<string>>(heldRewards);
  // The page holds the same rewards back in its Dex and Inventory.
  const holdRewards = useCallback((next: ReadonlySet<string>) => {
    const value = heldOrNone(next);
    heldRewardsRef.current = value;
    setHeldRewards(value);
    depsRef.current.onHeldRewards(value);
  }, []);
  const [unveils, setUnveils] = useState<Unveil[]>([]);
  const [leavers, setLeavers] = useState<{ fish: F; spec: SwimmerSpec }[]>([]);
  const motion = useRef<ReleaseMotion>({
    dropIns: new Map(),
    leaving: new Set(),
    swells: new Set(),
    onGone: (id) => {
      motion.current.leaving.delete(id);
      setLeavers((cur) => cur.filter((l) => l.spec.id !== id));
    },
  });
  const timers = useRef(new Set<number>());
  const alive = useRef(true);
  const seq = useRef(0);

  const later = useCallback((ms: number, fn: () => void) => {
    if (!alive.current) return;
    const t = window.setTimeout(() => {
      timers.current.delete(t);
      fn();
    }, ms);
    timers.current.add(t);
  }, []);
  useEffect(() => {
    alive.current = true;
    const live = timers.current;
    return () => {
      alive.current = false;
      for (const t of live) window.clearTimeout(t);
      // A tank leaving /reef mid-release must not leave the page's Dex holding badges back.
      depsRef.current.onHeldRewards(NO_HELD_REWARDS);
    };
  }, []);

  // A visitor sent away plays its exit (none under reduced motion), then TankVisitors removes it.
  const sendAway = useCallback((keys: number[]) => {
    if (keys.length === 0) return;
    if (depsRef.current.reduced) return commitVisitors(visitorsRef.current.filter((v) => !keys.includes(v.key)));
    commitVisitors(visitorsRef.current.map((v) => (keys.includes(v.key) ? { ...v, leaving: true as const } : v)));
    for (const k of keys) later(VISITOR_EXIT_BACKSTOP_MS, () => removeVisitor(k));
  }, [commitVisitors, later, removeVisitor]);
  const dismissVisitor = useCallback((key: number) => {
    const v = visitorsRef.current.find((m) => m.key === key);
    if (!v || v.leaving) return;
    if (!isDemoVisitor(v.step)) uiEvent('reef.visitor.dismiss', visitorKind(v.step));
    sendAway([key]);
  }, [sendAway]);
  const addVisitor = useCallback((key: number, step: VisitorStep) => {
    const width = depsRef.current.width;
    const kind = visitorKind(step);
    const live = visitorsRef.current.filter((v) => !v.leaving);
    const resting = live.filter((v) => visitorKind(v.step) === kind);
    const { taken, bobbers, chestW, fullscreen } = spots.current;
    const cards = restingCards(live, kind, width, fullscreen);
    let spot = { x: Math.random(), compact: false };
    if (width > 0 && kind === 'pr') {
      const s = placeChest(width, [...taken, ...resting.map((v) => ({ x: v.x * width, w: chestW }))], chestW, cards, cardWidth(fullscreen));
      spot = { x: s.x / width, compact: s.compact };
    } else if (width > 0 && kind === 'ticket') {
      const s = placeBottle(width, bobbers, resting.map((v) => v.x * width), cards, cardWidth(fullscreen));
      spot = { x: s.x / width, compact: s.compact };
    }
    if (spot.compact) console.log(`[reef] no room for a full ${kind} card: it rests compact and opens on hover`);
    const { keep, evict } = admitVisitor(visitorsRef.current, { key, step, x: spot.x, ...(spot.compact ? { compact: true as const } : {}) });
    commitVisitors(keep);
    if (evict.length) {
      console.log(`[reef] ${kind} visitors over the cap of their kind: the oldest leave (${evict.join(',')})`);
      // admitVisitor already flagged them leaving; reduced motion drops them at once.
      sendAway(evict);
    }
  }, [commitVisitors, sendAway]);

  // A resize or a rearrange can leave a resting chest on a rock or a piece; TankRelease reports the sand after each render.
  const layoutSeen = useRef('');
  const setSpots = useCallback((next: VisitorSpots) => {
    spots.current = next;
    const layout = `${next.width}|${next.chestW}|${next.taken.map((t) => `${Math.round(t.x)}:${Math.round(t.w)}`).join(',')}`;
    if (layout === layoutSeen.current) return;
    layoutSeen.current = layout;
    const moved = respotChests(visitorsRef.current, next.width, next.taken, next.chestW, next.fullscreen);
    if (moved === visitorsRef.current) return;
    console.log(`[reef] the sand changed under resting chests: re-placed ${moved.filter((v, i) => v !== visitorsRef.current[i]).length}`);
    commitVisitors(moved);
  }, [commitVisitors]);

  const hidden = useMemo(() => hiddenCatches(deps.pending?.all ?? [], mark, held), [deps.pending, mark, held]);
  // Only items past the marks are releasable; a stale pending list after a release counts zero.
  const counts = useMemo(
    () => queueCounts(
      (deps.pending?.all ?? []).filter((p) => p.id > mark).length,
      (deps.pending?.events ?? []).filter((e) => e.id > eventMark),
    ),
    [deps.pending, mark, eventMark],
  );
  const waiting = counts.fish + counts.pr + counts.ticket + counts.whale + counts.set;

  const reveal = useCallback((
    nextHeld: Hidden, x: number, nextBests: Bests = bestsRef.current, nextGuests: number[] = guestsRef.current,
  ) => {
    const d = depsRef.current;
    const all = d.pending?.all ?? [];
    const before = d.rosterFor(hiddenCatches(all, markRef.current, heldRef.current), bestsRef.current, guestsRef.current);
    const after = d.rosterFor(hiddenCatches(all, markRef.current, nextHeld), nextBests, nextGuests);
    heldRef.current = nextHeld;
    setHeld(nextHeld);
    bestsRef.current = nextBests;
    setBests(nextBests);
    if (nextGuests !== guestsRef.current) {
      guestsRef.current = nextGuests;
      setGuests(nextGuests);
    }
    if (d.reduced) return;
    const { arrivals, departures } = rosterChange(before, after, keyOf);
    arrivals.forEach((f, i) => {
      motion.current.dropIns.set(keyOf(f), i === 0 ? x : d.width * (0.15 + Math.random() * 0.7));
    });
    const outs = departures.flatMap((f) => {
      const spec = d.specOf(keyOf(f));
      return spec ? [{ fish: f, spec }] : [];
    });
    if (outs.length === 0) return;
    for (const o of outs) motion.current.leaving.add(o.spec.id);
    setLeavers((cur) => [...cur.filter((l) => !outs.some((o) => o.spec.id === l.spec.id)), ...outs]);
  }, []);

  const play = useCallback((step: ReleaseStep, shown: Set<number>) => {
    const d = depsRef.current;
    const key = ++seq.current;
    const banner = () => {
      setBanners((cur) => [...cur, { key, step }]);
      later(BANNER_MS, () => setBanners((cur) => cur.filter((b) => b.key !== key)));
    };
    if (step.kind === 'visitor' || step.kind === 'visitorBatch') {
      uiEvent('reef.visitor.shown', step.kind === 'visitor' ? step.event.kind : step.eventKind);
      addVisitor(key, step);
      return;
    }
    if (step.kind === 'reward') {
      const r = setRewardOf(step.event);
      if (!r) return banner();
      holdRewards(releaseHeldReward(heldRewardsRef.current, rewardKey(r)));
      const unveil = (kind: Unveil['kind'], id: string) => {
        setUnveils((cur) => [...cur, { key, kind, id }]);
        later(UNVEIL_MS, () => setUnveils((cur) => cur.filter((u) => u.key !== key)));
      };
      if (r.reward.type === 'backdrop') {
        // A new backdrop becomes the active one; the PUT's answer is the fresh rewards, so no refetch can race it.
        const item = r.reward.item;
        api.reef.setBackdrop(item).then(
          (fresh) => queryClient.setQueryData(['reef', 'rewards'], fresh),
          (err: unknown) => {
            console.error(`[reef] could not switch to the new backdrop ${item}`, err);
            void queryClient.invalidateQueries({ queryKey: ['reef', 'rewards'] });
          },
        );
        return banner();
      }
      void queryClient.invalidateQueries({ queryKey: ['reef', 'rewards'] });
      if (r.reward.type === 'decor') {
        unveil('decor', r.reward.item);
        return banner();
      }
      const all = d.pending?.all ?? [];
      const swimming = d.rosterFor(hiddenCatches(all, markRef.current, heldRef.current), bestsRef.current, guestsRef.current)
        .some((f) => speciesSetOf(f.species) === r.setId);
      if (swimming && !d.reduced) return unveil('badge', r.setId);
      return banner();
    }
    const x = d.width * (0.15 + Math.random() * 0.7);
    if (step.kind !== 'more' && step.pb && !d.reduced) {
      // The swimming fish may be either form of the species.
      motion.current.swells.add(fishKey(step.catch.species, false));
      motion.current.swells.add(fishKey(step.catch.species, true));
    }
    // Overflow catches appear in place; a drop and first-ever species among the overflow join the guests.
    const nextGuests = guestsAfterStep(step, guestsRef.current, heldRef.current, shown, knownRef.current);
    if (nextGuests !== guestsRef.current) console.log(`[reef] new species swim as session guests (${step.kind}): ${nextGuests.slice(guestsRef.current.length).join(',')}`);
    // A personal best unmasks its catch now so the swimming fish grows on its own banner.
    const next = revealForStep(step, heldRef.current, bestsRef.current, shown);
    if (next) reveal(next.held, x, next.bests, nextGuests);
    if (step.kind !== 'more' && !d.reduced) {
      const { tone, big } = splashFor(step.catch);
      setSplashes((cur) => [...cur, { key, x, big, tone }]);
      later(SPLASH_MS, () => setSplashes((cur) => cur.filter((s) => s.key !== key)));
    }
    banner();
  }, [later, reveal, addVisitor, queryClient, holdRewards]);

  const start = useCallback((source: Source) => {
    const d = depsRef.current;
    const p = d.pending;
    if (busy.current || !p) return;
    const batch = releaseBatch(p, markRef.current, eventMarkRef.current);
    if (!batch) return;
    const { all, events, catches, maxId, maxEventId } = batch;
    busy.current = true;
    setReleasing(true);
    const hiddenNow = hiddenCatches(p.all, markRef.current, heldRef.current);
    const before = d.rosterFor(hiddenNow, NO_BESTS, guestsRef.current);
    const swimming = new Set(before.map(keyOf));
    const prevBest = new Map(before.map((f) => [keyOf(f), f.bestSize]));
    knownRef.current = d.knownFor(hiddenNow);
    const steps = planQueue(catches, all.length, events, swimming, knownRef.current, prevBest);
    const pbs = steps.filter((s) => 'catch' in s && s.pb).length;
    const detail = releaseDetail(queueCounts(all.length, events), source);
    const shown = new Set(catches.map((c) => c.id));
    heldRef.current = all;
    setHeld(all);
    holdRewards(heldRewardsOf(events));
    bestsRef.current = new Map(before.map((f) => [f.species, f.bestSize]));
    setBests(bestsRef.current);
    uiEvent('reef.tank.release', detail);
    console.log(`[reef] releasing ${detail}: fish up to ${maxId}, events up to ${maxEventId ?? 'none'} (${steps.length} steps, ${pbs} personal bests)`);
    api.reef.release(maxId, maxEventId).then(
      (server) => {
        // Left the page mid-request: the server has them, so just refresh.
        if (!alive.current) return void queryClient.invalidateQueries({ queryKey: ['reef'] });
        const marks = marksAfterRelease(batch, server, eventMarkRef.current);
        markRef.current = marks.mark;
        setMark(markRef.current);
        eventMarkRef.current = marks.eventMark;
        setEventMark(eventMarkRef.current);
        steps.forEach((s, i) => later(LEAD_MS + i * STEP_MS, () => play(s, shown)));
        later(LEAD_MS + Math.max(0, steps.length - 1) * STEP_MS + BANNER_MS, () => {
          reveal([], depsRef.current.width / 2, NO_BESTS);
          busy.current = false;
          setReleasing(false);
          holdRewards(NO_HELD_REWARDS);
          void queryClient.invalidateQueries({ queryKey: ['reef'] });
        });
      },
      (err: unknown) => {
        console.error(`[reef] release (${detail}) failed; everything stays pending`, err);
        heldRef.current = [];
        setHeld([]);
        bestsRef.current = NO_BESTS;
        setBests(NO_BESTS);
        holdRewards(NO_HELD_REWARDS);
        busy.current = false;
        setReleasing(false);
      },
    );
  }, [later, play, reveal, queryClient, holdRewards]);

  // Widget badge path: /reef?release=1 starts the release once, then drops the param.
  const autoDone = useRef(false);
  useEffect(() => {
    if (release !== 1) {
      autoDone.current = false;
      return;
    }
    if (!deps.ready || autoDone.current) return;
    autoDone.current = true;
    start('widget');
    void navigate({ to: '/', search: (prev) => ({ ...prev, release: undefined }), replace: true });
  }, [release, deps.ready, start, navigate]);

  // Dev-only ?reefVisitors=demo: one of each visitor with made-up payloads, so they can be checked before real events exist.
  const demoDone = useRef(false);
  useEffect(() => {
    if (reefVisitors !== 'demo' || deps.width <= 0 || demoDone.current) return;
    demoDone.current = true;
    console.log('[reef] ?reefVisitors=demo: adding a demo chest, batch chest, bottle and whale');
    for (const step of demoVisitorSteps()) addVisitor(++seq.current, step);
  }, [reefVisitors, deps.width, addVisitor]);

  return {
    hidden, bests, guests, waiting, counts, releasing, start, banners, splashes,
    visitors, dismissVisitor, removeVisitor, setSpots, leavers, motion, heldRewards, unveils,
  };
}

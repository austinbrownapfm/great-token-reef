import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { ENTRIES, SPECIES_DEFS, LEGENDARY_ID_BASE, LEGENDARY_DEFS } from '@gtr/shared';
import { api, type ReefPending } from '../lib/api';
import { formatDate } from '../lib/format';
import { allSpecies } from '../lib/legendaryRows';
import { decorAnchor, devDecor, placeDecor, speciesSetOf, visibleRewards, type DecorPlacement } from '../lib/tankDecor';
import { bigness, tankWidth } from '../lib/fishSize';
import { depthFor, habitForSpecies, speedFor, type Anchors } from '../lib/tankHabits';
import { bubbleCount, snapBubbleRate } from '../lib/tankEnv';
import { hudReserve, isPlaqueEscape, placePlaque, plaqueFor, shouldClosePlaque } from '../lib/tankPlaque';
import {
  FISH_CAPS, RARITY_RANK, pickRoster, picksSettled, rosterFromPick, seedPick, seedReady, type FishView, type RosterFish,
} from '../lib/tankPicks';
import { fishKey, maskCollection, queueUnknown, releaseGates, releasedRows } from '../lib/tankRelease';
import { uiEvent } from '../lib/telemetry';
import { tankNotices } from '../lib/tankNotices';
import { emptyTankMessage } from '../lib/tankLines';
import { hold, puff as puffFish, type Bounds, type Swimmer, type SwimmerSpec } from '../lib/tankSim';
import { Fish } from './Fish';
import { PrHud, QuotaHud } from './ReefWidget';
import { TankArrange, useTankArrange } from './TankArrange';
import { TankBackdrop, TankDecor } from './TankDecor';
import { TankRelease } from './TankRelease';
import { TankLines } from './TankLines';
import { TankNoticeChip, useMinuteClock } from './TankNotices';
import { TankPlaque } from './TankPlaque';
import { TankRockLips, TankRocks, rocksFor, type Rock } from './TankRocks';
import { TankWeather } from './TankWeather';
import { useTankLines } from './useTankLines';
import { useLinger, usePrefersReducedMotion, useTankEnv } from './useTankEnv';
import { useTankRelease } from './useTankRelease';
import { useSwimLoop } from './useSwimLoop';
import { useTankFullscreen, useTankLayout } from './useTankFullscreen';

// The Reef tank (docs/reef-tank-plan.md). Fish positions come from the pure
// simulation in lib/tankSim.ts; a requestAnimationFrame loop (useSwimLoop) writes
// transforms straight onto refs so React never re-renders per frame.
// Fullscreen (useTankFullscreen) = Fullscreen API with a fixed-overlay fallback, always-on HUD.
// Decor (caustics, rays, fog, parallax silhouettes, floor) is CSS only.

export function Tank({ onHeldRewards }: {
  /** a running release's held reward keys (rewardKey), so the page's Dex and Inventory hold them too */
  onHeldRewards: (held: ReadonlySet<string>) => void;
}) {
  const collection = useQuery({ queryKey: ['reef', 'collection'], queryFn: api.reef.collection });
  const pending = useQuery({ queryKey: ['reef', 'pending'], queryFn: api.reef.pending, retry: false });
  const rewards = useQuery({ queryKey: ['reef', 'rewards'], queryFn: api.reef.rewards, retry: false });
  const fish = useQuery({ queryKey: ['reef', 'fish'], queryFn: api.reef.fish, retry: false });
  const queryClient = useQueryClient();
  const { reefDecor, reefBackdrop, arrange, reefLegends } = useSearch({ strict: false }) as { reefDecor?: string; reefBackdrop?: string; arrange?: 1; reefLegends?: 'preview' };
  const navigate = useNavigate({ from: '/' });
  const tankRef = useRef<HTMLDivElement>(null);
  const bubbleLayer = useRef<HTMLDivElement>(null);
  const flakeLayer = useRef<HTMLDivElement>(null);
  // `screen` styles the container; every piece of geometry reads `fullscreen`, the mode paired with its measured size.
  const { fullscreen: screen, toggle } = useTankFullscreen(tankRef);
  const layout = useTankLayout(tankRef, screen);
  const fullscreen = layout.mode;
  const bounds = useMemo(() => ({ width: layout.width, height: layout.height }), [layout.width, layout.height]);
  const scale = fullscreen ? 1.3 : 1;
  const env = useTankEnv(fullscreen !== null);
  const reduced = usePrefersReducedMotion();
  const population = populationFor(bounds);
  const view: FishView = fullscreen ? 'full' : 'strip';
  // A view's pick before its seed's PUT answers, so the tank never waits on the round trip.
  const [seeds, setSeeds] = useState<Partial<Record<FishView, number[]>>>({});
  const [seedFailed, setSeedFailed] = useState<Partial<Record<FishView, true>>>({});
  const pick = fish.data ? (fish.data[view] ?? seeds[view] ?? null) : null;
  // Visible failure: a chip says so. A later save of this view's pick clears a failed seed.
  const picksFailed = fish.isError || (!!seedFailed[view] && fish.data?.[view] == null);
  // The automatic roster stands in only with no pick to show; cached picks outlive a failed refetch.
  const autoRoster = picksFailed && pick === null;
  // Catalog species plus legendaries; ?reefLegends=preview swaps in all 24 legendaries and swims one of each.
  const species = useMemo(() => (collection.data ? allSpecies(collection.data, reefLegends === 'preview') : []), [collection.data, reefLegends]);
  const previewGuests = useMemo(() => (reefLegends === 'preview' ? LEGENDARY_DEFS.map((_, i) => LEGENDARY_ID_BASE + i) : []), [reefLegends]);
  const rosterFor = useCallback(
    (hidden: ReefPending['all'], bests: Map<number, number>, guests: number[]) => {
      const masked = maskCollection(species, hidden, bests);
      const all = [...guests, ...previewGuests];
      if (autoRoster) return rosterFromPick(masked, pickRoster(masked, population).map((r) => r.species), all, population);
      return pick ? rosterFromPick(masked, pick, all, FISH_CAPS[view]) : [];
    },
    [species, previewGuests, population, autoRoster, pick, view],
  );
  const knownFor = useCallback(
    (hidden: ReefPending['all']) => new Set(maskCollection(species, hidden).map((s) => s.species)),
    [species],
  );
  const specsRef = useRef<SwimmerSpec[]>([]);
  // Until pending loads, or while it has failed, released fish cannot be told from new ones; an empty tank beats a spoiler.
  const queueHeld = queueUnknown(pending);
  // A release snapshots the roster at its start, so it waits until the tank knows which fish it shows.
  const picksReady = picksSettled(fish, pick, picksFailed);
  const { dataReady, autoStart, canRelease } = releaseGates({ collection, pending, width: bounds.width, picksReady });
  const release = useTankRelease({
    pending: pending.data,
    rosterFor,
    knownFor,
    specOf: (id) => specsRef.current.find((sp) => sp.id === id),
    width: bounds.width,
    reduced,
    ready: autoStart,
    onHeldRewards,
  });
  const roster = useMemo(
    () => (queueHeld ? [] : rosterFor(release.hidden, release.bests, release.guests)),
    [queueHeld, rosterFor, release.hidden, release.bests, release.guests],
  );
  const specs = useMemo(() => roster.map((r) => specFor(r, fullscreen !== null, scale)), [roster, fullscreen, scale]);
  useEffect(() => {
    specsRef.current = specs;
  }, [specs]);
  // Fish leaving the roster mid-release swim off-edge and stay rendered until gone.
  const school = useMemo(() => {
    const ids = new Set(specs.map((sp) => sp.id));
    return [
      ...roster.map((r, i) => ({ fish: r, spec: specs[i]!, leaving: false })),
      ...release.leavers.filter((l) => !ids.has(l.spec.id)).map((l) => ({ ...l, leaving: true })),
    ];
  }, [roster, specs, release.leavers]);
  const swimSpecs = useMemo(() => school.map((f) => f.spec), [school]);
  const bubbleRate = useSnappedBubbleRate(Number(env.vars['--reef-bubble-rate'] ?? 1));
  const decor = useMemo(() => decorFor(bounds.width, fullscreen !== null), [bounds.width, fullscreen]);
  const bubbles = useMemo(() => bubblesFor(bubbleCount(bounds.width, bubbleRate)), [bounds.width, bubbleRate]);
  const rocks = useMemo(
    () => rocksFor(bounds.width, bounds.height, decor.floor, fullscreen !== null),
    [bounds.width, bounds.height, decor.floor, fullscreen],
  );
  // Rewards a running release still holds stay out until their step; ?reefDecor / ?reefBackdrop are dev previews.
  const shownRewards = useMemo(() => (rewards.data ? visibleRewards(rewards.data, release.heldRewards) : undefined), [rewards.data, release.heldRewards]);
  const earned = useMemo(() => (reefDecor ? devDecor(reefDecor) : (shownRewards?.decor ?? [])), [reefDecor, shownRewards]);
  // Dev previews hold pieces the server does not know, so they never arrange; ?arrange=1 waits out a release.
  const arranging = arrange === 1 && !reefDecor && !!rewards.data && !release.releasing;
  const arranger = useTankArrange({ active: arranging, earned, width: bounds.width, rocks, fullscreen: fullscreen !== null, toggle });
  const pieces = useMemo(
    () => placeDecor(arranger.draft ?? earned, bounds, decor.floor, fullscreen !== null, rocks),
    [arranger.draft, earned, bounds, decor.floor, fullscreen, rocks],
  );
  const badges = useMemo(() => new Set(shownRewards?.badges ?? []), [shownRewards]);
  const backdrop = reefBackdrop ?? rewards.data?.activeBackdrop ?? null;
  const settling = useMemo(() => new Set(release.unveils.filter((u) => u.kind === 'decor').map((u) => u.id)), [release.unveils]);
  const flashing = useMemo(() => new Set(release.unveils.filter((u) => u.kind === 'badge').map((u) => u.id)), [release.unveils]);
  const anchors = useMemo(() => anchorsFor(decor, rocks, pieces, bounds), [decor, rocks, pieces, bounds]);
  const plaqueEl = useRef<HTMLDivElement>(null);
  const plaqueIdRef = useRef<string | null>(null);
  const hudRef = useRef<HTMLDivElement | null>(null);
  const [hudBottom, setHudBottom] = useState(0);
  // The top HUD band's height changes as PR cards load, so the waterline follows it live.
  const hudObserver = useRef<ResizeObserver | null>(null);
  const setHudEl = useCallback((el: HTMLDivElement | null) => {
    hudObserver.current?.disconnect();
    hudRef.current = el;
    // A stale height would set the next fullscreen entry's waterline and fish ceiling before the band is measured.
    if (!el) {
      setHudBottom(0);
      return;
    }
    const measure = () => setHudBottom(Math.round(el.offsetTop + el.offsetHeight));
    hudObserver.current = new ResizeObserver(measure);
    hudObserver.current.observe(el);
    measure();
  }, []);
  useEffect(() => () => hudObserver.current?.disconnect(), []);
  // In fullscreen the waterline sits under the HUD band, which stays put while arranging.
  const surfaceY = fullscreen ? (hudBottom > 0 ? hudBottom + 22 : 26) : 14;
  // The sim stops bellies on the drawn sand, not a fixed margin; in fullscreen open-ocean fish keep below the waterline under the band.
  const simBounds = useMemo(
    () => ({ ...bounds, floor: decor.floor, top: fullscreen ? surfaceY : 0 }),
    [bounds, decor.floor, fullscreen, surfaceY],
  );
  // The weeds' CSS sway, so a seahorse can ride its weed: --reef-lean is 7deg per unit of current, the sim's current 18 * scale px/s.
  const swayAmp = Number(env.vars['--reef-sway-amp'] ?? 6) * (reduced ? 1 : Number(env.vars['--reef-storm-sway'] ?? 1));
  const sway = useMemo(() => ({ amp: swayAmp, degPerCurrent: 7 / (18 * scale) }), [swayAmp, scale]);
  const { fishRefs, simRef, feed } = useSwimLoop(
    tankRef, bubbleLayer, flakeLayer, swimSpecs, simBounds, reduced ? 0 : env.current * 18 * scale, release.motion, anchors,
    plaqueEl, plaqueIdRef, hudRef, sway,
  );
  useWeedClock(tankRef, decor.weeds);
  const [hovered, setHovered] = useState<string | null>(null);
  const hoveredRef = useRef<string | null>(null);
  const [plaque, setPlaque] = useState<string | null>(null);
  const { lines, jerking } = useTankLines();
  const emptyMessage = emptyTankMessage({ waiting: release.waiting, activeLines: lines.length });

  // A fish is held while hovered or while its plaque is open.
  const applyHolds = useCallback(() => {
    const now = performance.now() / 1000;
    for (const s of simRef.current) hold(s, s.id === hoveredRef.current || s.id === plaqueIdRef.current, now);
  }, [simRef]);
  const setHover = (id: string | null) => {
    hoveredRef.current = id;
    applyHolds();
    setHovered(id);
    if (id) uiEvent('reef.tank.fish.hover', id.split('-')[0]);
  };
  const openPlaque = (r: RosterFish, id: string) => {
    if (arranging) return;
    if (plaqueIdRef.current !== id) uiEvent('reef.tank.plaque', String(r.species));
    plaqueIdRef.current = id;
    setPlaque(id);
    applyHolds();
    const s = simRef.current.find((x) => x.id === id);
    const entry = ENTRIES[r.species];
    if (s && entry && SPECIES_DEFS[entry.s]?.plan === 'puffer') {
      puffFish(s, performance.now() / 1000);
      uiEvent('reef.tank.puffer', String(r.species));
    }
  };
  // A programmatic refocus is not a hover: no hold, no card, no hover event.
  const refocusing = useRef(false);
  const closePlaque = useCallback((refocus = false) => {
    const id = plaqueIdRef.current;
    plaqueIdRef.current = null;
    setPlaque(null);
    applyHolds();
    const el = refocus && id ? fishRefs.current.get(id) : undefined;
    if (!el?.isConnected) return;
    refocusing.current = true;
    el.focus({ preventScroll: true });
    refocusing.current = false;
  }, [applyHolds, fishRefs]);
  const placePlaqueNow = useCallback(() => {
    const el = plaqueEl.current;
    const s = simRef.current.find((x) => x.id === plaqueIdRef.current);
    if (el && s) placePlaque(el, s, bounds, hudReserve(hudRef.current));
  }, [simRef, bounds]);
  const openDex = (species: number) => {
    uiEvent('reef.tank.plaque.dex', String(species));
    closePlaque();
    if (fullscreen) toggle();
    void navigate({ to: '/', search: { species }, replace: true });
  };
  // Capture phase so Esc closes the plaque before it can also leave theater fullscreen.
  useEffect(() => {
    if (!plaque) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isPlaqueEscape({ key: e.key, defaultPrevented: e.defaultPrevented, target: e.target as Node | null }, tankRef.current, document.body)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      closePlaque(true);
    };
    // Clicks inside the tank go through onTankClick; anywhere else on the page closes the plaque.
    const onDown = (e: PointerEvent) => {
      if (shouldClosePlaque(e.target as Node | null, tankRef.current, plaqueEl.current)) closePlaque();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [plaque, closePlaque]);
  // Leaving fullscreen by any route (theater Esc from behind the overlay, the browser's own Esc) takes the plaque with it.
  const wasFullscreen = useRef(fullscreen !== null);
  useEffect(() => {
    const ended = wasFullscreen.current && fullscreen === null;
    wasFullscreen.current = fullscreen !== null;
    if (ended) closePlaque();
  }, [fullscreen, closePlaque]);
  // Fish go hands-off while arranging: no hover hold, no plaque.
  useEffect(() => {
    if (!arranging) return;
    hoveredRef.current = null;
    setHovered(null);
    closePlaque();
  }, [arranging, closePlaque]);
  // Only open water feeds (fish, buttons, HUD, plaque are data-reef-nofeed); with a plaque open it only closes it.
  const onTankClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (arranging || target.closest('[data-reef-nofeed], button, a, [role="button"]')) return;
    if (plaqueIdRef.current) {
      closePlaque(true);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const added = feed(e.clientX - rect.left, e.clientY - rect.top);
    uiEvent('reef.tank.feed', String(added));
  };

  const plankton = useMemo(() => planktonFor(bounds.width, fullscreen !== null), [bounds.width, fullscreen]);
  // Plankton fade with --reef-glow's 10s transition at dawn rather than vanishing.
  const planktonShown = useLinger(env.night > 0, 10_000, reduced);
  const causticSpeed = Number(env.vars['--reef-caustic-speed'] ?? 1);
  useCausticSpeed(tankRef, causticSpeed, reduced);
  // Warm light peaks halfway through dawn and dusk; dawn from the left, dusk from the right.
  const sun = env.phase === 'dawn' || env.phase === 'dusk' ? 4 * env.night * (1 - env.night) : 0;
  const envStyle = {
    ...env.vars,
    '--reef-lean': reduced ? '0' : String(Number((env.current * 7).toFixed(2))),
    ...(reduced ? { '--reef-storm-sway': '1' } : {}),
    '--reef-sun': String(Number(sun.toFixed(3))),
    '--reef-sun-x': env.phase === 'dusk' ? '82%' : '18%',
  } as React.CSSProperties;
  const masked = useMemo(
    () => releasedRows(species, release.hidden, release.bests, queueHeld),
    [queueHeld, species, release.hidden, release.bests],
  );
  const silhouettes = useMemo(() => pickRoster(masked, 40).slice(-5), [masked]);
  // First render of a view with no pick saves what the automatic roster shows there, once per view.
  // Fresh collection + pending + picks only, and never mid-release, so pending fish are never seeded.
  const seeded = useRef(new Set<FishView>());
  useEffect(() => {
    // Never on a picks error: a failed refetch keeps a stale cached null.
    const ready = seedReady({
      unset: !!fish.data && fish.data[view] === null,
      alreadySeeded: seeded.current.has(view),
      picksError: fish.isError,
      picksFresh: fish.isFetchedAfterMount && !fish.isFetching,
      dataReady,
      queueError: pending.isError,
      releasing: release.releasing,
    });
    // The preview's made-up legendaries must never be saved into a real pick.
    if (!ready || reefLegends) return;
    seeded.current.add(view);
    const seedIds = seedPick(masked, populationFor(bounds), FISH_CAPS[view]);
    setSeeds((cur) => ({ ...cur, [view]: seedIds }));
    console.log(`[reef] seeding the ${view} fish pick with ${seedIds.length} fish: ${seedIds.join(',')}`);
    api.reef.setFish(view, seedIds).then(
      (fresh) => queryClient.setQueryData(['reef', 'fish'], fresh),
      (err: unknown) => {
        console.error(`[reef] could not save the seeded ${view} fish pick; the seeded fish stay shown under the picks chip`, err);
        setSeedFailed((cur) => ({ ...cur, [view]: true }));
      },
    );
  }, [fish.data, fish.isError, fish.isFetchedAfterMount, fish.isFetching, view, dataReady, pending.isError, release.releasing, bounds, masked, queryClient, reefLegends]);
  // Visible failures: the release queue, collection or picks that did not load or save, and visitor fetches failing on the server.
  const nowSec = useMinuteClock(!queueHeld && (pending.data?.visitorErrors?.length ?? 0) > 0);
  const notices = tankNotices({
    queueError: pending.isError ? pending.error.message : null,
    queueHeld,
    collectionError: collection.isError ? collection.error.message : null,
    picksFailed,
    visitorErrors: pending.data?.visitorErrors,
    nowSec,
  });
  const hoveredFish = hovered ? roster.find((r) => rosterId(r) === hovered) : undefined;
  const hoveredSwimmer = hovered ? simRef.current.find((s) => s.id === hovered) : undefined;
  const plaqueFish = plaque ? roster.find((r) => rosterId(r) === plaque) : undefined;
  const plaqueText = useMemo(() => plaqueFor(plaqueFish?.species, masked), [plaqueFish, masked]);
  // A fish released away or swum off takes its plaque with it.
  useEffect(() => {
    if (plaque && !plaqueText) closePlaque();
  }, [plaque, plaqueText, closePlaque]);

  return (
    <div
      ref={tankRef}
      className={`reef-tank group relative overflow-hidden ${
        arranging ? '[&_.reef-wag]:pointer-events-none [&_.reef-wag]:opacity-25 [&_.reef-wag]:transition-opacity' : ''
      } ${
        screen === 'theater'
          ? 'fixed inset-0 z-50'
          : screen === 'native'
            ? 'h-screen w-screen'
            : 'mt-4 h-56 rounded-xl'
      }`}
      style={{
        ...envStyle,
        ['--reef-tank-w' as string]: `${bounds.width}px`,
      }}
      data-reef-phase={env.phase}
      onClick={onTankClick}
    >
      <TankBackdrop active={backdrop} reduced={reduced} />
      {/* far layer: sky light, rays, blurred silhouettes, caustics */}
      <div className="reef-sun" />
      <div className="reef-moon" />
      {fullscreen && (
        <div className="reef-rays">
          {[12, 34, 58].map((left, i) => (
            <div key={`r${i}`} className="reef-ray" style={{ left: `${left}%`, animationDelay: `${-i * 2.3}s` }} />
          ))}
        </div>
      )}
      {silhouettes.map((r, i) => (
        <div
          key={`s${r.species}`}
          className="reef-drift pointer-events-none absolute left-0 opacity-30 blur-[2px] grayscale"
          style={{
            top: `${10 + ((i * 29) % 55)}%`,
            width: (140 + ((i * 41) % 90)) * scale,
            animationDuration: `${70 + ((i * 17) % 40)}s`,
            animationDelay: `${-((i * 23) % 60)}s`,
          }}
        >
          <Fish species={r.species} shiny={false} />
        </div>
      ))}
      <div className="reef-caustic reef-caustic-a" />
      <div className="reef-caustic reef-caustic-b" />
      {decor.weeds.map((w, i) => (
        <svg
          key={`w${i}`}
          viewBox={`0 0 30 ${w.height}`}
          // The 30-wide viewBox meets a 20px box; anchor to the bottom so the stem reaches the sand.
          preserveAspectRatio="xMidYMax meet"
          className="reef-sway reef-nightdim absolute w-5"
          style={{ left: `${w.left}%`, bottom: decor.floor - 6, height: w.height, animationDelay: `${w.delay}s` }}
        >
          <path
            d={`M15,${w.height} C ${8 + (i % 3) * 3},${w.height * 0.6} ${20 - (i % 4) * 2},${w.height * 0.35} 15,0`}
            stroke={i % 3 === 0 ? '#2a8a52' : '#1e6b45'} strokeWidth="7" fill="none" strokeLinecap="round" opacity=".85"
          />
        </svg>
      ))}
      <TankRocks rocks={rocks} />
      <TankDecor pieces={pieces} settling={settling} />
      {bubbles.map((b, i) => (
        <div
          key={`b${i}`}
          className="reef-rise absolute rounded-full border border-white/50"
          style={{ left: `${b.left}%`, bottom: decor.floor, width: b.size, height: b.size, animationDuration: `${b.duration}s`, animationDelay: `${b.delay}s` }}
        />
      ))}

      {planktonShown !== 'off' && (
        <div className={`reef-plankton-layer ${planktonShown === 'leaving' ? 'reef-plankton-out' : ''}`}>
          {plankton.map((p, i) => (
            <span
              key={`k${i}`}
              className="reef-plankton"
              style={{ left: `${p.left}%`, top: `${p.top}%`, width: p.size, height: p.size, animationDuration: `${p.duration}s`, animationDelay: `${p.delay}s` }}
            />
          ))}
        </div>
      )}
      <TankWeather level={env.weather} vars={env.vars} reduced={reduced} surfaceY={surfaceY} fullscreen={fullscreen !== null} />

      <TankLines
        lines={lines}
        bounds={bounds}
        surfaceY={surfaceY}
        floorY={bounds.height - decor.floor}
        fullscreen={fullscreen !== null}
        jerking={jerking}
      />
      <div ref={flakeLayer} className="pointer-events-none absolute inset-0 z-10" />
      {/* fish layer */}
      {school.map(({ fish: r, spec, leaving }) => {
        const set = speciesSetOf(r.species);
        // The flash may land before the rewards refetch that brings its badge.
        const gold = !set ? '' : flashing.has(set) ? 'reef-gold reef-gold-flash' : badges.has(set) ? 'reef-gold' : '';
        return (
          <div
            key={spec.id}
            ref={(el) => {
              if (el) fishRefs.current.set(spec.id, el);
              else fishRefs.current.delete(spec.id);
            }}
            role="button"
            data-reef-nofeed
            tabIndex={leaving || arranging ? -1 : 0}
            onMouseEnter={() => setHover(spec.id)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => { if (!refocusing.current) setHover(spec.id); }}
            onBlur={() => setHover(null)}
            onClick={() => openPlaque(r, spec.id)}
            onKeyDown={(e) => { if (e.key === 'Enter') openPlaque(r, spec.id); }}
            className={`reef-wag absolute left-0 top-0 will-change-transform ${leaving ? 'pointer-events-none' : 'cursor-pointer'} ${
              r.shiny ? 'reef-shiny' : r.rarity === 'epic' ? 'reef-epic' : ''
            } ${gold} ${hovered === spec.id || plaque === spec.id ? 'z-20' : spec.habit === 'crevice' ? 'z-10' : 'z-[11]'}`}
            style={{ transform: 'translate(-9999px, 0)' }}
          >
            <Fish species={r.species} shiny={r.shiny} className="[&>svg]:drop-shadow-md" />
          </div>
        );
      })}
      {/* Lips (z-10, after the fish) cover eels (z-10) only; every other fish swims in front at z-11. */}
      <TankRockLips rocks={rocks} />
      <div ref={bubbleLayer} className="pointer-events-none absolute inset-0 z-[11]" />

      {/* floor: fog, sand, pebbles, coral */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0"
        style={{ height: '45%', background: 'linear-gradient(180deg, rgba(4,30,45,0) 0%, rgba(4,30,45,0.45) 100%)' }}
      />
      <div
        className="reef-sand absolute inset-x-0 bottom-0"
        style={{ height: decor.floor }}
      />
      <svg
        className="reef-nightdim pointer-events-none absolute inset-x-0 bottom-0 w-full"
        style={{ height: decor.floor + 30 }}
        preserveAspectRatio="none"
        viewBox="0 0 1000 60"
      >
        {decor.pebbles.map((p, i) => (
          <ellipse key={`p${i}`} cx={p.x} cy={48 + p.dy} rx={p.r} ry={p.r * 0.55} fill={p.fill} opacity="0.9" />
        ))}
        {decor.corals.map((c, i) => (
          <path
            key={`c${i}`}
            transform={`translate(${c.x} 50)`}
            d="M0,0 C-6,-14 -2,-26 -10,-36 M0,0 C2,-16 8,-22 6,-38 M0,0 C-1,-10 4,-14 14,-18"
            stroke={c.fill} strokeWidth="5" fill="none" strokeLinecap="round"
          />
        ))}
      </svg>
      {/* haze and weather tint sit over the scenery but under the fish (z-10), so fish stay crisp */}
      <div className="reef-fog" />
      <div className="reef-tint" />

      {emptyMessage && roster.length === 0 && collection.data && !queueHeld && (pick !== null || picksFailed) && !release.releasing && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-white/70">
          {emptyMessage}
        </div>
      )}
      {!plaque && !arranging && hoveredFish && hoveredSwimmer && (
        <HoverCard fish={hoveredFish} swimmer={hoveredSwimmer} bounds={bounds} />
      )}
      {plaqueFish && plaqueText && (
        <TankPlaque
          lines={plaqueText}
          species={plaqueFish.species}
          compact={fullscreen === null}
          reserveTop={fullscreen ? hudBottom : 0}
          elRef={plaqueEl}
          onPlace={placePlaqueNow}
          onClose={() => closePlaque(true)}
          onDex={() => openDex(plaqueFish.species)}
        />
      )}
      {/* Arrange mode is a focused edit: the release button and its banners wait until Done. */}
      {!arranging && <TankRelease
        release={release}
        count={release.waiting}
        canRelease={canRelease}
        width={bounds.width}
        lineXs={lines.map((l) => l.xFrac * bounds.width)}
        taken={[...rocks, ...pieces]}
        surfaceY={surfaceY}
        restBottom={decor.floor - 6}
        fullscreen={fullscreen !== null}
      />}
      {arranger.draft && (
        <TankArrange
          pieces={pieces}
          draft={arranger.draft}
          width={bounds.width}
          fullscreen={fullscreen !== null}
          saving={arranger.saving}
          error={arranger.error}
          onMove={arranger.move}
          onHide={arranger.hide}
          onShow={arranger.show}
          onDone={() => void arranger.done()}
          onCancel={arranger.cancel}
          notices={notices}
        />
      )}
      {fullscreen && (
        <div
          ref={setHudEl}
          className={`pointer-events-none absolute left-6 right-24 top-3 z-30 flex items-start gap-3 [&>*]:pointer-events-auto ${arranging ? 'invisible' : ''}`}
        >
          <QuotaHud className="flex-none" />
          <div data-reef-nofeed className="min-w-0 flex-1"><PrHud /></div>
        </div>
      )}
      {/* Arrange mode shows the notices in its toolbar, which would otherwise cover them. */}
      {!arranging && notices.length > 0 && (
        <div
          className={`pointer-events-none absolute left-3 z-[38] flex items-start gap-1 ${fullscreen ? 'flex-col' : 'flex-col-reverse'}`}
          // Fullscreen: just under the HUD band; strip: above the sand, clear of the release button; over resting visitor cards.
          style={fullscreen ? { top: Math.max(hudBottom, 12) + 6 } : { bottom: decor.floor + 6 }}
        >
          {notices.map((n) => <TankNoticeChip key={n.key} notice={n} />)}
        </div>
      )}
      <button
        type="button"
        data-reef-nofeed
        onClick={toggle}
        aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen tank'}
        title={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen tank'}
        className="absolute right-3 top-3 z-30 rounded-md bg-black/30 px-2 py-1 text-sm text-white opacity-0 transition-opacity hover:bg-black/50 focus:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
      >
        {fullscreen ? '✕' : '⛶'}
      </button>
      {fullscreen && !arranging && earned.length > 0 && !reefDecor && !release.releasing && (
        <button
          type="button"
          data-reef-nofeed
          onClick={arranger.enter}
          aria-label="Arrange decor"
          title="Arrange decor"
          className="absolute right-14 top-3 z-30 rounded-md bg-black/30 px-2 py-1 text-sm text-white opacity-0 transition-opacity hover:bg-black/50 focus:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
        >
          ✎
        </button>
      )}
    </div>
  );
}

// Chip pinned above the hovered fish (below it when it is near the surface).
function HoverCard({ fish, swimmer, bounds }: { fish: RosterFish; swimmer: Swimmer; bounds: Bounds }) {
  const above = swimmer.y > 70;
  const left = Math.max(8, Math.min(bounds.width - 220, swimmer.x - 100));
  const top = above ? swimmer.y - swimmer.height / 2 - 58 : swimmer.y + swimmer.height / 2 + 8;
  return (
    <div
      className="pointer-events-none absolute z-30 w-52 rounded-lg bg-black/60 px-3 py-2 text-xs text-white shadow-lg backdrop-blur-sm"
      style={{ left, top }}
    >
      <div className="truncate font-semibold">{fish.shiny ? '✨ ' : ''}{fish.name}</div>
      <div className="text-white/70">
        <span className="uppercase">{fish.rarity}</span> · PB {fish.bestSize}cm · ×{fish.count}
      </div>
      <div className="truncate text-white/60">
        First caught {formatDate(fish.firstCaught)}{fish.firstProject ? ` in ${fish.firstProject.split('/').pop()}` : ''}
      </div>
    </div>
  );
}

export const rosterId = (r: RosterFish) => fishKey(r.species, r.shiny);

// Population scales with tank area: ~8 in the strip, 28 in fullscreen.
export function populationFor(b: Bounds): number {
  return Math.max(6, Math.min(28, Math.floor((b.width * b.height) / 30_000)));
}

// Size, depth and speed from real relative size, then the species habit overrides band and speed.
function specFor(r: RosterFish, fullscreen: boolean, scale: number): SwimmerSpec {
  const width = tankWidth(r.species, r.bestSize, fullscreen);
  const big = Math.min(1, bigness(width, fullscreen));
  const centre = 0.12 + big * 0.55 + (((r.species * 13) % 7) / 7) * 0.2;
  const tier = Math.max(0, RARITY_RANK[r.rarity] ?? 3);
  const habit = habitForSpecies(r.species);
  return {
    id: rosterId(r),
    width,
    cruise: (68 - big * 36 + ((r.species * 5) % 9)) * scale * speedFor(habit),
    depth: depthFor(habit, [Math.max(0.05, centre - 0.14), Math.min(0.88, centre + 0.14)]),
    hoverBias: 1 - tier / 3,
    dartBias: tier / 3,
    habit,
  };
}

// Habit anchors in tank px: rock crevices, weed stems (about half-way up), coral and earned decor.
function anchorsFor(decor: ReturnType<typeof decorFor>, rocks: Rock[], pieces: DecorPlacement[], b: Bounds): Anchors {
  const weedFoot = b.height - (decor.floor - 6);
  const coralY = b.height - (decor.floor + 30) / 2;
  return {
    rocks: rocks.flatMap((r) => r.crevices),
    // w-5 weeds are 20px wide; the stem is their centre.
    weeds: decor.weeds.map((w) => ({
      x: (w.left / 100) * b.width + 10,
      y: weedFoot - w.height * 0.55,
      sway: { reach: w.height * 0.55, delay: w.delay },
    })),
    decor: [...decor.corals.map((c) => ({ x: (c.x / 1000) * b.width, y: coralY })), ...pieces.map(decorAnchor)],
  };
}

// Deterministic decor, scaled by width so a fullscreen tank is not sparse.
const PEBBLE_FILLS = ['#8c7350', '#a08a63', '#6e5a3e', '#b39b70'];
const CORAL_FILLS = ['#d9573c', '#e08a3c', '#c74f7a', '#e0b23c'];
function decorFor(width: number, fullscreen: boolean) {
  const w = Math.max(width, 600);
  const weedCount = Math.min(24, Math.max(7, Math.round(w / 110)));
  const tall = fullscreen ? 2.2 : 1;
  return {
    floor: fullscreen ? 44 : 24,
    weeds: Array.from({ length: weedCount }, (_, i) => ({
      left: 2 + (i / weedCount) * 96 + ((i * 37) % 5),
      height: (42 + ((i * 53) % 55)) * tall,
      delay: -((i * 1.3) % 4),
    })),
    pebbles: Array.from({ length: 14 }, (_, i) => ({
      x: 30 + ((i * 173) % 940),
      dy: (i * 7) % 6,
      r: 8 + ((i * 11) % 12),
      fill: PEBBLE_FILLS[i % PEBBLE_FILLS.length]!,
    })),
    corals: Array.from({ length: fullscreen ? 4 : 2 }, (_, i) => ({
      x: 120 + ((i * 331) % 800),
      fill: CORAL_FILLS[i % CORAL_FILLS.length]!,
    })),
  };
}

// Bubble rate 1 keeps the original count (bubbleCount); still water thins it, a strong current fills it.
function bubblesFor(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    left: 6 + ((i * 41) % 88),
    size: 4 + ((i * 29) % 8),
    duration: 5 + ((i * 17) % 6),
    delay: -((i * 2.1) % 9),
  }));
}

// A handful of drifting night plankton specks, deterministic like the decor.
function planktonFor(width: number, fullscreen: boolean) {
  const n = Math.min(28, Math.max(10, Math.round(Math.max(width, 600) / (fullscreen ? 70 : 90))));
  return Array.from({ length: n }, (_, i) => ({
    left: 3 + ((i * 37) % 94),
    top: 8 + ((i * 31) % 72),
    size: 1.5 + ((i * 7) % 3) * 0.75,
    duration: 9 + ((i * 13) % 9),
    delay: -((i * 3.7) % 12),
  }));
}

// playbackRate keeps each animation's phase; changing animation-duration would jump it.
// Reduced motion stops the caustics in CSS, so turning it off restarts them at rate 1 and needs the rate again.
function useCausticSpeed(ref: React.RefObject<HTMLDivElement | null>, speed: number, reduced: boolean) {
  useEffect(() => {
    const rate = 1 / Math.max(0.25, speed);
    for (const el of ref.current?.querySelectorAll<HTMLElement>('.reef-caustic') ?? []) {
      for (const a of el.getAnimations?.() ?? []) a.updatePlaybackRate(rate);
    }
  }, [ref, speed, reduced]);
}

// Holds the snapped rate across renders so a rate near a step edge never flaps (snapBubbleRate).
function useSnappedBubbleRate(raw: number): number {
  const [snapped, setSnapped] = useState(() => snapBubbleRate(raw, null));
  const next = snapBubbleRate(raw, snapped);
  if (next !== snapped) setSnapped(next);
  return next;
}

// Start every weed's sway at the clock's zero, so the sim (weedSway) knows each weed's phase from `now` alone.
function useWeedClock(ref: React.RefObject<HTMLDivElement | null>, weeds: unknown[]) {
  // Before paint, so a weed never shows a frame at its mount-time phase.
  useLayoutEffect(() => {
    for (const el of ref.current?.querySelectorAll<SVGElement>('.reef-sway') ?? []) {
      for (const a of el.getAnimations?.() ?? []) a.startTime = 0;
    }
  }, [ref, weeds]);
}

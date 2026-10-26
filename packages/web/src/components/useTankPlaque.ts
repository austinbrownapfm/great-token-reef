import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ENTRIES, SPECIES_DEFS } from '@gtr/shared';
import type { ReefSpeciesRow } from '../lib/api';
import { hudReserve, isPlaqueEscape, placePlaque, plaqueFor, shouldClosePlaque } from '../lib/tankPlaque';
import type { RosterFish } from '../lib/tankPicks';
import { rosterId } from '../lib/tankScenery';
import { hold, puff as puffFish, type Bounds, type Swimmer } from '../lib/tankSim';
import { uiEvent } from '../lib/telemetry';
import type { ScreenMode } from '../lib/tankLayout';

/** Hover and plaque state for tank fish: holds the fish still, opens its plaque, closes it on Esc, outside clicks or exit. */
export function useTankPlaque({
  tankRef, simRef, fishRefs, plaqueEl, plaqueIdRef, hudRef, bounds, fullscreen, toggle, arranging, roster, masked,
}: {
  tankRef: React.RefObject<HTMLDivElement | null>;
  simRef: React.MutableRefObject<Swimmer[]>;
  fishRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  plaqueEl: React.RefObject<HTMLDivElement | null>;
  plaqueIdRef: React.MutableRefObject<string | null>;
  hudRef: React.RefObject<HTMLDivElement | null>;
  bounds: Bounds;
  fullscreen: ScreenMode;
  toggle: () => void;
  arranging: boolean;
  roster: RosterFish[];
  masked: ReefSpeciesRow[];
}) {
  const navigate = useNavigate({ from: '/' });
  const [hovered, setHovered] = useState<string | null>(null);
  const hoveredRef = useRef<string | null>(null);
  const [plaque, setPlaque] = useState<string | null>(null);

  // A fish is held while hovered or while its plaque is open.
  const applyHolds = useCallback(() => {
    const now = performance.now() / 1000;
    for (const s of simRef.current) hold(s, s.id === hoveredRef.current || s.id === plaqueIdRef.current, now);
  }, [simRef, plaqueIdRef]);
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
  }, [applyHolds, fishRefs, plaqueIdRef]);
  const placePlaqueNow = useCallback(() => {
    const el = plaqueEl.current;
    const s = simRef.current.find((x) => x.id === plaqueIdRef.current);
    if (el && s) placePlaque(el, s, bounds, hudReserve(hudRef.current));
  }, [simRef, bounds, plaqueEl, plaqueIdRef, hudRef]);
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
  }, [plaque, closePlaque, tankRef, plaqueEl]);
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
  const hoveredFish = hovered ? roster.find((r) => rosterId(r) === hovered) : undefined;
  const hoveredSwimmer = hovered ? simRef.current.find((s) => s.id === hovered) : undefined;
  const plaqueFish = plaque ? roster.find((r) => rosterId(r) === plaque) : undefined;
  const plaqueText = useMemo(() => plaqueFor(plaqueFish?.species, masked), [plaqueFish, masked]);
  // A fish released away or swum off takes its plaque with it.
  useEffect(() => {
    if (plaque && !plaqueText) closePlaque();
  }, [plaque, plaqueText, closePlaque]);

  return {
    hovered, plaque, hoveredFish, hoveredSwimmer, plaqueFish, plaqueText, refocusing,
    setHover, openPlaque, closePlaque, placePlaqueNow, openDex,
  };
}

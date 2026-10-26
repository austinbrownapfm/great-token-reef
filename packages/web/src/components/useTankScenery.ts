import { useEffect, useLayoutEffect, useState } from 'react';
import { snapBubbleRate } from '../lib/tankEnv';

// playbackRate keeps each animation's phase; changing animation-duration would jump it.
// Reduced motion stops the caustics in CSS, so turning it off restarts them at rate 1 and needs the rate again.
export function useCausticSpeed(ref: React.RefObject<HTMLDivElement | null>, speed: number, reduced: boolean) {
  useEffect(() => {
    const rate = 1 / Math.max(0.25, speed);
    for (const el of ref.current?.querySelectorAll<HTMLElement>('.reef-caustic') ?? []) {
      for (const a of el.getAnimations?.() ?? []) a.updatePlaybackRate(rate);
    }
  }, [ref, speed, reduced]);
}

// Holds the snapped rate across renders so a rate near a step edge never flaps (snapBubbleRate).
export function useSnappedBubbleRate(raw: number): number {
  const [snapped, setSnapped] = useState(() => snapBubbleRate(raw, null));
  const next = snapBubbleRate(raw, snapped);
  if (next !== snapped) setSnapped(next);
  return next;
}

// Start every weed's sway at the clock's zero, so the sim (weedSway) knows each weed's phase from `now` alone.
export function useWeedClock(ref: React.RefObject<HTMLDivElement | null>, weeds: unknown[]) {
  // Before paint, so a weed never shows a frame at its mount-time phase.
  useLayoutEffect(() => {
    for (const el of ref.current?.querySelectorAll<SVGElement>('.reef-sway') ?? []) {
      for (const a of el.getAnimations?.() ?? []) a.startTime = 0;
    }
  }, [ref, weeds]);
}

import { useCallback, useEffect, useRef, useState } from 'react';

/** The fullscreen HUD band: its element for the swim loop and plaque, and its measured bottom edge. */
export function useTankHud() {
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
  return { hudRef, hudBottom, setHudEl };
}

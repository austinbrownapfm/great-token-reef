import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { tankLayout, type ScreenMode, type TankLayout } from '../lib/tankLayout';
import { uiEvent } from '../lib/telemetry';

type FullscreenMode = ScreenMode;

// Fullscreen API where available; otherwise a fixed-inset "theater" overlay.
// Either way Esc exits and the dwell time is logged on the way out.
export function useTankFullscreen(ref: React.RefObject<HTMLDivElement | null>) {
  const [mode, setMode] = useState<FullscreenMode>(null);
  const enteredAt = useRef<number | null>(null);

  const logChange = useCallback((on: boolean) => {
    uiEvent('reef.tank.fullscreen', on ? 'on' : 'off');
    if (on) enteredAt.current = Date.now();
    else if (enteredAt.current !== null) {
      uiEvent('reef.tank.fullscreen.dwell', String(Math.round((Date.now() - enteredAt.current) / 1000)));
      enteredAt.current = null;
    }
  }, []);

  useEffect(() => {
    const onChange = () => {
      const on = document.fullscreenElement === ref.current;
      setMode(on ? 'native' : null);
      logChange(on);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [ref, logChange]);

  useEffect(() => {
    if (mode !== 'theater') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMode(null);
        logChange(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mode, logChange]);

  const toggle = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (mode === 'native') {
      void document.exitFullscreen();
      return;
    }
    if (mode === 'theater') {
      setMode(null);
      logChange(false);
      return;
    }
    if (typeof el.requestFullscreen === 'function') {
      el.requestFullscreen().catch((err: unknown) => {
        console.warn('[reef] requestFullscreen failed, using theater mode', err);
        setMode('theater');
        logChange(true);
      });
    } else {
      setMode('theater');
      logChange(true);
    }
  }, [ref, mode, logChange]);

  return { fullscreen: mode, toggle };
}

/** The geometry's mode paired with its size: measures the restyled tank before paint so both land together. */
export function useTankLayout(ref: React.RefObject<HTMLDivElement | null>, mode: ScreenMode): TankLayout {
  const [layout, dispatch] = useReducer(tankLayout, { mode, width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    dispatch({ kind: 'mode', mode, width: r.width, height: r.height });
  }, [ref, mode]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const native = document.fullscreenElement === el;
      dispatch({ kind: 'resize', width: entry.contentRect.width, height: entry.contentRect.height, native });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return layout;
}

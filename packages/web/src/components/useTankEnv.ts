import { useEffect, useMemo, useState } from 'react';
import { useSearch } from '@tanstack/react-router';
import { claudeQuota } from '../lib/reefQuota';
import { burnRatio, tankEnv, type StormLevel, type TankEnv } from '../lib/tankEnv';
import { useReefSummary } from './ReefWidget';

// Tank environment (spec §3–4): hour (or ?reefTime), burn ratio and 5h quota (or ?reefStorm) from the summary query, re-evaluated every 60s.
export function useTankEnv(fullscreen: boolean): TankEnv {
  const summary = useReefSummary();
  const { reefTime, reefStorm } = useSearch({ strict: false }) as { reefTime?: number; reefStorm?: StormLevel };
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  return useMemo(() => {
    const d = new Date(nowMs);
    const hour = reefTime ?? d.getHours() + d.getMinutes() / 60;
    const ratio = summary ? burnRatio(summary.burn.tokensPerMin, summary.burn.tokensPerActiveMin7d) : 0;
    const quotaPct = summary ? claudeQuota(summary, Math.floor(nowMs / 1000)).pct : 0;
    const env = tankEnv({ hour, burnRatio: ratio, quotaPct, storm: reefStorm });
    return { ...env, vars: { ...env.vars, '--reef-scale': fullscreen ? '1.3' : '1' } };
  }, [summary, reefTime, reefStorm, nowMs, fullscreen]);
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(mq.matches);
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return reduced;
}

/** Keeps a layer mounted for `ms` after `on` goes false so it can fade out; reduced motion drops it at once. */
export function useLinger(on: boolean, ms: number, reduced: boolean): 'on' | 'leaving' | 'off' {
  const [wasOn, setWasOn] = useState(on);
  const [leaving, setLeaving] = useState(false);
  if (on !== wasOn) {
    setWasOn(on);
    setLeaving(!on);
  }
  useEffect(() => {
    if (!leaving) return;
    // Ended under reduced motion: drop it now, or turning reduced motion off later would replay the fade.
    if (reduced) {
      setLeaving(false);
      return;
    }
    const t = window.setTimeout(() => setLeaving(false), ms);
    return () => window.clearTimeout(t);
  }, [leaving, reduced, ms]);
  return on ? 'on' : leaving && !reduced ? 'leaving' : 'off';
}

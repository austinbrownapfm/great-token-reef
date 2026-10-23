import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { catchJerks, catchTotals, linesFor, type LineSpec } from '../lib/tankLines';

export const JERK_MS = 1200;

// Sessions for the tank's fishing lines, plus which bobbers are jerking from a fresh catch.
export function useTankLines(): { lines: LineSpec[]; jerking: Set<string> } {
  const sessions = useQuery({
    // Children share the row cap, so ask for enough rows that top-level sessions are never crowded out.
    queryKey: ['reef', 'sessions', 1, 'all', 200],
    queryFn: () => api.reef.sessions(1, 'all', 200),
    refetchInterval: 60_000,
    retry: false,
  });
  // dataUpdatedAt moves on every poll, so idle state refreshes even when rows are unchanged.
  const lines = useMemo(
    () => linesFor(sessions.data ?? [], Math.floor((sessions.dataUpdatedAt || Date.now()) / 1000)),
    [sessions.data, sessions.dataUpdatedAt],
  );

  const prevTotals = useRef(new Map<string, number>());
  const timers = useRef(new Set<number>());
  const [jerking, setJerking] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (!sessions.data) return;
    const next = catchTotals(sessions.data);
    const ids = catchJerks(prevTotals.current, next);
    prevTotals.current = next;
    if (ids.length === 0) return;
    setJerking((cur) => new Set([...cur, ...ids]));
    const t = window.setTimeout(() => {
      timers.current.delete(t);
      setJerking((cur) => new Set([...cur].filter((id) => !ids.includes(id))));
    }, JERK_MS);
    timers.current.add(t);
  }, [sessions.data]);
  useEffect(() => {
    const pending = timers.current;
    return () => { for (const t of pending) window.clearTimeout(t); };
  }, []);

  return { lines, jerking };
}

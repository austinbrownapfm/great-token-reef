import type { OfficialWindow, ReefSummary } from './api';

// An official reading is trusted only until its window resets; after that it describes a window that no longer exists.
export function officialFresh(
  win: OfficialWindow | null | undefined,
  fetchedAt: number | undefined,
  windowSec: number,
  nowSec: number,
): boolean {
  if (win?.utilization == null) return false;
  if (win.resetsAt) {
    const resetSec = Date.parse(win.resetsAt) / 1000;
    return Number.isFinite(resetSec) && resetSec > nowSec;
  }
  return fetchedAt !== undefined && nowSec - fetchedAt < windowSec;
}

// Official 5h utilization when synced and still fresh; measured estimate otherwise.
export function claudeQuota(
  s: ReefSummary,
  nowSec: number,
): { pct: number; resetIn: number | null; source: 'official' | 'measured' } {
  const q = s.claudeQuota;
  const official = q.official?.fiveHour;
  const useOfficial = officialFresh(official, q.official?.fetchedAt, 5 * 3600, nowSec);
  const pct = useOfficial
    ? Math.min(1, (official?.utilization ?? 0) / 100)
    : q.window5h.budget
      ? Math.min(1, q.window5h.tokens / q.window5h.budget)
      : 0;
  const officialReset = useOfficial && official?.resetsAt ? Math.floor(Date.parse(official.resetsAt) / 1000) - nowSec : null;
  const resetIn =
    officialReset !== null && officialReset > 0
      ? officialReset
      : q.window5h.resetAt
        ? q.window5h.resetAt - nowSec
        : null;
  return { pct, resetIn: resetIn !== null && resetIn > 0 ? resetIn : null, source: useOfficial ? 'official' : 'measured' };
}

// Amber and red warn about real limits; an estimated budget is a guess, so it stays calm.
export function gaugeColor(pct: number, estimated: boolean): string {
  if (estimated) return 'bg-cyan-600';
  return pct >= 0.9 ? 'bg-red-500' : pct >= 0.75 ? 'bg-amber-500' : 'bg-cyan-600';
}

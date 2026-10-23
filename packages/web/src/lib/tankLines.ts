import { catchesEarned, milestoneAt } from '@gtr/shared';
import type { ReefSessionRow } from './api';

// Fishing lines in the tank (spec §2): one per top-level session active in the last 24h.

export interface LineSpec {
  sessionId: string;
  agent: 'claude' | 'codex';
  label: string;
  project: string;
  tokens: number;
  endedAt: number;
  pct: number;
  idle: boolean;
  xFrac: number;
}

const DAY = 86_400;
const IDLE_AFTER = 1800;

export function progressPct(rewardTokens: number): number {
  const n = catchesEarned(rewardTokens);
  const prev = n > 0 ? milestoneAt(n - 1) : 0;
  const next = milestoneAt(n);
  return (rewardTokens - prev) / (next - prev);
}

// Pick the most recent, then order by start so a bobber keeps its spot as activity shifts.
export function linesFor(rows: ReefSessionRow[], nowSec: number, max = 6): LineSpec[] {
  const picked = rows
    .filter((r) => r.parent_session_id === null && nowSec - r.ended_at <= DAY)
    .sort((a, b) => b.ended_at - a.ended_at)
    .slice(0, max)
    .sort((a, b) => a.started_at - b.started_at || a.session_id.localeCompare(b.session_id));
  const n = picked.length;
  return picked.map((r, i) => ({
    sessionId: r.session_id,
    agent: r.agent,
    label: r.label,
    project: r.project,
    tokens: r.tokens,
    endedAt: r.ended_at,
    pct: progressPct(r.rewardTokens),
    idle: nowSec - r.ended_at > IDLE_AFTER,
    xFrac: (i + 1) / (n + 1),
  }));
}

export function catchTotals(rows: ReefSessionRow[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const r of rows) {
    const id = r.parent_session_id ?? r.session_id;
    totals.set(id, (totals.get(id) ?? 0) + r.catches);
  }
  return totals;
}

// Only sessions already seen can jerk: one entering the window brings catches it made earlier.
export function catchJerks(prev: Map<string, number>, next: Map<string, number>): string[] {
  const out: string[] = [];
  for (const [id, total] of next) {
    const before = prev.get(id);
    if (before !== undefined && total > before) out.push(id);
  }
  return out;
}

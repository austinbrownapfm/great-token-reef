import type { ReefBudgets } from '@gtr/shared';
import type { Db } from '../store/db.ts';
import { getSetting, setSetting } from './settings.ts';

// The Reef's settings-backed state: reward epochs, the release mark and budgets.

// The reef epoch: catches only award for milestone crossings at/after this
// timestamp (seeded by migration 1; self-heals if the row is missing).
const EPOCH_KEY = 'reefEpoch';

export function getReefEpoch(db: Db): number {
  const raw = getSetting(db, EPOCH_KEY);
  if (raw) return Number(raw);
  const now = Math.floor(Date.now() / 1000);
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(EPOCH_KEY, String(now));
  return now;
}

const RELEASED_KEY = 'releasedCatchId';

// Catches at or below this id are already in the tank; migration 1 seeds it at 0.
export function getReleasedCatchId(db: Db): number {
  return Number(getSetting(db, RELEASED_KEY) ?? 0);
}

export function setReleasedCatchId(db: Db, id: number): void {
  setSetting(db, RELEASED_KEY, String(id));
}

const CODEX_EPOCH_KEY = 'codexRewardEpoch';

// Reads must never activate rewards: scanner startup owns activation.
export function readCodexRewardEpoch(db: Db): number {
  const raw = getSetting(db, CODEX_EPOCH_KEY);
  return raw ? Number(raw) : Number.MAX_SAFE_INTEGER;
}

export function getCodexRewardEpoch(db: Db): number {
  const now = Math.floor(Date.now() / 1000);
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')
    .run(CODEX_EPOCH_KEY, String(now));
  return readCodexRewardEpoch(db);
}

/** Test hook (also handy for a deliberate re-grant): move the epoch. */
export function setReefEpoch(db: Db, ts: number): void {
  setSetting(db, EPOCH_KEY, String(ts));
}

// Budgets (plan limits aren't in the JSONL — user-confirmable settings with
// observed-peak estimates until then).
const BUDGET_KEY = 'budgets';

export function getReefBudgets(db: Db): ReefBudgets {
  const raw = getSetting(db, BUDGET_KEY);
  const parsed = raw ? (JSON.parse(raw) as Partial<ReefBudgets>) : {};
  return { window5h: parsed.window5h ?? null, week: parsed.week ?? null };
}

export function setReefBudgets(db: Db, budgets: ReefBudgets): ReefBudgets {
  setSetting(db, BUDGET_KEY, JSON.stringify(budgets));
  return budgets;
}

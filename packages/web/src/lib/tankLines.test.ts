import { describe, expect, it } from 'vitest';
import { milestoneAt } from '@gtr/shared';
import type { ReefSessionRow } from './api';
import { catchJerks, catchTotals, emptyTankMessage, linesFor } from './tankLines';

const NOW = 1_800_000_000;

function row(id: string, over: Partial<ReefSessionRow> = {}): ReefSessionRow {
  return {
    agent: 'claude', unpricedEvents: 0, session_id: id, label: id, project: '/src/p',
    started_at: NOW - 3600, ended_at: NOW - 60, tokens: 1000, rewardTokens: 1000, cost: 0, catches: 0,
    native_id: null, parent_session_id: null, model_provider: null, source: null, ...over,
  };
}

describe('linesFor', () => {
  it('drops child sessions and caps at six', () => {
    const rows = [
      ...Array.from({ length: 8 }, (_, i) => row(`s${i}`, { ended_at: NOW - 100 * i })),
      row('kid', { parent_session_id: 's0', ended_at: NOW }),
      row('old', { ended_at: NOW - 25 * 3600 }),
    ];
    const lines = linesFor(rows, NOW);
    expect(lines).toHaveLength(6);
    expect(lines.map((l) => l.sessionId)).not.toContain('kid');
    expect(lines.map((l) => l.sessionId)).not.toContain('old');
    expect(lines.map((l) => l.sessionId).sort()).toEqual(['s0', 's1', 's2', 's3', 's4', 's5']);
    expect(lines.map((l) => l.xFrac)).toEqual([1, 2, 3, 4, 5, 6].map((i) => i / 7));
  });

  it('keeps positions stable when activity order changes', () => {
    const a = row('a', { started_at: NOW - 900, ended_at: NOW - 10 });
    const b = row('b', { started_at: NOW - 600, ended_at: NOW - 500 });
    const before = linesFor([a, b], NOW).map((l) => l.sessionId);
    const after = linesFor([{ ...b, ended_at: NOW }, a], NOW).map((l) => l.sessionId);
    expect(before).toEqual(['a', 'b']);
    expect(after).toEqual(['a', 'b']);
  });

  it('marks sessions idle after 30 minutes', () => {
    const lines = linesFor([row('busy', { ended_at: NOW - 1800 }), row('quiet', { ended_at: NOW - 1801 })], NOW);
    expect(lines.find((l) => l.sessionId === 'busy')?.idle).toBe(false);
    expect(lines.find((l) => l.sessionId === 'quiet')?.idle).toBe(true);
  });

  it('computes pct like the session cards', () => {
    const at = linesFor([row('m', { rewardTokens: milestoneAt(0) })], NOW)[0]!;
    expect(at.pct).toBe(0);
    const half = linesFor([row('h', { rewardTokens: milestoneAt(0) / 2 })], NOW)[0]!;
    expect(half.pct).toBeCloseTo(0.5);
    const mid = (milestoneAt(0) + milestoneAt(1)) / 2;
    expect(linesFor([row('n', { rewardTokens: mid })], NOW)[0]!.pct).toBeCloseTo(0.5);
  });
});

describe('catch jerks', () => {
  it('a child catch jerks its parent', () => {
    const prev = catchTotals([row('p', { catches: 1 }), row('c', { parent_session_id: 'p', catches: 0 })]);
    const next = catchTotals([row('p', { catches: 1 }), row('c', { parent_session_id: 'p', catches: 1 })]);
    expect(next.get('p')).toBe(2);
    expect(next.has('c')).toBe(false);
    expect(catchJerks(prev, next)).toEqual(['p']);
  });

  it('a session appearing with existing catches does not jerk', () => {
    const prev = catchTotals([row('a', { catches: 1 })]);
    const next = catchTotals([row('a', { catches: 1 }), row('b', { catches: 2 })]);
    expect(catchJerks(prev, next)).toEqual([]);
  });

  it('first load never jerks', () => {
    const next = catchTotals([row('p', { catches: 3 })]);
    expect(catchJerks(new Map(), next)).toEqual([]);
  });
});

describe('emptyTankMessage', () => {
  it('stays silent when fish are waiting to release', () => {
    expect(emptyTankMessage({ waiting: 2, activeLines: 1 })).toBeNull();
  });
  it('says lines are in the water when sessions are active', () => {
    expect(emptyTankMessage({ waiting: 0, activeLines: 1 })).toBe('🎣 Lines are in the water. A session lands its first fish at 2M tokens.');
  });
  it('tells a new install how to get a fish', () => {
    expect(emptyTankMessage({ waiting: 0, activeLines: 0 })).toBe('🎣 No fish yet. Start a Claude Code or Codex session, and each one lands a fish at 2M tokens.');
  });
});

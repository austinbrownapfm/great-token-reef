import { describe, expect, it } from 'vitest';
import type { ReefSummary } from './api';
import { claudeQuota, gaugeColor, officialFresh } from './reefQuota';

const NOW = 1_800_000_000;
const iso = (sec: number) => new Date(sec * 1000).toISOString();

function summary(opts: {
  utilization?: number | null;
  resetsAt?: string | null;
  fetchedAt?: number;
  tokens?: number;
  budget?: number | null;
}): ReefSummary {
  const hasOfficial = opts.utilization !== undefined;
  return {
    claudeQuota: {
      window5h: { tokens: opts.tokens ?? 0, budget: opts.budget ?? null, budgetEstimated: false, startedAt: null, resetAt: null, limitAt: null },
      official: hasOfficial
        ? {
            fiveHour: { utilization: opts.utilization ?? null, resetsAt: opts.resetsAt ?? null },
            sevenDay: null,
            sevenDayOpus: null,
            sevenDaySonnet: null,
            plan: null,
            fetchedAt: opts.fetchedAt ?? NOW,
          }
        : null,
    },
  } as unknown as ReefSummary;
}

describe('claudeQuota', () => {
  it('uses a fresh official reading', () => {
    const q = claudeQuota(summary({ utilization: 92, resetsAt: iso(NOW + 3600) }), NOW);
    expect(q.pct).toBeCloseTo(0.92);
    expect(q.source).toBe('official');
    expect(q.resetIn).toBe(3600);
  });

  it('falls back to measured once the official window has reset', () => {
    const q = claudeQuota(summary({ utilization: 92, resetsAt: iso(NOW - 3600), tokens: 30, budget: 100 }), NOW);
    expect(q.pct).toBeCloseTo(0.3);
    expect(q.source).toBe('measured');
  });

  it('treats a null resetsAt as stale after one window', () => {
    const fresh = claudeQuota(summary({ utilization: 50, resetsAt: null, fetchedAt: NOW - 3600, tokens: 10, budget: 100 }), NOW);
    expect(fresh.source).toBe('official');
    const stale = claudeQuota(summary({ utilization: 50, resetsAt: null, fetchedAt: NOW - 5 * 3600 - 1, tokens: 10, budget: 100 }), NOW);
    expect(stale.source).toBe('measured');
    expect(stale.pct).toBeCloseTo(0.1);
  });

  it('returns pct 0 with no official and no budget', () => {
    const q = claudeQuota(summary({}), NOW);
    expect(q).toEqual({ pct: 0, resetIn: null, source: 'measured' });
  });
});

describe('officialFresh', () => {
  it('is false without a window or utilization', () => {
    expect(officialFresh(null, NOW, 5 * 3600, NOW)).toBe(false);
    expect(officialFresh({ utilization: null, resetsAt: iso(NOW + 60) }, NOW, 5 * 3600, NOW)).toBe(false);
  });

  it('is false when fetchedAt is missing and resetsAt is null', () => {
    expect(officialFresh({ utilization: 10, resetsAt: null }, undefined, 5 * 3600, NOW)).toBe(false);
  });
});

describe('gaugeColor', () => {
  it('is cyan for any estimated budget', () => {
    expect(gaugeColor(0.95, true)).toBe('bg-cyan-600');
    expect(gaugeColor(0.8, true)).toBe('bg-cyan-600');
  });
  it('uses amber and red for real limits', () => {
    expect(gaugeColor(0.5, false)).toBe('bg-cyan-600');
    expect(gaugeColor(0.75, false)).toBe('bg-amber-500');
    expect(gaugeColor(0.9, false)).toBe('bg-red-500');
  });
});

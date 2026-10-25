import { describe, expect, it } from 'vitest';
import { estimateCcCost, estimateCodexCost } from './pricing.ts';

describe('Codex API-equivalent pricing', () => {
  it('prices cached reads independently and counts output once', () => {
    expect(estimateCodexCost('gpt-6-astra', { input: 10_000, cacheRead: 20_000, output: 1_000 })).toBeCloseTo(0.17);
    expect(estimateCodexCost('gpt-5.2-codex', { input: 10_000, cacheRead: 20_000, output: 1_000 })).toBeCloseTo(0.035);
  });
  it('recognizes the documented 5.6 alias without guessing arbitrary suffixes', () => {
    const usage = { input: 100, cacheRead: 50, output: 20 };
    expect(estimateCodexCost('gpt-5.6', usage)).toBe(estimateCodexCost('gpt-5.6-sol', usage));
    expect(estimateCodexCost('gpt-6-astra-unverified', usage)).toBeNull();
  });
  it('marks unknown billing context as unknown rather than free', () => {
    expect(estimateCodexCost('__proto__', { input: 10, cacheRead: 0, output: 1 })).toBeNull();
    expect(estimateCodexCost('unknown', { input: 10, cacheRead: 0, output: 1 })).toBeNull();
    expect(estimateCodexCost('gpt-6-astra', { input: 272_001, cacheRead: 0, output: 1 })).toBeNull();
    expect(estimateCodexCost('gpt-6-astra', { input: 100, cacheRead: 0, output: 1, cacheWriteInput: 50 })).toBeNull();
    expect(estimateCodexCost('gpt-6-astra', { input: -1, cacheRead: 0, output: 1 })).toBeNull();
  });
  it('preserves the existing Claude cache calculation', () => {
    expect(estimateCcCost('claude-sonnet-4-6', { input: 1_000_000, output: 0, cacheRead: 1_000_000, cacheW5m: 1_000_000, cacheW1h: 1_000_000 })).toBeCloseTo(13.05);
  });
});

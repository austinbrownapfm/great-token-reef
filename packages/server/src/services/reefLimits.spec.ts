import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cachedClaudeLoginDetected, claudeLoginDetected, credentialCandidates, mapOauthUsage } from './reefLimits.ts';

describe('mapOauthUsage', () => {
  it('maps every window and builds the plan label', () => {
    const limits = mapOauthUsage(
      {
        five_hour: { utilization: 42.5, resets_at: '2026-10-23T18:00:00Z' },
        seven_day: { utilization: 10, resets_at: '2026-10-28T00:00:00Z' },
        seven_day_opus: { utilization: 3, resets_at: null },
        seven_day_sonnet: { utilization: 7, resets_at: '2026-10-28T00:00:00Z' },
      },
      { subscriptionType: 'max', rateLimitTier: 'default_claude_max_20x' },
      1_700_000_000,
    );
    expect(limits.fiveHour).toEqual({ utilization: 42.5, resetsAt: '2026-10-23T18:00:00Z' });
    expect(limits.sevenDay).toEqual({ utilization: 10, resetsAt: '2026-10-28T00:00:00Z' });
    expect(limits.sevenDayOpus).toEqual({ utilization: 3, resetsAt: null });
    expect(limits.sevenDaySonnet?.utilization).toBe(7);
    expect(limits.plan).toBe('Max 20x');
    expect(limits.fetchedAt).toBe(1_700_000_000);
  });

  it('returns null windows for missing or malformed entries', () => {
    const limits = mapOauthUsage({ five_hour: 'nope', seven_day: null }, {}, 5);
    expect(limits.fiveHour).toBeNull();
    expect(limits.sevenDay).toBeNull();
    expect(limits.sevenDayOpus).toBeNull();
    expect(limits.sevenDaySonnet).toBeNull();
    expect(limits.plan).toBeNull();
  });

  it('nulls non-numeric utilization and non-string resets_at', () => {
    const limits = mapOauthUsage({ five_hour: { utilization: '50', resets_at: 123 } }, {}, 5);
    expect(limits.fiveHour).toEqual({ utilization: null, resetsAt: null });
  });

  it('omits the multiplier when the tier has none', () => {
    expect(mapOauthUsage({}, { subscriptionType: 'pro', rateLimitTier: 'default' }, 1).plan).toBe('Pro');
  });
});

describe('claudeLoginDetected', () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'gtr-limits-'));
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  const keychainMissing = vi.fn(() => {
    throw new Error('exit 44');
  });
  const keychainPresent = vi.fn(() => '');

  it('is true with only the credentials file', () => {
    mkdirSync(join(home, '.claude'));
    writeFileSync(join(home, '.claude', '.credentials.json'), '{}');
    expect(claudeLoginDetected(keychainMissing, home)).toBe(true);
  });

  it('is true with only the Keychain item', () => {
    expect(claudeLoginDetected(keychainPresent, home)).toBe(true);
  });

  it('is false with neither', () => {
    expect(claudeLoginDetected(keychainMissing, home)).toBe(false);
  });

  it('never asks the Keychain for the secret (-w)', () => {
    const exec = vi.fn(() => '');
    claudeLoginDetected(exec, home);
    expect(exec).toHaveBeenCalledTimes(1);
    const [file, args] = exec.mock.calls[0] as unknown as [string, string[]];
    expect(file).toBe('security');
    expect(args).toEqual(['find-generic-password', '-s', 'Claude Code-credentials']);
    expect(args).not.toContain('-w');
  });
});

describe('credentialCandidates', () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'gtr-limits-'));
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  const blob = (accessToken: string, expiresAt?: number) =>
    JSON.stringify({ claudeAiOauth: { accessToken, subscriptionType: 'max', expiresAt } });

  it('reads the Keychain secret and the file, deduping and putting the fresher token first', () => {
    mkdirSync(join(home, '.claude'));
    writeFileSync(join(home, '.claude', '.credentials.json'), blob('file-token', Date.now() + 60_000));
    const exec = vi.fn(() => blob('keychain-token', Date.now() - 60_000));
    const out = credentialCandidates(exec, home);
    expect(out.map((c) => c.accessToken)).toEqual(['file-token', 'keychain-token']);
    expect((exec.mock.calls[0] as unknown as [string, string[]])[1]).toContain('-w');
  });

  it('throws when no source has credentials', () => {
    const exec = vi.fn(() => {
      throw new Error('exit 44');
    });
    expect(() => credentialCandidates(exec, home)).toThrow(/no Claude Code credentials/);
  });
});

describe('cachedClaudeLoginDetected', () => {
  it('probes once per ttl and again after it expires', () => {
    let t = 0;
    const detect = vi.fn(() => true);
    const cached = cachedClaudeLoginDetected(detect, 60_000, () => t);
    expect(cached()).toBe(true);
    t = 59_999;
    expect(cached()).toBe(true);
    expect(detect).toHaveBeenCalledTimes(1);
    detect.mockReturnValue(false);
    t = 60_000;
    expect(cached()).toBe(false);
    expect(detect).toHaveBeenCalledTimes(2);
  });
});

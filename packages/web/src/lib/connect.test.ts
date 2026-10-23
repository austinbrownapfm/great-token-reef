import { describe, expect, it } from 'vitest';
import type { ConnectStatus } from '@gtr/shared';
import { cardState } from './connect';

const gh = (over: Partial<ConnectStatus['github']>): ConnectStatus['github'] => ({
  connected: false, source: null, login: null, orgs: [], error: null, ...over,
});

describe('cardState', () => {
  it('connected without error is connected', () => {
    expect(cardState(gh({ connected: true, login: 'x' }))).toBe('connected');
  });
  it('an error wins even when connected', () => {
    expect(cardState(gh({ connected: true, error: 'bad token' }))).toBe('error');
  });
  it('neither is not-connected', () => {
    expect(cardState(gh({}))).toBe('not-connected');
  });
  it('claude detected maps to connected, undetected to not-connected', () => {
    expect(cardState({ detected: true, limitsFetchedAt: null })).toBe('connected');
    expect(cardState({ detected: false, limitsFetchedAt: null })).toBe('not-connected');
  });
});

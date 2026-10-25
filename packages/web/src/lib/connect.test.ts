import { describe, expect, it, vi } from 'vitest';
import type { ConnectStatus } from '@gtr/shared';
import { cardState, runCardMutation } from './connect';

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

describe('runCardMutation', () => {
  const fake = () => ({ reset: vi.fn(), mutate: vi.fn() });

  it('resets the other mutations on the card but not the one it starts', () => {
    const a = fake(), b = fake(), c = fake();
    runCardMutation(a, [a, b, c], 'x');
    expect(b.reset).toHaveBeenCalledOnce();
    expect(c.reset).toHaveBeenCalledOnce();
    expect(a.reset).not.toHaveBeenCalled();
    expect(a.mutate).toHaveBeenCalledWith('x', expect.any(Object));
  });

  it('resets itself on success so no token stays in its variables', () => {
    const a = fake();
    runCardMutation(a, [a], 'secret');
    a.mutate.mock.calls[0]![1].onSuccess();
    expect(a.reset).toHaveBeenCalledOnce();
  });
});

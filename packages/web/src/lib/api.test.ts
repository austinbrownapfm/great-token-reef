import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api.ts';

afterEach(() => vi.unstubAllGlobals());

describe('api mutations', () => {
  it('send a JSON content type even with no body', async () => {
    const fetchMock = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    await api.reef.scan();
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toEqual({ 'content-type': 'application/json' });
  });
});

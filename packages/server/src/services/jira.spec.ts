import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchDoneTickets, jiraMyself } from './jira.ts';

afterEach(() => vi.restoreAllMocks());

const cfg = { baseUrl: 'https://x.atlassian.net', email: 'a@b.com', apiToken: 'tok' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const callArgs = (f: ReturnType<typeof vi.fn>, n: number) => f.mock.calls[n]! as [string, { method: string; headers: Record<string, string>; body: string }];
const bodyOf = (f: ReturnType<typeof vi.fn>, n: number) => JSON.parse(callArgs(f, n)[1].body);

describe('fetchDoneTickets', () => {
  it('queries my tickets moved to Done since the cursor and maps the change time', async () => {
    const done = { key: 'A-9', fields: { summary: 'Ship it', statuscategorychangedate: '2026-10-21T15:30:00.000+0000' } };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ issues: [done], nextPageToken: 'p2' }))
      .mockResolvedValueOnce(json({ issues: [{ key: 'A-10', fields: { summary: 'Two', statuscategorychangedate: '2026-10-21T16:00:00.000+0000' } }] }));
    const out = await fetchDoneTickets(cfg, '2026-10-20T08:05:59.000Z', fetchImpl as unknown as typeof fetch);
    expect(out).toEqual([
      { key: 'A-9', summary: 'Ship it', url: 'https://x.atlassian.net/browse/A-9', resolvedAt: Math.floor(Date.parse('2026-10-21T15:30:00.000+0000') / 1000) },
      expect.objectContaining({ key: 'A-10', summary: 'Two' }),
    ]);
    const [url, init] = callArgs(fetchImpl, 0);
    expect(url).toBe('https://x.atlassian.net/rest/api/3/search/jql');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('a@b.com:tok').toString('base64')}`);
    expect((fetchImpl.mock.calls[0]![1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
    const b1 = bodyOf(fetchImpl, 0);
    expect(b1.jql).toBe('assignee = currentUser() AND statusCategory = Done AND statusCategoryChangedDate >= "2026-10-20 08:05"');
    expect(b1.fields).toEqual(['summary', 'statuscategorychangedate']);
    expect(bodyOf(fetchImpl, 1).nextPageToken).toBe('p2');
  });

  it('throws on non-2xx with status and body only', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchImpl = vi.fn().mockResolvedValue(new Response('nope', { status: 503 }));
    await expect(fetchDoneTickets(cfg, '2026-10-20T00:00:00Z', fetchImpl as unknown as typeof fetch)).rejects.toThrow('[jira] 503: nope');
  });
});

describe('jiraMyself', () => {
  it('GETs /myself with basic auth', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ accountId: '1' }));
    await jiraMyself(cfg, fetchImpl as unknown as typeof fetch);
    const [url, init] = callArgs(fetchImpl, 0);
    expect(url).toBe('https://x.atlassian.net/rest/api/3/myself');
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('a@b.com:tok').toString('base64')}`);
  });

  it('a failure message holds neither the token nor its base64 form', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const secret = 'jira_secret_token';
    const basic = Buffer.from(`a@b.com:${secret}`).toString('base64');
    const fetchImpl = vi.fn().mockResolvedValue(new Response('Unauthorized', { status: 401, headers: { 'x-auth': `Basic ${basic}` } }));
    const err = await jiraMyself({ ...cfg, apiToken: secret }, fetchImpl as unknown as typeof fetch).catch((e: Error) => e);
    const message = (err as Error).message;
    expect(message).toBe('[jira] 401: Unauthorized');
    expect(message).not.toContain(secret);
    expect(message).not.toContain(basic);
  });
});

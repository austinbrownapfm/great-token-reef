import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildPrSearch, fetchMergedPrs, fetchOpenPrs, ghCliToken, githubLogin, GithubAuthError } from './github.ts';

afterEach(() => vi.restoreAllMocks());

function node(number: number, rollup: string | null, author: string | null = 'bob') {
  return {
    repository: { name: 'reef', owner: { login: 'echo' } },
    number,
    title: `PR ${number}`,
    body: 'KEY-1',
    headRefName: `feat/${number}`,
    url: `https://github.com/echo/reef/pull/${number}`,
    isDraft: false,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-02T00:00:00Z',
    commits: { nodes: [{ commit: { committedDate: '2026-10-01T12:00:00Z', statusCheckRollup: rollup ? { state: rollup } : null } }] },
    reviewThreads: { nodes: [{ isResolved: false, path: 'src/a.ts', comments: { nodes: [{ author: author ? { login: author } : null, createdAt: '2026-10-02T01:00:00Z', url: 'https://github.com/c/1', body: 'fix this' }] } }] },
    reviews: { nodes: [
      { author: { login: 'carol' }, state: 'APPROVED', submittedAt: '2026-10-02T02:00:00Z', body: 'lgtm', url: 'https://github.com/r/1' },
      { author: { login: 'dave' }, state: 'COMMENTED', submittedAt: '2026-10-02T03:00:00Z', body: null, url: null } ] },
  };
}

function page(nodes: unknown[], hasNextPage: boolean) {
  return { data: { viewer: { login: 'octo' }, search: { pageInfo: { hasNextPage, endCursor: hasNextPage ? 'c1' : null }, nodes } } };
}

describe('buildPrSearch', () => {
  it('builds the exact search strings', () => {
    expect(buildPrSearch('open', [])).toBe('is:pr is:open author:@me');
    expect(buildPrSearch('merged', ['a', 'b'])).toBe('is:pr is:merged author:@me org:a org:b');
  });
});

describe('fetchOpenPrs', () => {
  it('pages through search results and maps dates/checks', async () => {
    const pages = [page([node(1, 'FAILURE', null)], true), page([node(2, null)], false)];
    const calls: { auth: string | null; ua: string | null; after: unknown; signal: unknown; query: string }[] = [];
    const fake = (async (_url: string, init: RequestInit) => {
      const sent = JSON.parse(init.body as string);
      const headers = new Headers(init.headers);
      calls.push({ auth: headers.get('Authorization'), ua: headers.get('User-Agent'), after: sent.variables.after, signal: init.signal, query: sent.query });
      return new Response(JSON.stringify(pages.shift()), { status: 200 });
    }) as unknown as typeof fetch;
    const { me, prs } = await fetchOpenPrs('tok', [], fake);
    expect(me).toBe('octo');
    expect(prs).toHaveLength(2);
    expect(prs[0]!.checks).toBe('failure');
    expect(prs[1]!.checks).toBe('none');
    expect(Number.isInteger(prs[0]!.headCommittedAt)).toBe(true);
    expect(prs[0]!.threads[0]!.comments[0]!.author).toBe('ghost');
    expect(prs[0]!.repo).toBe('reef');
    expect(calls[0]).toMatchObject({ auth: 'bearer tok', ua: 'great-token-reef', after: null });
    expect(calls[0]!.signal).toBeInstanceOf(AbortSignal);
    expect(calls[1]!.after).toBe('c1');
    expect(prs[0]!.reviews.map((r) => r.body)).toEqual(['lgtm', '']);
    expect(prs[0]!.threads[0]!.comments[0]!).toMatchObject({ url: 'https://github.com/c/1', body: 'fix this', path: 'src/a.ts' });
  });

  it('puts the orgs in the search and no request body names a hard-coded org', async () => {
    const bodies: string[] = [];
    const fake = (async (_url: string, init: RequestInit) => {
      bodies.push(init.body as string);
      return new Response(JSON.stringify(page([], false)), { status: 200 });
    }) as unknown as typeof fetch;
    await fetchOpenPrs('tok', ['echo'], fake);
    await fetchOpenPrs('tok', [], fake);
    expect(JSON.parse(bodies[0]!).variables.q).toBe('is:pr is:open author:@me org:echo');
    expect(JSON.parse(bodies[1]!).variables.q).toBe('is:pr is:open author:@me');
    expect(bodies.join('')).not.toContain('example-org');
  });

  it('throws GithubAuthError on 401', async () => {
    const fake401 = (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch;
    await expect(fetchOpenPrs('x', [], fake401)).rejects.toBeInstanceOf(GithubAuthError);
  });

  it('builds a failure message from the status and body only, never the token', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fake = (async () => new Response('server exploded', { status: 502, headers: { 'x-echo': 'ghp_tokenvalue' } })) as unknown as typeof fetch;
    const err = await fetchOpenPrs('ghp_tokenvalue', [], fake).catch((e: Error) => e);
    expect((err as Error).message).toBe('[github] 502: server exploded');
  });
});

describe('fetchMergedPrs', () => {
  const merged = (repo: string, number: number, mergedAt = '2026-10-21T10:00:00Z') => ({
    repository: { name: repo, owner: { login: 'echo' } }, number, title: `PR ${number}`, url: `https://github.com/echo/${repo}/pull/${number}`, mergedAt,
  });
  const mergedPage = (nodes: unknown[], hasNextPage: boolean) =>
    ({ data: { search: { pageInfo: { hasNextPage, endCursor: hasNextPage ? 'm1' : null }, nodes } } });

  it('searches merged PRs since the cursor, pages and maps', async () => {
    const pages = [mergedPage([merged('reef', 1)], true), mergedPage([merged('tank', 3)], false)];
    const sent: { q: string; after: unknown; query: string }[] = [];
    const fake = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      sent.push({ q: body.variables.q, after: body.variables.after, query: body.query });
      return new Response(JSON.stringify(pages.shift()), { status: 200 });
    }) as unknown as typeof fetch;
    const prs = await fetchMergedPrs('tok', ['echo'], '2026-10-20T08:30:00.000Z', fake);
    expect(sent[0]!.q).toBe('is:pr is:merged author:@me org:echo merged:>=2026-10-20T08:30:00Z');
    expect(sent[0]!.query).toMatch(/mergedAt/);
    expect(sent[1]!.after).toBe('m1');
    expect(prs).toEqual([
      { id: 'echo/reef#1', repo: 'reef', number: 1, title: 'PR 1', url: 'https://github.com/echo/reef/pull/1', mergedAt: Math.floor(Date.parse('2026-10-21T10:00:00Z') / 1000) },
      expect.objectContaining({ id: 'echo/tank#3', repo: 'tank' }),
    ]);
  });

  it('throws on graphql errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fake = (async () => new Response(JSON.stringify({ errors: [{ message: 'bad' }] }), { status: 200 })) as unknown as typeof fetch;
    await expect(fetchMergedPrs('tok', [], '2026-10-20T00:00:00Z', fake)).rejects.toThrow('bad');
  });
});

describe('githubLogin', () => {
  it('returns the login of the token owner', async () => {
    const calls: { url: string; auth: string | null; ua: string | null }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      calls.push({ url, auth: headers.get('Authorization'), ua: headers.get('User-Agent') });
      return new Response(JSON.stringify({ login: 'octo' }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await githubLogin('tok', fake)).toBe('octo');
    expect(calls[0]).toEqual({ url: 'https://api.github.com/user', auth: 'bearer tok', ua: 'great-token-reef' });
  });

  it('a rejected token is a readable error without the token', async () => {
    const fake = (async () => new Response('{"message":"Bad credentials"}', { status: 401 })) as unknown as typeof fetch;
    const err = await githubLogin('ghp_secret', fake).catch((e: Error) => e);
    expect((err as Error).message).toContain('401');
    expect((err as Error).message).not.toContain('ghp_secret');
  });
});

describe('ghCliToken', () => {
  it('returns gh output trimmed, with a 10 s timeout', async () => {
    const exec = vi.fn(async () => ({ stdout: 'abc\n' }));
    expect(await ghCliToken(exec as never)).toBe('abc');
    expect(exec).toHaveBeenCalledWith('gh', ['auth', 'token'], { timeout: 10_000 });
  });

  it('throws when gh fails, is empty, or times out', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(ghCliToken((async () => { throw new Error('no gh'); }) as never)).rejects.toThrow('gh auth token failed: no gh');
    await expect(ghCliToken((async () => ({ stdout: '\n' })) as never)).rejects.toThrow('empty');
    const killed = (async () => { throw Object.assign(new Error('Command failed'), { killed: true }); }) as never;
    await expect(ghCliToken(killed)).rejects.toThrow('timed out after 10s');
  });
});

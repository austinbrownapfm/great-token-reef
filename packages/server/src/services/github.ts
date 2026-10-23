import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PrChecks, RawPr } from './prCompute.ts';

const execFileAsync = promisify(execFile);

export class GithubAuthError extends Error {}

export interface GithubFetchResult { me: string; prs: RawPr[] }

export interface MergedPr { id: string; repo: string; number: number; title: string; url: string; mergedAt: number }

type Exec = (file: string, args: string[], opts: { timeout: number }) => Promise<{ stdout: string | Buffer }>;

const USER_AGENT = 'great-token-reef';

export async function ghCliToken(exec: Exec = execFileAsync as unknown as Exec): Promise<string> {
  let stdout: string | Buffer;
  try {
    ({ stdout } = await exec('gh', ['auth', 'token'], { timeout: 10_000 }));
  } catch (err) {
    // execFile kills the child on timeout and reports only "Command failed"
    const reason = (err as { killed?: boolean }).killed ? 'timed out after 10s' : (err instanceof Error ? err.message : String(err));
    console.warn(`[connect] gh auth token failed: ${reason}`);
    throw new Error(`gh auth token failed: ${reason}`);
  }
  const token = String(stdout).trim();
  if (!token) throw new Error('gh auth token returned an empty token');
  return token;
}

export function buildPrSearch(kind: 'open' | 'merged', orgs: string[]): string {
  return ['is:pr', `is:${kind}`, 'author:@me', ...orgs.map((org) => `org:${org}`)].join(' ');
}

const QUERY = `query($q: String!, $after: String) {
  viewer { login }
  search(query: $q, type: ISSUE, first: 50, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest {
      repository { name } number title body headRefName url isDraft createdAt updatedAt
      commits(last: 1) { nodes { commit { committedDate statusCheckRollup { state } } } }
      reviewThreads(first: 100) { nodes { isResolved path comments(first: 50) { nodes { author { login } createdAt url body } } } }
      reviews(first: 100) { nodes { author { login } state submittedAt body url } }
    } }
  }
}`;

const toSec = (iso: string | null | undefined): number => (iso ? Math.floor(Date.parse(iso) / 1000) : 0);

function mapChecks(state: string | null | undefined): PrChecks {
  switch (state) {
    case 'SUCCESS': return 'success';
    case 'FAILURE':
    case 'ERROR': return 'failure';
    case 'PENDING':
    case 'EXPECTED': return 'pending';
    default: return 'none';
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapPr(n: any): RawPr {
  const commit = n.commits?.nodes?.[0]?.commit;
  return {
    repo: n.repository.name,
    number: n.number,
    title: n.title,
    body: n.body ?? '',
    branch: n.headRefName,
    url: n.url,
    isDraft: n.isDraft,
    createdAt: toSec(n.createdAt),
    updatedAt: toSec(n.updatedAt),
    headCommittedAt: toSec(commit?.committedDate),
    checks: mapChecks(commit?.statusCheckRollup?.state),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    threads: (n.reviewThreads?.nodes ?? []).map((t: any) => ({
      isResolved: t.isResolved,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      comments: (t.comments?.nodes ?? []).map((c: any) => ({
        author: c.author?.login ?? 'ghost', createdAt: toSec(c.createdAt), url: c.url ?? null, body: c.body ?? '', path: t.path ?? null,
      })),
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    reviews: (n.reviews?.nodes ?? []).map((r: any) => ({
      author: r.author?.login ?? 'ghost', state: r.state, submittedAt: toSec(r.submittedAt), body: r.body ?? '', url: r.url ?? null,
    })),
  };
}

const headers = (token: string) => ({ Authorization: `bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': USER_AGENT });

// Messages carry only the status and response body: never headers or the token.
async function failure(res: Response): Promise<Error> {
  console.error(`[visitors] github request failed: ${res.status}`);
  return new Error(`[github] ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

export async function githubLogin(token: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl('https://api.github.com/user', {
    method: 'GET',
    headers: headers(token),
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status !== 200) throw await failure(res);
  const login = ((await res.json()) as { login?: unknown }).login;
  if (typeof login !== 'string' || login === '') throw new Error('[github] response had no login');
  return login;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function graphql(token: string, query: string, variables: Record<string, unknown>, fetchImpl: typeof fetch): Promise<any> {
  const res: Response = await fetchImpl('https://api.github.com/graphql', {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 401) throw new GithubAuthError('github rejected token (401)');
  if (res.status !== 200) throw await failure(res);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json: any = await res.json();
  if (json.errors?.length) {
    console.error(`[visitors] github graphql errors: ${json.errors[0].message}`);
    throw new Error(`[github] ${res.status}: ${json.errors[0].message}`);
  }
  return json;
}

export async function fetchOpenPrs(token: string, orgs: string[], fetchImpl: typeof fetch = fetch): Promise<GithubFetchResult> {
  const q = buildPrSearch('open', orgs);
  let me = '';
  const prs: RawPr[] = [];
  let after: string | null = null;
  for (;;) {
    const json = await graphql(token, QUERY, { q, after }, fetchImpl);
    me = json.data.viewer.login;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const search: any = json.data.search;
    for (const n of search.nodes) if (n?.number != null) prs.push(mapPr(n));
    if (!search.pageInfo.hasNextPage) break;
    after = search.pageInfo.endCursor;
  }
  return { me, prs };
}

const MERGED_QUERY = `query($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: 50, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest { repository { name } number title url mergedAt } }
  }
}`;

export async function fetchMergedPrs(
  token: string,
  orgs: string[],
  sinceIso: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MergedPr[]> {
  const since = new Date(sinceIso).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const q = `${buildPrSearch('merged', orgs)} merged:>=${since}`;
  const out: MergedPr[] = [];
  let after: string | null = null;
  for (;;) {
    const json = await graphql(token, MERGED_QUERY, { q, after }, fetchImpl);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const search: any = json.data.search;
    for (const n of search.nodes) {
      if (n?.number == null || !n.mergedAt) continue;
      out.push({ id: `${n.repository.name}#${n.number}`, repo: n.repository.name, number: n.number, title: n.title, url: n.url, mergedAt: toSec(n.mergedAt) });
    }
    if (!search.pageInfo.hasNextPage) return out;
    after = search.pageInfo.endCursor;
  }
}

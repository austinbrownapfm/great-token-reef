import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
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

export function buildPrSearch(kind: 'open' | 'merged', orgs: string[], excludedRepos: string[] = []): string {
  return ['is:pr', `is:${kind}`, 'author:@me', ...orgs.map((org) => `org:${org}`), ...excludedRepos.map((r) => `-repo:${r}`)].join(' ');
}

// Defence in depth: the search qualifier should already exclude these, but never show a hidden repo.
const isExcluded = (excluded: Set<string>, owner: string, repo: string) => excluded.has(`${owner}/${repo}`.toLowerCase());
const excludedSet = (repos: string[]) => new Set(repos.map((r) => r.toLowerCase()));

const QUERY = `query($q: String!, $after: String) {
  viewer { login }
  search(query: $q, type: ISSUE, first: 50, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest {
      repository { name owner { login } } number title body headRefName url isDraft createdAt updatedAt
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

// Response shapes for the queries above. Optional fields stay optional, so only a genuinely
// different response fails, and it fails with a readable error instead of a TypeError mid-sync.
const Author = z.object({ login: z.string() }).nullish();
const Repository = z.object({ name: z.string(), owner: Author });
const PrNode = z.object({
  repository: Repository,
  number: z.number().int(),
  title: z.string(),
  body: z.string().nullish(),
  headRefName: z.string(),
  url: z.string(),
  isDraft: z.boolean(),
  createdAt: z.string().nullish(),
  updatedAt: z.string().nullish(),
  commits: z.object({ nodes: z.array(z.object({ commit: z.object({
    committedDate: z.string().nullish(),
    statusCheckRollup: z.object({ state: z.string().nullish() }).nullish(),
  }) }).nullable()).nullish() }).nullish(),
  reviewThreads: z.object({ nodes: z.array(z.object({
    isResolved: z.boolean(),
    path: z.string().nullish(),
    comments: z.object({ nodes: z.array(z.object({
      author: Author, createdAt: z.string().nullish(), url: z.string().nullish(), body: z.string().nullish(),
    })).nullish() }).nullish(),
  })).nullish() }).nullish(),
  reviews: z.object({ nodes: z.array(z.object({
    author: Author,
    state: z.enum(['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED', 'PENDING']),
    submittedAt: z.string().nullish(),
    body: z.string().nullish(),
    url: z.string().nullish(),
  })).nullish() }).nullish(),
});
const MergedNode = z.object({ repository: Repository, number: z.number().int(), title: z.string(), url: z.string(), mergedAt: z.string().nullish() });
// Search can return non-PR results as empty objects; those carry no number and are skipped.
const Search = z.object({
  pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
  nodes: z.array(z.record(z.string(), z.unknown()).nullable()),
});
const OpenResponse = z.object({ viewer: z.object({ login: z.string() }), search: Search });
const MergedResponse = z.object({ search: Search });
const GraphqlEnvelope = z.object({ data: z.unknown().optional(), errors: z.array(z.object({ message: z.string() })).optional() });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issue = result.error.issues[0]!;
  throw new Error(`[github] unexpected response at ${issue.path.join('.') || '(root)'}: ${issue.message}`);
}

const prNodes = <T>(schema: z.ZodType<T>, nodes: z.infer<typeof Search>['nodes']): T[] =>
  nodes.filter((n) => n?.number != null).map((n) => parse(schema, n));

function mapPr(n: z.infer<typeof PrNode>): RawPr {
  const commit = n.commits?.nodes?.[0]?.commit;
  return {
    owner: n.repository.owner?.login ?? '',
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
    threads: (n.reviewThreads?.nodes ?? []).map((t) => ({
      isResolved: t.isResolved,
      comments: (t.comments?.nodes ?? []).map((c) => ({
        author: c.author?.login ?? 'ghost', createdAt: toSec(c.createdAt), url: c.url ?? null, body: c.body ?? '', path: t.path ?? null,
      })),
    })),
    reviews: (n.reviews?.nodes ?? []).map((r) => ({
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

async function graphql<T>(token: string, query: string, variables: Record<string, unknown>, fetchImpl: typeof fetch, schema: z.ZodType<T>): Promise<T> {
  const res: Response = await fetchImpl('https://api.github.com/graphql', {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 401) throw new GithubAuthError('github rejected token (401)');
  if (res.status !== 200) throw await failure(res);
  const json = parse(GraphqlEnvelope, await res.json());
  if (json.errors?.length) {
    console.error(`[visitors] github graphql errors: ${json.errors[0]!.message}`);
    throw new Error(`[github] ${res.status}: ${json.errors[0]!.message}`);
  }
  return parse(schema, json.data);
}

export async function fetchOpenPrs(token: string, orgs: string[], excludedRepos: string[], fetchImpl: typeof fetch = fetch): Promise<GithubFetchResult> {
  const q = buildPrSearch('open', orgs, excludedRepos);
  const excluded = excludedSet(excludedRepos);
  let me: string;
  const prs: RawPr[] = [];
  let after: string | null = null;
  for (;;) {
    const data: z.infer<typeof OpenResponse> = await graphql(token, QUERY, { q, after }, fetchImpl, OpenResponse);
    me = data.viewer.login;
    const search = data.search;
    for (const n of prNodes(PrNode, search.nodes)) {
      const pr = mapPr(n);
      if (!isExcluded(excluded, pr.owner, pr.repo)) prs.push(pr);
    }
    if (!search.pageInfo.hasNextPage) break;
    after = search.pageInfo.endCursor;
  }
  return { me, prs };
}

const MERGED_QUERY = `query($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: 50, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest { repository { name owner { login } } number title url mergedAt } }
  }
}`;

export async function fetchMergedPrs(
  token: string,
  orgs: string[],
  excludedRepos: string[],
  sinceIso: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MergedPr[]> {
  const since = new Date(sinceIso).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const q = `${buildPrSearch('merged', orgs, excludedRepos)} merged:>=${since}`;
  const excluded = excludedSet(excludedRepos);
  const out: MergedPr[] = [];
  let after: string | null = null;
  for (;;) {
    const { search }: z.infer<typeof MergedResponse> = await graphql(token, MERGED_QUERY, { q, after }, fetchImpl, MergedResponse);
    for (const n of prNodes(MergedNode, search.nodes)) {
      if (!n.mergedAt) continue;
      if (isExcluded(excluded, n.repository.owner?.login ?? '', n.repository.name)) continue;
      out.push({ id: `${n.repository.owner?.login ?? ''}/${n.repository.name}#${n.number}`, repo: n.repository.name, number: n.number, title: n.title, url: n.url, mergedAt: toSec(n.mergedAt) });
    }
    if (!search.pageInfo.hasNextPage) return out;
    after = search.pageInfo.endCursor;
  }
}

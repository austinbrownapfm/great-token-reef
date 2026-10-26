import { z } from 'zod';

export const unixSeconds = z.number().int();

// Latest failed Reef visitor fetch per source (merged PRs, Done tickets); cleared by the next good fetch.
export const ReefVisitorError = z.object({
  source: z.enum(['github', 'jira']),
  message: z.string(),
  at: unixSeconds,
});
export type ReefVisitorError = z.infer<typeof ReefVisitorError>;

export const UsageEventKind = z.enum(['rest', 'ui']);
export type UsageEventKind = z.infer<typeof UsageEventKind>;

/** POST /api/events/ui request body. */
export const UiEventBody = z.object({
  name: z.string().min(1).max(200),
  detail: z.string().max(2000).optional(),
});
export type UiEventBody = z.infer<typeof UiEventBody>;

export const OpenPr = z.strictObject({
  id: z.string(), repo: z.string(), number: z.number().int(),
  title: z.string(), url: z.string(),
  state: z.enum(['draft', 'ready', 'approved', 'changes_requested']),
  needsMe: z.boolean(), botFindings: z.number().int(), createdAt: z.number().int(),
});
export type OpenPr = z.infer<typeof OpenPr>;

export const ConnectStatus = z.strictObject({
  claude: z.strictObject({ detected: z.boolean(), limitsFetchedAt: z.number().nullable() }),
  github: z.strictObject({
    connected: z.boolean(),
    source: z.enum(['gh', 'token']).nullable(),
    login: z.string().nullable(),
    orgs: z.array(z.string()),
    excludedRepos: z.array(z.string()),
    error: z.string().nullable(),
  }),
  jira: z.strictObject({
    connected: z.boolean(),
    baseUrl: z.string().nullable(),
    email: z.string().nullable(),
    error: z.string().nullable(),
  }),
});
export type ConnectStatus = z.infer<typeof ConnectStatus>;

// Connect request bodies (PUT /api/connect/...).
export const ConnectGithubBody = z.discriminatedUnion('source', [
  z.object({ source: z.literal('gh') }),
  z.object({ source: z.literal('token'), token: z.string().min(1).max(500) }),
]);
export type ConnectGithubBody = z.infer<typeof ConnectGithubBody>;

export const ConnectOrgsBody = z.object({ orgs: z.array(z.string().max(100)).max(100) });
export type ConnectOrgsBody = z.infer<typeof ConnectOrgsBody>;

export const ConnectExcludedReposBody = z.object({ repos: z.array(z.string().max(200)).max(100) });
export type ConnectExcludedReposBody = z.infer<typeof ConnectExcludedReposBody>;

export const ConnectJiraBody = z.object({
  baseUrl: z.string().min(1).max(500),
  email: z.string().min(1).max(320),
  apiToken: z.string().min(1).max(2000),
});
export type ConnectJiraBody = z.infer<typeof ConnectJiraBody>;

// A usage scanner's indexing state (Claude Code and Codex share the shape).
export const ScannerStatus = z.strictObject({
  enabled: z.boolean(),
  lastScanAt: unixSeconds.nullable(),
  backfilling: z.boolean(),
  files: z.number().int(),
  diagnosticCount: z.number().int(),
  errors: z.array(z.strictObject({ path: z.string(), error: z.string(), diagnostic: z.boolean().optional() })),
  rootErrors: z.array(z.string()),
});
export type ScannerStatus = z.infer<typeof ScannerStatus>;

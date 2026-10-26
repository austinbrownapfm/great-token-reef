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

export const OpenPr = z.object({
  id: z.string(), repo: z.string(), number: z.number().int(),
  title: z.string(), url: z.string(),
  state: z.enum(['draft', 'ready', 'approved', 'changes_requested']),
  needsMe: z.boolean(), botFindings: z.number().int(), createdAt: z.number().int(),
});
export type OpenPr = z.infer<typeof OpenPr>;

export const ConnectStatus = z.object({
  claude: z.object({ detected: z.boolean(), limitsFetchedAt: z.number().nullable() }),
  github: z.object({
    connected: z.boolean(),
    source: z.enum(['gh', 'token']).nullable(),
    login: z.string().nullable(),
    orgs: z.array(z.string()),
    excludedRepos: z.array(z.string()),
    error: z.string().nullable(),
  }),
  jira: z.object({
    connected: z.boolean(),
    baseUrl: z.string().nullable(),
    email: z.string().nullable(),
    error: z.string().nullable(),
  }),
});
export type ConnectStatus = z.infer<typeof ConnectStatus>;

// A usage scanner's indexing state (Claude Code and Codex share the shape).
export const ScannerStatus = z.object({
  enabled: z.boolean(),
  lastScanAt: unixSeconds.nullable(),
  backfilling: z.boolean(),
  files: z.number().int(),
  diagnosticCount: z.number().int(),
  errors: z.array(z.object({ path: z.string(), error: z.string(), diagnostic: z.boolean().optional() })),
  rootErrors: z.array(z.string()),
});
export type ScannerStatus = z.infer<typeof ScannerStatus>;

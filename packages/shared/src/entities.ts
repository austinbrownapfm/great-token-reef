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

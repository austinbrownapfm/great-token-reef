export type PrState = 'draft' | 'ready' | 'approved' | 'changes_requested';
export type PrChecks = 'success' | 'failure' | 'pending' | 'none';

export interface FeedbackItem {
  kind: 'comment' | 'review';
  author: string;
  at: number;
  state: 'COMMENTED' | 'CHANGES_REQUESTED' | null;
  url: string | null;
  body: string;
  path: string | null;
}

export interface RawReviewComment {
  author: string;
  createdAt: number;
  url: string | null;
  body: string;
  path: string | null;
}
export interface RawThread { isResolved: boolean; comments: RawReviewComment[] }
export interface RawReview {
  author: string;
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
  submittedAt: number;
  body: string;
  url: string | null;
}
export interface RawPr {
  owner: string;
  repo: string;
  number: number;
  title: string;
  body: string;
  branch: string;
  url: string;
  isDraft: boolean;
  createdAt: number;
  updatedAt: number;
  headCommittedAt: number;
  checks: PrChecks;
  threads: RawThread[];
  reviews: RawReview[];
}

export function isBot(login: string): boolean {
  return login.endsWith('[bot]');
}

export function computePrState(pr: RawPr, me: string): PrState {
  if (pr.isDraft) return 'draft';
  const latest = new Map<string, RawReview>();
  for (const r of pr.reviews) {
    if (isBot(r.author) || r.author === me) continue;
    // GitHub wraps every thread reply in a COMMENTED review; it must not mask a verdict
    if (r.state === 'COMMENTED' || r.state === 'PENDING') continue;
    const prev = latest.get(r.author);
    const wins = !prev || r.submittedAt > prev.submittedAt
      || (r.submittedAt === prev.submittedAt && r.state === 'CHANGES_REQUESTED');
    if (wins) latest.set(r.author, r);
  }
  const states = [...latest.values()].map((r) => r.state);
  if (states.includes('CHANGES_REQUESTED')) return 'changes_requested';
  if (states.includes('APPROVED')) return 'approved';
  return 'ready';
}

const FEEDBACK_BODY_MAX = 500;
const clip = (body: string): string => body.trim().slice(0, FEEDBACK_BODY_MAX);

export interface FeedbackSummary {
  newFeedback: number;
  unresolvedThreads: number;
  botFindings: number;
  items: FeedbackItem[];
}

export function computeFeedback(pr: RawPr, me: string): FeedbackSummary {
  const items: FeedbackItem[] = [];
  let unresolvedThreads = 0;
  let botFindings = 0;
  for (const t of pr.threads) {
    if (t.isResolved) continue;
    let hasHuman = false;
    for (const c of t.comments) {
      if (isBot(c.author)) botFindings++;
      else if (c.author !== me) {
        hasHuman = true;
        if (c.createdAt > pr.headCommittedAt) {
          items.push({ kind: 'comment', author: c.author, at: c.createdAt, state: null, url: c.url, body: clip(c.body), path: c.path });
        }
      }
    }
    if (hasHuman) unresolvedThreads++;
  }
  for (const r of pr.reviews) {
    if (r.submittedAt <= pr.headCommittedAt) continue;
    if (isBot(r.author)) botFindings++;
    else if (r.author === me) continue;
    // an empty-body COMMENTED review is a thread-reply wrapper, already counted above
    else if (r.state === 'CHANGES_REQUESTED' || (r.state === 'COMMENTED' && r.body.trim() !== '')) {
      items.push({ kind: 'review', author: r.author, at: r.submittedAt, state: r.state, url: r.url, body: clip(r.body), path: null });
    }
  }
  items.sort((a, b) => b.at - a.at);
  return { newFeedback: items.length, unresolvedThreads, botFindings, items };
}

export function computeNeedsMe(state: PrState, checks: PrChecks, newFeedback: number): boolean {
  return newFeedback > 0 || state === 'changes_requested' || checks === 'failure';
}

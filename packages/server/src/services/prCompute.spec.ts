import { describe, expect, it } from 'vitest';
import { computeFeedback, computeNeedsMe, computePrState, type RawPr } from './prCompute.ts';

function raw(overrides: Partial<RawPr> = {}): RawPr {
  return {
    repo: 'repo', number: 1, title: 't', body: '', branch: 'b', url: 'https://example.com/pr/1',
    isDraft: false, createdAt: 0, updatedAt: 0, headCommittedAt: 1000, checks: 'none', threads: [], reviews: [],
    ...overrides,
  };
}

describe('prCompute', () => {
  it('computePrState ignores bot change requests and prefers changes over approval', () => {
    const pr = raw({ reviews: [
      { author: 'review[bot]', state: 'CHANGES_REQUESTED', submittedAt: 1100, body: '', url: null },
      { author: 'alice', state: 'APPROVED', submittedAt: 1100, body: '', url: null } ] });
    expect(computePrState(pr, 'octo')).toBe('approved');
    pr.reviews.push({ author: 'bob', state: 'CHANGES_REQUESTED', submittedAt: 1200, body: '', url: null });
    expect(computePrState(pr, 'octo')).toBe('changes_requested');
    expect(computePrState(raw({ isDraft: true }), 'octo')).toBe('draft');
  });

  it('computeFeedback counts only human, unresolved, post-push items', () => {
    const c = (author: string, createdAt: number) => ({ author, createdAt, url: null, body: '', path: null });
    const pr = raw({ threads: [
      { isResolved: false, comments: [c('alice', 900), c('alice', 1100)] },
      { isResolved: true, comments: [c('alice', 1100)] },
      { isResolved: false, comments: [c('octo', 1100)] },
      { isResolved: false, comments: [c('sonar[bot]', 1100)] } ],
      reviews: [{ author: 'bob', state: 'COMMENTED', submittedAt: 1100, body: 'nit: rename', url: null }, { author: 'review[bot]', state: 'COMMENTED', submittedAt: 1100, body: '', url: null }] });
    expect(computeFeedback(pr, 'octo')).toMatchObject({ newFeedback: 2, unresolvedThreads: 1, botFindings: 2 });
  });

  it('a fresh push zeroes new feedback but keeps unresolved threads', () => {
    const pr = raw({ headCommittedAt: 5000, threads: [{ isResolved: false, comments: [{ author: 'alice', createdAt: 1100, url: null, body: '', path: null }] }] });
    expect(computeFeedback(pr, 'octo')).toMatchObject({ newFeedback: 0, unresolvedThreads: 1, botFindings: 0, items: [] });
    expect(computeNeedsMe('ready', 'success', 0)).toBe(false);
  });

  it('computeNeedsMe is true for feedback, changes requested, or failing checks', () => {
    expect(computeNeedsMe('ready', 'none', 1)).toBe(true);
    expect(computeNeedsMe('changes_requested', 'none', 0)).toBe(true);
    expect(computeNeedsMe('ready', 'failure', 0)).toBe(true);
  });

  it('post-push approval is not feedback; post-push changes request is', () => {
    const approved = raw({ reviews: [{ author: 'alice', state: 'APPROVED', submittedAt: 1100, body: '', url: null }] });
    expect(computeFeedback(approved, 'octo').newFeedback).toBe(0);
    const changes = raw({ reviews: [{ author: 'alice', state: 'CHANGES_REQUESTED', submittedAt: 1100, body: '', url: null }] });
    expect(computeFeedback(changes, 'octo').newFeedback).toBe(1);
  });

  it('equal-timestamp reviews prefer changes_requested regardless of order', () => {
    const a = { author: 'alice', state: 'APPROVED', submittedAt: 1100, body: '', url: null } as const;
    const c = { author: 'alice', state: 'CHANGES_REQUESTED', submittedAt: 1100, body: '', url: null } as const;
    expect(computePrState(raw({ reviews: [a, c] }), 'octo')).toBe('changes_requested');
    expect(computePrState(raw({ reviews: [c, a] }), 'octo')).toBe('changes_requested');
  });

  it('dismissed latest review clears a change request; my own reviews are ignored', () => {
    const dismissed = raw({ reviews: [
      { author: 'alice', state: 'CHANGES_REQUESTED', submittedAt: 1100, body: '', url: null },
      { author: 'alice', state: 'DISMISSED', submittedAt: 1200, body: '', url: null } ] });
    expect(computePrState(dismissed, 'octo')).toBe('ready');
    const mine = raw({ reviews: [{ author: 'octo', state: 'CHANGES_REQUESTED', submittedAt: 1100, body: '', url: null }] });
    expect(computePrState(mine, 'octo')).toBe('ready');
  });

  it('a later COMMENTED review does not overwrite a verdict', () => {
    const approved = raw({ reviews: [
      { author: 'alice', state: 'APPROVED', submittedAt: 1100, body: '', url: null },
      { author: 'alice', state: 'COMMENTED', submittedAt: 1200, body: '', url: null } ] });
    expect(computePrState(approved, 'octo')).toBe('approved');
    const changes = raw({ reviews: [
      { author: 'bob', state: 'CHANGES_REQUESTED', submittedAt: 1100, body: '', url: null },
      { author: 'bob', state: 'COMMENTED', submittedAt: 1200, body: 'replied', url: null } ] });
    expect(computePrState(changes, 'octo')).toBe('changes_requested');
    const lone = raw({ reviews: [{ author: 'carol', state: 'COMMENTED', submittedAt: 1200, body: 'hm', url: null }] });
    expect(computePrState(lone, 'octo')).toBe('ready');
  });

  it('post-push COMMENTED reviews count as feedback only when they have a body', () => {
    const empty = raw({ reviews: [{ author: 'alice', state: 'COMMENTED', submittedAt: 1100, body: '  ', url: null }] });
    expect(computeFeedback(empty, 'octo').newFeedback).toBe(0);
    const withBody = raw({ reviews: [{ author: 'alice', state: 'COMMENTED', submittedAt: 1100, body: 'please fix', url: null }] });
    expect(computeFeedback(withBody, 'octo').newFeedback).toBe(1);
  });

  it('computeFeedback items are exactly the counted feedback, newest first', () => {
    const pr = raw({ threads: [
      { isResolved: false, comments: [
        { author: 'alice', createdAt: 900, url: 'u/old', body: 'before push', path: 'a.ts' },
        { author: 'alice', createdAt: 1100, url: 'u/c1', body: '  rename this  ', path: 'a.ts' },
        { author: 'octo', createdAt: 1150, url: 'u/mine', body: 'done', path: 'a.ts' },
        { author: 'sonar[bot]', createdAt: 1160, url: 'u/bot', body: 'smell', path: 'a.ts' } ] },
      { isResolved: true, comments: [{ author: 'bob', createdAt: 1200, url: 'u/res', body: 'resolved', path: 'b.ts' }] } ],
      reviews: [
        { author: 'bob', state: 'CHANGES_REQUESTED', submittedAt: 1300, body: '', url: 'u/r1' },
        { author: 'carol', state: 'COMMENTED', submittedAt: 1250, body: 'overall ok', url: null },
        { author: 'dave', state: 'COMMENTED', submittedAt: 1400, body: ' ', url: 'u/wrapper' },
        { author: 'erin', state: 'APPROVED', submittedAt: 1500, body: 'lgtm', url: 'u/appr' } ] });
    const fb = computeFeedback(pr, 'octo');
    expect(fb.items).toEqual([
      { kind: 'review', author: 'bob', at: 1300, state: 'CHANGES_REQUESTED', url: 'u/r1', body: '', path: null },
      { kind: 'review', author: 'carol', at: 1250, state: 'COMMENTED', url: null, body: 'overall ok', path: null },
      { kind: 'comment', author: 'alice', at: 1100, state: null, url: 'u/c1', body: 'rename this', path: 'a.ts' },
    ]);
    expect(fb.newFeedback).toBe(fb.items.length);
  });

  it('computeFeedback truncates item bodies to 500 chars', () => {
    const pr = raw({ threads: [{ isResolved: false, comments: [{ author: 'alice', createdAt: 1100, url: null, body: 'x'.repeat(800), path: null }] }] });
    expect(computeFeedback(pr, 'octo').items[0]!.body).toHaveLength(500);
  });

  it('a review exactly at the head commit time is not new', () => {
    const pr = raw({ reviews: [{ author: 'alice', state: 'COMMENTED', submittedAt: 1000, body: 'looks off', url: null }] });
    expect(computeFeedback(pr, 'octo').newFeedback).toBe(0);
  });
});

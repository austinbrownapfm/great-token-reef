import { describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { Bus } from './bus.ts';
import { CodexUsageScanner } from './codexUsageScanner.ts';
import { fakeConnectDeps, fixtureDb } from './fixtures.ts';
import { listOpenPrs, replaceOpenPrs } from './openPrs.ts';
import { computeFeedback, computeNeedsMe, computePrState, type RawPr } from './prCompute.ts';
import { ReefScanner } from './reef.ts';

function raw(overrides: Partial<RawPr> = {}): RawPr {
  return {
    owner: 'echo', repo: 'reef', number: 1, title: 't', body: '', branch: 'b', url: 'https://example.com/pr/1',
    isDraft: false, createdAt: 100, updatedAt: 0, headCommittedAt: 1000, checks: 'none', threads: [], reviews: [],
    ...overrides,
  };
}

const failing = raw({
  number: 2, createdAt: 300, checks: 'failure',
  reviews: [{ author: 'bob', state: 'CHANGES_REQUESTED', submittedAt: 1100, body: 'no', url: null }],
  threads: [{ isResolved: false, comments: [{ author: 'review[bot]', createdAt: 1100, url: null, body: '', path: null }] }],
});

describe('open PRs', () => {
  it('stores needsMe, botFindings and state as the compute functions say', () => {
    const db = fixtureDb();
    const prs = [raw(), failing, raw({ number: 3, isDraft: true, createdAt: 300 })];
    expect(replaceOpenPrs(db, 'octo', prs)).toBe(3);
    const list = listOpenPrs(db);
    expect(list.map((p) => p.id)).toEqual(['echo/reef#2', 'echo/reef#3', 'echo/reef#1']);
    const two = list.find((p) => p.number === 2)!;
    const state = computePrState(failing, 'octo');
    const fb = computeFeedback(failing, 'octo');
    expect(two).toEqual({
      id: 'echo/reef#2', repo: 'reef', number: 2, title: 't', url: 'https://example.com/pr/1',
      state, needsMe: computeNeedsMe(state, failing.checks, fb.newFeedback), botFindings: fb.botFindings, createdAt: 300,
    });
    expect(two.needsMe).toBe(true);
    expect(two.botFindings).toBe(1);
    expect(list.find((p) => p.number === 3)!.state).toBe('draft');
    expect(list.find((p) => p.number === 1)!.needsMe).toBe(false);
  });

  it('orders by created_at descending then id ascending', () => {
    const db = fixtureDb();
    replaceOpenPrs(db, 'octo', [raw({ number: 2, createdAt: 5 }), raw({ number: 1, createdAt: 5 }), raw({ number: 3, createdAt: 9 })]);
    expect(listOpenPrs(db).map((p) => p.id)).toEqual(['echo/reef#3', 'echo/reef#1', 'echo/reef#2']);
  });

  it('same repo name and number under different owners both land', () => {
    const db = fixtureDb();
    replaceOpenPrs(db, 'octo', [raw({ owner: 'alice', repo: 'dotfiles' }), raw({ owner: 'acme', repo: 'dotfiles' })]);
    expect(listOpenPrs(db).map((p) => [p.id, p.repo])).toEqual([['acme/dotfiles#1', 'dotfiles'], ['alice/dotfiles#1', 'dotfiles']]);
  });

  it('replaces the previous set', () => {
    const db = fixtureDb();
    replaceOpenPrs(db, 'octo', [raw()]);
    replaceOpenPrs(db, 'octo', []);
    expect(listOpenPrs(db)).toEqual([]);
  });

  it('GET /api/reef/prs returns the list', async () => {
    const db = fixtureDb();
    replaceOpenPrs(db, 'octo', [raw()]);
    const app = createApp({
      db, bus: new Bus(), connect: fakeConnectDeps(),
      reefScanner: new ReefScanner({ db, dir: '/nonexistent' }),
      codexScanner: new CodexUsageScanner({ db, roots: [] }),
    });
    const res = await app.request('/api/reef/prs');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(listOpenPrs(db));
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Bus, type BusEvent } from './bus.ts';
import { fixtureDb } from './fixtures.ts';
import type { MergedPr } from './github.ts';
import type { DoneTicket } from './jira.ts';
import { listOpenPrs } from './openPrs.ts';
import type { RawPr } from './prCompute.ts';
import { getSetting, setSetting } from './settings.ts';
import { visitorErrors } from './reefEvents.ts';
import { VisitorSyncer, type GithubClient, type JiraClient } from './visitorSync.ts';

function rawPr(overrides: Partial<RawPr> = {}): RawPr {
  return {
    repo: 'reef', number: 1, title: 't', body: '', branch: 'b', url: 'https://example.com/pr/1',
    isDraft: false, createdAt: 0, updatedAt: 0, headCommittedAt: 1000, checks: 'none', threads: [], reviews: [],
    ...overrides,
  };
}

const mergedPr = (overrides: Partial<MergedPr> = {}): MergedPr =>
  ({ id: 'reef#7', repo: 'reef', number: 7, title: 'Add chest', url: 'https://github.com/echo/reef/pull/7', mergedAt: 1500, ...overrides });

function setup(over: { prs?: RawPr[]; merged?: MergedPr[]; done?: DoneTicket[]; epoch?: number; github?: boolean; jira?: boolean } = {}) {
  const db = fixtureDb();
  if (over.epoch !== undefined) setSetting(db, 'visitorEpoch', String(over.epoch));
  const clock = { t: 1000 };
  const gh = {
    fetchOpen: vi.fn(async () => ({ me: 'octo', prs: over.prs ?? [rawPr()] })),
    fetchMerged: vi.fn(async (_since: string) => over.merged ?? []),
  } satisfies GithubClient;
  const jr = { fetchDone: vi.fn(async (_since: string) => over.done ?? []) } satisfies JiraClient;
  const github = vi.fn((): GithubClient | null => (over.github === false ? null : gh));
  const jira = vi.fn((): JiraClient | null => (over.jira === false ? null : jr));
  const bus = new Bus();
  const busEvents: BusEvent[] = [];
  bus.subscribe((m) => busEvents.push(m.type));
  return { syncer: new VisitorSyncer({ db, bus, github, jira, now: () => clock.t }), db, clock, gh, jr, github, jira, busEvents };
}

const events = (db: ReturnType<typeof fixtureDb>) =>
  db.prepare('SELECT kind, ref, payload_json, created_at FROM reef_events ORDER BY id').all() as
    { kind: string; ref: string; payload_json: string; created_at: number }[];

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('VisitorSyncer', () => {
  it('a merged PR emits one pr event and a reef bus event, then advances the cursor', async () => {
    const { syncer, db, clock, gh, busEvents } = setup({ merged: [mergedPr()], epoch: 1000 });
    clock.t = 2000;
    await syncer.sync();
    expect(events(db)).toEqual([{
      kind: 'pr', ref: 'reef#7', created_at: 1500,
      payload_json: JSON.stringify({ repo: 'reef', number: 7, title: 'Add chest', url: 'https://github.com/echo/reef/pull/7', mergedAt: 1500 }),
    }]);
    expect(busEvents).toContain('reef');
    expect(getSetting(db, 'visitorCursor_github')).toBe('2000');
    expect(gh.fetchMerged.mock.calls[0]![0]).toBe(new Date((1000 - 86400) * 1000).toISOString());
  });

  it('the same PR on the next sync emits nothing and no reef bus event', async () => {
    const { syncer, db, clock, busEvents } = setup({ merged: [mergedPr()], epoch: 1000 });
    clock.t = 2000;
    await syncer.sync();
    busEvents.length = 0;
    clock.t = 2300;
    await syncer.sync();
    expect(events(db)).toHaveLength(1);
    expect(busEvents).not.toContain('reef');
  });

  it('a PR merged before the visitor epoch emits no event', async () => {
    const { syncer, db, clock } = setup({ merged: [mergedPr({ mergedAt: 999 })], done: [{ key: 'A-1', summary: 'old', url: 'u', resolvedAt: 999 }], epoch: 1000 });
    clock.t = 2000;
    await syncer.sync();
    expect(events(db)).toHaveLength(0);
  });

  it('a Done ticket emits a ticket event keyed by the ticket key and advances the jira cursor', async () => {
    const { syncer, db, clock, jr } = setup({ done: [{ key: 'A-9', summary: 'Ship', url: 'https://j/A-9', resolvedAt: 1600 }], epoch: 1000 });
    clock.t = 2000;
    await syncer.sync();
    expect(events(db).map((e) => [e.kind, e.ref])).toEqual([['ticket', 'A-9']]);
    expect(getSetting(db, 'visitorCursor_jira')).toBe('2000');
    expect(jr.fetchDone).toHaveBeenCalledTimes(1);
  });

  it('with GitHub and Jira both not connected there are no calls and no errors', async () => {
    const { syncer, db, gh, jr, busEvents } = setup({ github: false, jira: false });
    await syncer.sync();
    expect(gh.fetchOpen).not.toHaveBeenCalled();
    expect(gh.fetchMerged).not.toHaveBeenCalled();
    expect(jr.fetchDone).not.toHaveBeenCalled();
    expect(visitorErrors(db)).toEqual([]);
    expect(busEvents).toEqual([]);
  });

  it('a GitHub 401 sets visitorError_github and leaves open_prs untouched', async () => {
    const { syncer, db, gh, busEvents } = setup({ prs: [rawPr()] });
    await syncer.sync();
    expect(listOpenPrs(db)).toHaveLength(1);
    gh.fetchOpen.mockRejectedValueOnce(new Error('github rejected token (401)'));
    busEvents.length = 0;
    await syncer.sync();
    expect(JSON.parse(getSetting(db, 'visitorError_github')!)).toMatchObject({ message: 'github rejected token (401)' });
    expect(listOpenPrs(db)).toHaveLength(1);
    expect(busEvents).toContain('reef');
  });

  it('a failed merged-PR fetch leaves the cursor and the next good sync backfills', async () => {
    const { syncer, db, clock, gh } = setup({ epoch: 1000 });
    gh.fetchMerged.mockRejectedValueOnce(new Error('merged down'));
    clock.t = 2000;
    await syncer.sync();
    expect(getSetting(db, 'visitorCursor_github')).toBeNull();
    expect(visitorErrors(db)).toEqual([{ source: 'github', message: 'merged down', at: 2000 }]);
    expect(console.error).toHaveBeenCalledWith('[visitors] github failed: merged down');
    gh.fetchMerged.mockResolvedValueOnce([mergedPr()]);
    clock.t = 2300;
    await syncer.sync();
    expect(events(db)).toHaveLength(1);
    expect(visitorErrors(db)).toEqual([]);
  });

  it('a failed Done fetch is recorded until a good sync clears it', async () => {
    const { syncer, db, clock, jr, busEvents } = setup({ epoch: 1000 });
    jr.fetchDone.mockRejectedValueOnce(new Error('[jira] 503: down'));
    clock.t = 2000;
    await syncer.sync();
    expect(visitorErrors(db)).toEqual([{ source: 'jira', message: '[jira] 503: down', at: 2000 }]);
    expect(busEvents).toContain('reef');
    busEvents.length = 0;
    clock.t = 2300;
    await syncer.sync();
    expect(visitorErrors(db)).toEqual([]);
    expect(busEvents).toContain('reef');
  });

  it('a source that becomes disconnected clears its stored error', async () => {
    const s = setup({ epoch: 1000 });
    s.jr.fetchDone.mockRejectedValueOnce(new Error('x'));
    await s.syncer.sync();
    expect(visitorErrors(s.db)).toHaveLength(1);
    s.jira.mockReturnValue(null);
    s.busEvents.length = 0;
    await s.syncer.sync();
    expect(visitorErrors(s.db)).toEqual([]);
    expect(s.busEvents).toContain('reef');
  });

  it('changed open PRs push a reef bus event; unchanged ones do not', async () => {
    const { syncer, busEvents, gh } = setup({ prs: [rawPr()] });
    await syncer.sync();
    expect(busEvents).toContain('reef');
    busEvents.length = 0;
    await syncer.sync();
    expect(busEvents).toEqual([]);
    gh.fetchOpen.mockResolvedValueOnce({ me: 'octo', prs: [] });
    await syncer.sync();
    expect(busEvents).toContain('reef');
  });

  it('an item with no change time is skipped with a warning', async () => {
    const { syncer, db } = setup({ done: [{ key: 'A-1', summary: 's', url: 'u', resolvedAt: NaN }, { key: 'A-2', summary: 's', url: 'u', resolvedAt: 1600 }], epoch: 1000 });
    await syncer.sync();
    expect(console.warn).toHaveBeenCalledWith('[visitors] jira: A-1 has no change time, skipped');
    expect(events(db).map((e) => e.ref)).toEqual(['A-2']);
  });

  it('syncs queued during a run run afterwards, so a new connection is picked up', async () => {
    const s = setup({ github: false });
    let release!: () => void;
    s.jr.fetchDone.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve([]); }));
    const first = s.syncer.sync();
    await vi.waitFor(() => expect(s.jr.fetchDone).toHaveBeenCalledTimes(1));
    s.github.mockReturnValue(s.gh);
    const second = s.syncer.sync();
    const third = s.syncer.sync();
    expect(s.gh.fetchOpen).not.toHaveBeenCalled();
    release();
    await Promise.all([first, second, third]);
    expect(s.gh.fetchOpen).toHaveBeenCalledTimes(1);
  });

  it('seeds a missing visitor epoch once at start', () => {
    vi.useFakeTimers();
    try {
      const { syncer, db, clock } = setup();
      db.prepare("DELETE FROM settings WHERE key = 'visitorEpoch'").run();
      syncer.start(300_000);
      expect(getSetting(db, 'visitorEpoch')).toBe('1000');
      clock.t = 5000;
      syncer.start(300_000);
      expect(getSetting(db, 'visitorEpoch')).toBe('1000');
    } finally {
      vi.useRealTimers();
    }
  });
});

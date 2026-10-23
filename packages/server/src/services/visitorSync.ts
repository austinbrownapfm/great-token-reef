import type { Db } from '../store/db.ts';
import type { Bus } from './bus.ts';
import type { GithubFetchResult, MergedPr } from './github.ts';
import type { DoneTicket } from './jira.ts';
import { listOpenPrs, replaceOpenPrs } from './openPrs.ts';
import { emitReefEvent, recordVisitorFetch } from './reefEvents.ts';
import { getSetting, setSetting } from './settings.ts';

export interface GithubClient {
  fetchOpen(): Promise<GithubFetchResult>;
  fetchMerged(sinceIso: string): Promise<MergedPr[]>;
}

export interface JiraClient {
  fetchDone(sinceIso: string): Promise<DoneTicket[]>;
}

export interface VisitorSyncerDeps {
  db: Db;
  bus?: Bus;
  github(): GithubClient | null;
  jira(): JiraClient | null;
  now?(): number;
}

type Source = 'github' | 'jira';

const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const EPOCH_KEY = 'visitorEpoch';
const cursorKey = (source: Source) => `visitorCursor_${source}`;
// Overlap absorbs search-index lag and Jira's user-timezone dates; (kind, ref) uniqueness dedupes.
const LOOKBACK_SEC = 86_400;

function visitorEpoch(db: Db, now: number): number {
  const raw = getSetting(db, EPOCH_KEY);
  if (raw) return Number(raw);
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(EPOCH_KEY, String(now));
  const epoch = Number(getSetting(db, EPOCH_KEY));
  console.log(`[visitors] seeded visitor epoch at ${epoch}`);
  return epoch;
}

export class VisitorSyncer {
  private readonly db: Db;
  private readonly bus?: Bus;
  private readonly github: () => GithubClient | null;
  private readonly jira: () => JiraClient | null;
  private readonly now: () => number;
  private running: Promise<void> = Promise.resolve();
  private queued: Promise<void> | null = null;
  private changed = false;

  constructor(deps: VisitorSyncerDeps) {
    this.db = deps.db;
    this.bus = deps.bus;
    this.github = deps.github;
    this.jira = deps.jira;
    this.now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  }

  start(intervalMs: number): void {
    visitorEpoch(this.db, this.now());
    const tick = () => {
      this.sync().catch((err) => console.error(`[visitors] sync failed: ${errMsg(err)}`));
    };
    setTimeout(tick, 3000).unref();
    setInterval(tick, intervalMs).unref();
  }

  // Runs are serial; callers arriving mid-run share one follow-up run, which sees any new connection.
  sync(): Promise<void> {
    this.queued ??= this.running.then(() => {
      this.queued = null;
      this.running = this.run();
      return this.running;
    });
    return this.queued;
  }

  private recordFetch(source: Source, message: string | null, at: number): void {
    if (recordVisitorFetch(this.db, source, message, at)) this.changed = true;
  }

  private async visitors(
    source: Source, startedAt: number,
    fetchSince: (sinceIso: string) => Promise<{ ref: string; at: number; payload: object }[]>,
  ): Promise<void> {
    const epoch = visitorEpoch(this.db, startedAt);
    const rawCursor = getSetting(this.db, cursorKey(source));
    const since = (rawCursor ? Number(rawCursor) : epoch) - LOOKBACK_SEC;
    try {
      const items = await fetchSince(new Date(since * 1000).toISOString());
      const kind = source === 'github' ? 'pr' : 'ticket';
      let fresh = 0;
      for (const item of items) {
        if (!Number.isFinite(item.at)) {
          console.warn(`[visitors] ${source}: ${item.ref} has no change time, skipped`);
          continue;
        }
        if (item.at < epoch) continue;
        if (emitReefEvent(this.db, kind, item.ref, item.payload, item.at) !== null) fresh++;
      }
      setSetting(this.db, cursorKey(source), String(startedAt));
      this.recordFetch(source, null, startedAt);
      if (fresh > 0) this.changed = true;
      console.log(`[visitors] ${source}: ${items.length} seen, ${fresh} new, cursor ${startedAt}`);
    } catch (err) {
      console.error(`[visitors] ${source} failed: ${errMsg(err)}`);
      this.recordFetch(source, errMsg(err), startedAt);
    }
  }

  private async syncGithub(client: GithubClient, startedAt: number): Promise<void> {
    const before = JSON.stringify(listOpenPrs(this.db));
    try {
      const { me, prs } = await client.fetchOpen();
      replaceOpenPrs(this.db, me, prs);
      if (JSON.stringify(listOpenPrs(this.db)) !== before) this.changed = true;
    } catch (err) {
      console.error(`[visitors] github open PRs failed: ${errMsg(err)}`);
      this.recordFetch('github', errMsg(err), startedAt);
      return;
    }
    await this.visitors('github', startedAt, async (since) => (await client.fetchMerged(since)).map((pr) => ({
      ref: pr.id, at: pr.mergedAt,
      payload: { repo: pr.repo, number: pr.number, title: pr.title, url: pr.url, mergedAt: pr.mergedAt },
    })));
  }

  private async run(): Promise<void> {
    const startedAt = this.now();
    this.changed = false;
    try {
      const github = this.github();
      const jira = this.jira();
      // A disconnected source expects no visitors, so an old error would otherwise stick forever.
      if (!github) this.recordFetch('github', null, startedAt);
      if (!jira) this.recordFetch('jira', null, startedAt);
      await Promise.all([
        github ? this.syncGithub(github, startedAt) : undefined,
        jira
          ? this.visitors('jira', startedAt, async (since) => (await jira.fetchDone(since)).map((t) => ({
            ref: t.key, at: t.resolvedAt,
            payload: { key: t.key, summary: t.summary, url: t.url, resolvedAt: t.resolvedAt },
          })))
          : undefined,
      ]);
    } catch (err) {
      console.error(`[visitors] sync failed: ${errMsg(err)}`);
    }
    if (this.changed) this.bus?.emit('reef');
  }
}

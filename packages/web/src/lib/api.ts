import type { ConnectStatus, FishPicks, OpenPr, ReefVisitorError } from '@gtr/shared';

// Thin typed fetch client over the REST API. Types come from @gtr/shared —
// the same schemas the server validates against.


async function get<T>(path: string, params?: Record<string, string | number | boolean>): Promise<T> {
  const url = new URL(path, window.location.origin);
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

async function send<T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(detail?.error ?? `${path}: HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// --- The Reef (Claude Code and Codex usage companion) --------------------------------

export interface ReefCatch {
  agent: 'claude' | 'codex' | null;
  id: number;
  seed: string;
  session_id: string;
  catch_index: number;
  caught_at: number;
  project: string;
  depth_tokens: number;
  species: number;
  name: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  shiny: number;
  size: number;
}

export interface OfficialWindow {
  utilization: number | null;
  resetsAt: string | null;
}

export interface OfficialLimits {
  fiveHour: OfficialWindow | null;
  sevenDay: OfficialWindow | null;
  sevenDayOpus: OfficialWindow | null;
  sevenDaySonnet: OfficialWindow | null;
  plan: string | null;
  fetchedAt: number;
}

export type ReefAgent = 'all' | 'claude' | 'codex';

export interface CodexTrackingStatus {
  enabled: boolean;
  lastScanAt: number | null;
  backfilling: boolean;
  files: number;
  diagnosticCount: number;
  errors: { path: string; error: string; diagnostic?: boolean }[];
  rootErrors: string[];
}

export interface CodexLimitWindow {
  usedPercent: number;
  windowMinutes: number;
  resetsAt: number | null;
}

export interface CodexLimits {
  observedAt: number;
  source: string;
  limitId: string;
  primary: CodexLimitWindow | null;
  secondary: CodexLimitWindow | null;
  unlimited: boolean;
  plan: string | null;
}

export interface ReefPending {
  count: number;
  releasedId: number;
  catches: ReefCatch[];
  all: { id: number; species: number; shiny: number; rarity: string }[];
  events: ReefEvent[];
  eventCount: number;
  /** Optional: a server not yet restarted omits it. */
  visitorErrors?: ReefVisitorError[];
}

export type ReefEventKind = 'pr' | 'ticket' | 'whale' | 'set';

export interface ReefEvent {
  id: number;
  kind: ReefEventKind;
  ref: string;
  payload: unknown;
  created_at: number;
}

export type ReefFishPicks = FishPicks;

export interface ReefRewards {
  badges: string[];
  decor: { item: string; shown: boolean; xFrac: number | null }[];
  backdrops: string[];
  activeBackdrop: string;
}

export interface ReefSummary {
  pending: number;
  unpricedEvents: number;
  claudeQuota: {
    window5h: ReefSummary['window5h'];
    week: ReefSummary['week'];
    burn: ReefSummary['burn'];
    official: OfficialLimits | null;
  };
  codexLimits: CodexLimits | null;
  rewards: { tokens: number; catches: number; speciesDiscovered: number; lastCatch: ReefCatch | null };
  today: { tokens: number; cost: number; catches: number; unpricedEvents?: number };
  window5h: {
    tokens: number;
    budget: number | null;
    budgetEstimated: boolean;
    startedAt: number | null;
    resetAt: number | null;
    limitAt: number | null;
  };
  week: { tokens: number; cost: number; budget: number | null; budgetEstimated: boolean; unpricedEvents?: number };
  burn: { tokensPerMin: number; costPerHour: number; tokensPerMin7d: number; tokensPerActiveMin7d: number; unpricedEvents?: number };
  official: OfficialLimits | null;
  lastCatch: ReefCatch | null;
  lifetime: {
    tokens: number;
    cost: number;
    since: number | null;
    catches: number;
    speciesDiscovered: number;
  };
}

export interface ReefTrendRow { agent: Exclude<ReefAgent, 'all'>; day: string; model: string; tokens: number; cost: number; unpricedEvents: number }
export interface ReefModelRow {
  agent: Exclude<ReefAgent, 'all'>;
  unpricedEvents: number;
  model: string; calls: number; input: number; output: number;
  cache_read: number; cache_write: number; cost: number;
}
export interface ReefProjectRow {
  unpricedEvents: number;
  project: string; tokens: number; cost: number; sessions: number; last_used: number;
}
export interface ReefSessionRow {
  agent: Exclude<ReefAgent, 'all'>;
  unpricedEvents: number;
  session_id: string; label: string; project: string; started_at: number;
  ended_at: number; tokens: number; rewardTokens: number; cost: number; catches: number;
  parent_session_id: string | null;
}
export interface ReefSpeciesRow {
  species: number; name: string; rarity: ReefCatch['rarity']; count: number;
  shiny_count: number; best_size: number; first_caught: number; last_caught: number;
  first_project: string;
  /** best among catches already released into the tank */
  released_best_size: number | null;
}
export interface ReefCollection {
  species: ReefSpeciesRow[];
  legendary: { species: number; name: string; caught_at: number; depth_tokens: number; project: string }[];
  recent: ReefCatch[];
}
export interface ReefCatchesByDate {
  date: string;
  count: number;
  catches: ReefCatch[];
}

export const api = {
  reef: {
    codexStatus: () => get<CodexTrackingStatus>('/api/reef/codex/status'),
    summary: (agent: ReefAgent = 'claude') => get<ReefSummary>('/api/reef/summary', { agent }),
    trend: (days = 30, agent: ReefAgent = 'claude') => get<ReefTrendRow[]>('/api/reef/trend', { days, agent }),
    models: (days = 30, agent: ReefAgent = 'claude') => get<ReefModelRow[]>('/api/reef/models', { days, agent }),
    projects: (days = 30, agent: ReefAgent = 'claude') => get<ReefProjectRow[]>('/api/reef/projects', { days, agent }),
    sessions: (days = 7, agent: ReefAgent = 'claude', limit?: number) =>
      get<ReefSessionRow[]>('/api/reef/sessions', limit === undefined ? { days, agent } : { days, agent, limit }),
    collection: () => get<ReefCollection>('/api/reef/collection'),
    catches: (opts: { date?: string; rarity?: string } = {}) =>
      get<ReefCatchesByDate>('/api/reef/catches', opts),
    scan: () => send<{ files: number; messages: number; catches: number }>('POST', '/api/reef/scan'),
    refreshLimits: () => send<OfficialLimits>('POST', '/api/reef/limits/refresh'),
    pending: () => get<ReefPending>('/api/reef/pending'),
    release: (upToId: number, upToEventId?: number) =>
      send<{ releasedId: number; releasedEventId: number }>('POST', '/api/reef/release', { upToId, upToEventId }),
    rewards: () => get<ReefRewards>('/api/reef/rewards'),
    setDecor: (item: string, patch: { shown?: boolean; xFrac?: number }) =>
      send<ReefRewards>('PUT', `/api/reef/decor/${encodeURIComponent(item)}`, patch),
    setBackdrop: (backdrop: string) => send<ReefRewards>('PUT', '/api/reef/backdrop', { backdrop }),
    fish: () => get<ReefFishPicks>('/api/reef/fish'),
    setFish: (view: 'strip' | 'full', species: number[]) =>
      send<ReefFishPicks>('PUT', `/api/reef/fish/${view}`, { species }),
    budgets: () => get<{ window5h: number | null; week: number | null }>('/api/reef/budgets'),
    setBudgets: (b: { window5h: number | null; week: number | null }) =>
      send<{ window5h: number | null; week: number | null }>('PUT', '/api/reef/budgets', b),
    prs: () => get<OpenPr[]>('/api/reef/prs'),
  },
  connect: {
    status: () => get<ConnectStatus>('/api/connect'),
    saveGithub: (body: { source: 'gh' } | { source: 'token'; token: string }) =>
      send<ConnectStatus>('PUT', '/api/connect/github', body),
    saveGithubOrgs: (orgs: string[]) => send<ConnectStatus>('PUT', '/api/connect/github/orgs', { orgs }),
    disconnectGithub: () => send<ConnectStatus>('DELETE', '/api/connect/github'),
    saveJira: (body: { baseUrl: string; email: string; apiToken: string }) =>
      send<ConnectStatus>('PUT', '/api/connect/jira', body),
    disconnectJira: () => send<ConnectStatus>('DELETE', '/api/connect/jira'),
  },
};

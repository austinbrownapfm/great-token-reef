import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../app.ts';
import type { Db } from '../store/db.ts';
import type { ReefScanner } from '../services/reef.ts';
import type { CodexUsageScanner } from '../services/codexUsageScanner.ts';
import { reef } from './reef.ts';
import { reefModels, reefProjects, reefSessions, reefSummary, reefTrend, releaseReef } from '../services/reef.ts';

vi.mock('../services/reef.ts', () => ({
  reefSummary: vi.fn(() => ({ tokens: 123 })),
  reefTrend: vi.fn(() => []),
  reefModels: vi.fn(() => []),
  reefProjects: vi.fn(() => []),
  reefSessions: vi.fn(() => []),
  reefCollection: vi.fn(() => ({})),
  reefCatchesByDate: vi.fn(() => ({})),
  getReefBudgets: vi.fn(() => ({})),
  setReefBudgets: vi.fn(() => ({})),
  releaseReef: vi.fn(() => ({ releasedId: 5, releasedEventId: 2 })),
}));
vi.mock('../services/reefLimits.ts', () => ({ refreshOfficialLimits: vi.fn() }));
vi.mock('./reefCodex.ts', async () => {
  const { Hono: Router } = await import('hono');
  return { reefCodex: new Router() };
});

const db = {} as Db;
type ScanResult = { files: number; messages: number; catches: number };
const scanner = (result: ScanResult) => ({ scan: vi.fn(() => result) });
function app(claude?: ReturnType<typeof scanner>, codex?: ReturnType<typeof scanner>) {
  const routes = new Hono<AppEnv>();
  routes.use('*', async (c, next) => {
    c.set('db', db);
    if (claude) c.set('reefScanner', claude as unknown as ReefScanner);
    if (codex) c.set('codexScanner', codex as unknown as CodexUsageScanner);
    await next();
  });
  return routes.route('/reef', reef);
}
const endpoints = [
  ['summary', reefSummary, []],
  ['trend', reefTrend, [30]],
  ['models', reefModels, [30]],
  ['projects', reefProjects, [30]],
  ['sessions', reefSessions, [7, 20]],
] as const;
beforeEach(() => vi.clearAllMocks());

describe('Reef agent route adapters', () => {
  it.each(endpoints)('defaults omitted agent to Claude for %s with legacy day/limit defaults', async (path, service, args) => {
    const response = await app().request(`/reef/${path}`);
    expect(response.status).toBe(200);
    expect(service).toHaveBeenCalledExactlyOnceWith(db, ...args, 'claude');
  });

  it.each(endpoints)('propagates all and Codex selection to %s', async (path, service, args) => {
    for (const agent of ['all', 'codex'] as const) {
      vi.mocked(service).mockClear();
      const response = await app().request(`/reef/${path}?agent=${agent}`);
      expect(response.status).toBe(200);
      expect(service).toHaveBeenCalledExactlyOnceWith(db, ...args, agent);
    }
  });

  it.each(endpoints)('rejects invalid agent before calling %s', async (path, service) => {
    const response = await app().request(`/reef/${path}?agent=bogus`);
    expect(response.status).toBe(400);
    expect(await response.text()).toBe('agent must be all, claude, or codex');
    expect(service).not.toHaveBeenCalled();
  });

  it('preserves explicit day selection and the existing session limit', async () => {
    const response = await app().request('/reef/sessions?days=90&agent=all');
    expect(response.status).toBe(200);
    expect(reefSessions).toHaveBeenCalledExactlyOnceWith(db, 90, 20, 'all');
  });

  it('passes an explicit session limit through', async () => {
    const response = await app().request('/reef/sessions?days=1&agent=all&limit=200');
    expect(response.status).toBe(200);
    expect(reefSessions).toHaveBeenCalledExactlyOnceWith(db, 1, 200, 'all');
  });

  it.each(['0', '201', '1.5', 'x'])('rejects session limit %s before calling the service', async (limit) => {
    const response = await app().request(`/reef/sessions?limit=${limit}`);
    expect(response.status).toBe(400);
    expect(reefSessions).not.toHaveBeenCalled();
  });

  it('sums both scanner results into the existing scan response shape', async () => {
    const claude = scanner({ files: 1, messages: 2, catches: 3 });
    const codex = scanner({ files: 4, messages: 5, catches: 6 });
    const response = await app(claude, codex).request('/reef/scan', { method: 'POST' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ files: 5, messages: 7, catches: 9 });
    expect(claude.scan).toHaveBeenCalledOnce();
    expect(codex.scan).toHaveBeenCalledOnce();
  });

  it('retains Claude-only scanning', async () => {
    const result = { files: 1, messages: 2, catches: 3 };
    const response = await app(scanner(result)).request('/reef/scan', { method: 'POST' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
  });

  it('supports Codex-only scanning', async () => {
    const result = { files: 4, messages: 5, catches: 6 };
    const response = await app(undefined, scanner(result)).request('/reef/scan', { method: 'POST' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
  });

  const release = (body: unknown) =>
    app().request('/reef/release', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('releases fish and events through one service call', async () => {
    const response = await release({ upToId: 5, upToEventId: 2 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ releasedId: 5, releasedEventId: 2 });
    expect(releaseReef).toHaveBeenCalledExactlyOnceWith(db, 5, 2);
  });

  it('keeps the fish-only release body working', async () => {
    const response = await release({ upToId: 5 });
    expect(response.status).toBe(200);
    expect(releaseReef).toHaveBeenCalledExactlyOnceWith(db, 5, undefined);
  });

  it.each([-1, 1.5, 'x', null])('rejects upToEventId %s before calling the service', async (upToEventId) => {
    const response = await release({ upToId: 5, upToEventId });
    expect(response.status).toBe(400);
    expect(releaseReef).not.toHaveBeenCalled();
  });

  it('returns 503 when neither scanner runs', async () => {
    const response = await app().request('/reef/scan', { method: 'POST' });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'scanner not running' });
  });
});

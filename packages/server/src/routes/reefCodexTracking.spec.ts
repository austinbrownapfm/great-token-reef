import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../app.ts';
import type { CodexUsageScanner } from '../services/codexUsageScanner.ts';
import { reefCodex } from './reefCodex.ts';

function app(scanner?: Partial<CodexUsageScanner>) {
  const app = new Hono<AppEnv>();
  app.use(async (c, next) => {
    if (scanner) c.set('codexScanner', scanner as CodexUsageScanner);
    await next();
  });
  return app.route('/codex', reefCodex);
}

afterEach(() => vi.restoreAllMocks());

describe('Codex tracking route adapters', () => {
  it('reports disabled tracking when no scanner is configured', async () => {
    const response = await app().request('/codex/status');
    expect(await response.json()).toMatchObject({ enabled: false, files: 0, errors: [] });
  });
  it('exposes scanner diagnostics without starting a scan', async () => {
    const status = { enabled: true, files: 3, lastScanAt: 123, backfilling: false,
      diagnosticCount: 1, errors: [{ path: 'session', error: 'unsupported boundary' }], rootErrors: [] };
    const scan = vi.fn();
    const response = await app({ status: () => status, scan }).request('/codex/status');
    expect(await response.json()).toEqual(status);
    expect(scan).not.toHaveBeenCalled();
  });
});

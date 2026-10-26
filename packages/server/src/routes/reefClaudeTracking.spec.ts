import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../app.ts';
import type { ClaudeUsageScanner } from '../services/claudeUsageScanner.ts';
import { reefClaude } from './reefClaude.ts';

function app(scanner?: Partial<ClaudeUsageScanner>) {
  const app = new Hono<AppEnv>();
  app.use(async (c, next) => {
    if (scanner) c.set('reefScanner', scanner as ClaudeUsageScanner);
    await next();
  });
  return app.route('/claude', reefClaude);
}

describe('Claude Code tracking route', () => {
  it('reports disabled tracking when no scanner is configured', async () => {
    const response = await app().request('/claude/status');
    expect(await response.json()).toMatchObject({ enabled: false, files: 0, errors: [] });
  });
  it('exposes scanner errors without starting a scan', async () => {
    const status = { enabled: true, files: 3, lastScanAt: 123, backfilling: false,
      diagnosticCount: 0, errors: [{ path: 'proj/s.jsonl', error: 'EACCES', diagnostic: false }], rootErrors: [] };
    const scan = vi.fn();
    const response = await app({ status: () => status, scan }).request('/claude/status');
    expect(await response.json()).toEqual(status);
    expect(scan).not.toHaveBeenCalled();
  });
});

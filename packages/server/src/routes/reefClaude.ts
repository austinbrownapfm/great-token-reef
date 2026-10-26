import { Hono } from 'hono';
import type { AppEnv } from '../app.ts';

export const reefClaude = new Hono<AppEnv>()
  .get('/status', (c) => c.json(c.get('reefScanner')?.status() ?? {
    enabled: false, lastScanAt: null, backfilling: false, files: 0,
    diagnosticCount: 0, errors: [], rootErrors: [],
  }));

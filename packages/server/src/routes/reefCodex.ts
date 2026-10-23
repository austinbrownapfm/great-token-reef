import { Hono } from 'hono';
import type { AppEnv } from '../app.ts';

export const reefCodex = new Hono<AppEnv>()
  .get('/status', (c) => c.json(c.get('codexScanner')?.status() ?? {
    enabled: false, lastScanAt: null, backfilling: false, files: 0,
    diagnosticCount: 0, errors: [], rootErrors: [],
  }));

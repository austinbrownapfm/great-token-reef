import type { MiddlewareHandler } from 'hono';
import type { UsageEventKind } from '@gtr/shared';
import type { Db } from '../store/db.ts';

export function recordUsage(db: Db, kind: UsageEventKind, name: string, detail?: string): void {
  db.prepare('INSERT INTO usage_events (kind, name, detail) VALUES (?, ?, ?)').run(
    kind,
    name,
    detail ?? null,
  );
}

/** Logs every REST hit by route shape (`GET /api/foo/:id`, not raw URLs). */
export function restTelemetry(db: Db): MiddlewareHandler {
  return async (c, next) => {
    await next();
    const name = `${c.req.method} ${c.req.routePath}`;
    // Health checks, the UI-event ingest, and the SSE stream would be pure noise.
    if (c.req.routePath.startsWith('/api/health') || c.req.routePath.startsWith('/api/events'))
      return;
    try {
      recordUsage(db, 'rest', name);
    } catch (err) {
      console.warn(`[server] failed to record usage ${name}: ${(err as Error).message}`);
    }
  };
}

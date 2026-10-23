import { Hono } from 'hono';
import { logger } from 'hono/logger';
import type { Db } from './store/db.ts';
import type { Bus } from './services/bus.ts';
import { restTelemetry } from './services/telemetry.ts';
import { events } from './routes/events.ts';
import { stream } from './routes/stream.ts';
import { reef } from './routes/reef.ts';
import type { ReefScanner } from './services/reef.ts';
import type { CodexUsageScanner } from './services/codexUsageScanner.ts';

export interface AppEnv {
  Variables: { db: Db; bus: Bus; reefScanner: ReefScanner; codexScanner: CodexUsageScanner };
}

export interface AppDeps {
  db: Db;
  bus: Bus;
  reefScanner: ReefScanner;
  codexScanner: CodexUsageScanner;
}

export function createApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use(logger());
  app.use(async (c, next) => {
    c.set('db', deps.db);
    c.set('bus', deps.bus);
    c.set('reefScanner', deps.reefScanner);
    c.set('codexScanner', deps.codexScanner);
    await next();
  });
  app.use('/api/*', restTelemetry(deps.db));
  app.get('/api/health', (c) => c.json({ ok: true }));
  app.route('/api/events/stream', stream);
  app.route('/api/events', events);
  app.route('/api/reef', reef);
  return app;
}

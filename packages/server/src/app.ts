import { Hono } from 'hono';
import { logger } from 'hono/logger';
import type { Db } from './store/db.ts';
import type { Bus } from './services/bus.ts';
import { restTelemetry } from './services/telemetry.ts';
import { events } from './routes/events.ts';
import { stream } from './routes/stream.ts';

export interface AppEnv {
  Variables: { db: Db; bus: Bus };
}

export interface AppDeps {
  db: Db;
  bus: Bus;
}

export function createApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use(logger());
  app.use(async (c, next) => {
    c.set('db', deps.db);
    c.set('bus', deps.bus);
    await next();
  });
  app.use('/api/*', restTelemetry(deps.db));
  app.get('/api/health', (c) => c.json({ ok: true }));
  app.route('/api/events/stream', stream);
  app.route('/api/events', events);
  return app;
}

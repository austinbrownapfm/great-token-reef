import { Hono } from 'hono';
import { logger } from 'hono/logger';
import type { Db } from './store/db.ts';
import type { Bus } from './services/bus.ts';
import { restTelemetry } from './services/telemetry.ts';
import { events } from './routes/events.ts';
import { stream } from './routes/stream.ts';
import { reef } from './routes/reef.ts';
import { connect } from './routes/connect.ts';
import type { ConnectDeps } from './services/connect.ts';
import type { ClaudeUsageScanner } from './services/claudeUsageScanner.ts';
import type { CodexUsageScanner } from './services/codexUsageScanner.ts';

export interface AppEnv {
  Variables: { db: Db; bus: Bus; reefScanner: ClaudeUsageScanner; codexScanner: CodexUsageScanner; connect: ConnectDeps };
}

export interface AppDeps {
  db: Db;
  bus: Bus;
  reefScanner: ClaudeUsageScanner;
  codexScanner: CodexUsageScanner;
  connect: ConnectDeps;
}

export function createApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use(logger((m) => console.log(`[server] ${m}`)));
  app.use(async (c, next) => {
    c.set('db', deps.db);
    c.set('bus', deps.bus);
    c.set('reefScanner', deps.reefScanner);
    c.set('codexScanner', deps.codexScanner);
    c.set('connect', deps.connect);
    await next();
  });
  // A cross-site form can only send simple content types, so requiring JSON blocks it.
  app.use('/api/*', async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && !(c.req.header('content-type') ?? '').startsWith('application/json')) {
      return c.json({ error: 'Content-Type must be application/json' }, 415);
    }
    await next();
  });
  app.use('/api/*', restTelemetry(deps.db));
  app.get('/api/health', (c) => c.json({ ok: true }));
  app.route('/api/events/stream', stream);
  app.route('/api/events', events);
  app.route('/api/reef', reef);
  app.route('/api/connect', connect);
  return app;
}

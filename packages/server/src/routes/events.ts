import { UiEventBody } from '@gtr/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../app.ts';
import { recordUsage } from '../services/telemetry.ts';


export const events = new Hono<AppEnv>().post('/ui', async (c) => {
  const body = UiEventBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'expected { name, detail? }' }, 400);
  recordUsage(c.get('db'), 'ui', body.data.name, body.data.detail);
  return c.json({ ok: true });
});

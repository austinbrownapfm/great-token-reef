import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app.ts';
import { recordUsage } from '../services/telemetry.ts';

const UiEvent = z.object({
  name: z.string().min(1).max(200),
  detail: z.string().max(2000).optional(),
});

export const events = new Hono<AppEnv>().post('/ui', async (c) => {
  const body = UiEvent.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'expected { name, detail? }' }, 400);
  recordUsage(c.get('db'), 'ui', body.data.name, body.data.detail);
  return c.json({ ok: true });
});

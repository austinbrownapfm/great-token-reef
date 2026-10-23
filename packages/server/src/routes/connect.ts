import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app.ts';
import {
  connectGithub,
  connectJira,
  connectStatus,
  disconnectGithub,
  disconnectJira,
  setGithubOrgs,
} from '../services/connect.ts';

const GithubBody = z.discriminatedUnion('source', [
  z.object({ source: z.literal('gh') }),
  z.object({ source: z.literal('token'), token: z.string().min(1).max(500) }),
]);
const OrgsBody = z.object({ orgs: z.array(z.string().max(100)).max(100) });
const JiraBody = z.object({
  baseUrl: z.string().min(1).max(500),
  email: z.string().min(1).max(320),
  apiToken: z.string().min(1).max(2000),
});

export const connect = new Hono<AppEnv>()
  .get('/', (c) => c.json(connectStatus(c.get('db'), c.get('connect'))))
  .put('/github/orgs', async (c) => {
    const body = OrgsBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'expected { orgs: string[] }' }, 400);
    try {
      const status = setGithubOrgs(c.get('db'), c.get('connect'), body.data.orgs);
      c.get('connect').onChange();
      return c.json(status);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  })
  .put('/github', async (c) => {
    const body = GithubBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "expected { source: 'gh' } or { source: 'token', token }" }, 400);
    try {
      const status = await connectGithub(c.get('db'), c.get('connect'), body.data);
      c.get('connect').onChange();
      return c.json(status);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  })
  .delete('/github', (c) => {
    try {
      const status = disconnectGithub(c.get('db'), c.get('connect'));
      c.get('connect').onChange();
      return c.json(status);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  })
  .put('/jira', async (c) => {
    const body = JiraBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'expected { baseUrl, email, apiToken }' }, 400);
    try {
      const status = await connectJira(c.get('db'), c.get('connect'), body.data);
      c.get('connect').onChange();
      return c.json(status);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  })
  .delete('/jira', (c) => {
    try {
      const status = disconnectJira(c.get('db'), c.get('connect'));
      c.get('connect').onChange();
      return c.json(status);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

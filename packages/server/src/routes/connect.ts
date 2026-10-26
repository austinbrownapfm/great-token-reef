import { ConnectExcludedReposBody, ConnectGithubBody, ConnectJiraBody, ConnectOrgsBody, type ConnectStatus } from '@gtr/shared';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { AppEnv } from '../app.ts';
import {
  connectGithub,
  connectJira,
  connectStatus,
  disconnectGithub,
  disconnectJira,
  setGithubExcludedRepos,
  setGithubOrgs,
} from '../services/connect.ts';

// A failed refresh must never change the response to an already-saved connection change.
const notify = (c: Context<AppEnv>) => {
  try {
    c.get('connect').onChange();
  } catch (err) {
    console.error(`[connect] onChange failed: ${(err as Error).message}`);
  }
};

export const connect = new Hono<AppEnv>()
  .use(bodyLimit({ maxSize: 16 * 1024 }))
  .get('/', (c) => c.json(connectStatus(c.get('db'), c.get('connect'))))
  .put('/github/orgs', async (c) => {
    const body = ConnectOrgsBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'expected { orgs: string[] }' }, 400);
    let status: ConnectStatus;
    try {
      status = setGithubOrgs(c.get('db'), c.get('connect'), body.data.orgs);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
    notify(c);
    return c.json(status);
  })
  .put('/github/excluded-repos', async (c) => {
    const body = ConnectExcludedReposBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'expected { repos: string[] }' }, 400);
    let status: ConnectStatus;
    try {
      status = setGithubExcludedRepos(c.get('db'), c.get('connect'), body.data.repos);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
    notify(c);
    return c.json(status);
  })
  .put('/github', async (c) => {
    const body = ConnectGithubBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "expected { source: 'gh' } or { source: 'token', token }" }, 400);
    let status: ConnectStatus;
    try {
      status = await connectGithub(c.get('db'), c.get('connect'), body.data);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
    notify(c);
    return c.json(status);
  })
  .delete('/github', (c) => {
    let status: ConnectStatus;
    try {
      status = disconnectGithub(c.get('db'), c.get('connect'));
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
    notify(c);
    return c.json(status);
  })
  .put('/jira', async (c) => {
    const body = ConnectJiraBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'expected { baseUrl, email, apiToken }' }, 400);
    let status: ConnectStatus;
    try {
      status = await connectJira(c.get('db'), c.get('connect'), body.data);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
    notify(c);
    return c.json(status);
  })
  .delete('/jira', (c) => {
    let status: ConnectStatus;
    try {
      status = disconnectJira(c.get('db'), c.get('connect'));
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
    notify(c);
    return c.json(status);
  });

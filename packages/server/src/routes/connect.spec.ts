import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.ts';
import { Bus } from '../services/bus.ts';
import { CodexUsageScanner } from '../services/codexUsageScanner.ts';
import { fakeConnectDeps, fixtureDb } from '../services/fixtures.ts';
import { ReefScanner } from '../services/reef.ts';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

function setup(overrides = {}) {
  const db = fixtureDb();
  const connect = fakeConnectDeps({ onChange: vi.fn(), ...overrides });
  const app = createApp({
    db, bus: new Bus(), connect,
    reefScanner: new ReefScanner({ db, dir: '/nonexistent' }),
    codexScanner: new CodexUsageScanner({ db, roots: [] }),
  });
  const send = (method: string, path: string, body?: unknown) =>
    app.request(`/api/connect${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { connect, send };
}

describe('/api/connect', () => {
  it('GET returns the status and never a token', async () => {
    const { send } = setup();
    await send('PUT', '/github', { source: 'token', token: 'ghp_secret' });
    await send('PUT', '/jira', { baseUrl: 'https://a.test', email: 'a@b.c', apiToken: 'jira_secret' });
    const res = await send('GET', '');
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain('ghp_secret');
    expect(text).not.toContain('jira_secret');
    expect(JSON.parse(text).github.connected).toBe(true);
  });

  it('PUT /github failure is a 400 with { error } and does not call onChange', async () => {
    const { send, connect } = setup({ ghToken: async () => { throw new Error('not logged in'); } });
    const res = await send('PUT', '/github', { source: 'gh' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('not logged in');
    expect(connect.onChange).not.toHaveBeenCalled();
  });

  it('rejects malformed bodies with 400', async () => {
    const { send } = setup();
    expect((await send('PUT', '/github', { source: 'token' })).status).toBe(400);
    expect((await send('PUT', '/jira', { baseUrl: 'x' })).status).toBe(400);
    expect((await send('PUT', '/github/orgs', { orgs: 'x' })).status).toBe(400);
  });

  it('successful calls trigger onChange; invalid orgs are a 400', async () => {
    const { send, connect } = setup();
    expect((await send('PUT', '/github/orgs', { orgs: ['bad org'] })).status).toBe(400);
    expect((await send('PUT', '/github/orgs', { orgs: ['echo-reef'] })).status).toBe(200);
    expect((await send('DELETE', '/github')).status).toBe(200);
    expect((await send('DELETE', '/jira')).status).toBe(200);
    expect(connect.onChange).toHaveBeenCalledTimes(3);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  connectGithub,
  connectJira,
  connectStatus,
  disconnectGithub,
  disconnectJira,
  parseExcludedRepos,
  parseOrgs,
  setGithubExcludedRepos,
  setGithubOrgs,
} from './connect.ts';
import { fakeConnectDeps, fixtureDb } from './fixtures.ts';
import { getSetting, setSetting } from './settings.ts';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('connectGithub', () => {
  it('gh missing or logged out: readable error, nothing stored', async () => {
    const db = fixtureDb();
    const deps = fakeConnectDeps({ ghToken: async () => { throw new Error('gh: command not found'); } });
    await expect(connectGithub(db, deps, { source: 'gh' })).rejects.toThrow('gh: command not found');
    const status = connectStatus(db, deps);
    expect(status.github.connected).toBe(false);
    expect(status.github.error).toContain('gh: command not found');
    expect(getSetting(db, 'githubSource')).toBeNull();
    expect(deps.secrets.size).toBe(0);
  });

  it('gh source stores the login only; the token is never saved', async () => {
    const db = fixtureDb();
    const deps = fakeConnectDeps();
    const status = await connectGithub(db, deps, { source: 'gh' });
    expect(status.github).toMatchObject({ connected: true, source: 'gh', login: 'octo', error: null });
    expect(deps.secrets.size).toBe(0);
    expect(JSON.stringify(status)).not.toContain('gho_fromcli');
  });

  it('token source keeps the token in the keychain and out of settings and status', async () => {
    const db = fixtureDb();
    const deps = fakeConnectDeps({ githubLogin: async () => 'echo' });
    const status = await connectGithub(db, deps, { source: 'token', token: 'ghp_x' });
    expect(deps.secrets.get('github-token')).toBe('ghp_x');
    expect(getSetting(db, 'githubSource')).toBe('token');
    expect(getSetting(db, 'githubLogin')).toBe('echo');
    expect(JSON.stringify(status)).not.toContain('ghp_x');
    const rows = db.prepare('SELECT key, value FROM settings').all();
    expect(JSON.stringify(rows)).not.toContain('ghp_x');
  });

  it('a rejected token is not saved and never echoed in the error', async () => {
    const db = fixtureDb();
    const deps = fakeConnectDeps({ githubLogin: async (t) => { throw new Error(`bad credentials for ${t}`); } });
    await expect(connectGithub(db, deps, { source: 'token', token: 'ghp_x' })).rejects.toThrow('bad credentials for ***');
    expect(deps.secrets.size).toBe(0);
    expect(JSON.stringify(connectStatus(db, deps))).not.toContain('ghp_x');
    expect(JSON.stringify((console.warn as ReturnType<typeof vi.fn>).mock.calls)).not.toContain('ghp_x');
  });

  it('a keychain failure surfaces as the card error and writes no settings', async () => {
    const db = fixtureDb();
    const deps = fakeConnectDeps();
    deps.keychain.set = () => { throw new Error('Could not save to the macOS Keychain (exit 51).'); };
    await expect(connectGithub(db, deps, { source: 'token', token: 'ghp_x' })).rejects.toThrow('Keychain');
    expect(getSetting(db, 'githubSource')).toBeNull();
    expect(connectStatus(db, deps).github.error).toContain('Keychain');
  });

  it('reports the stored visitor error when there is no connect failure', () => {
    const db = fixtureDb();
    setSetting(db, 'visitorError_github', JSON.stringify({ message: 'HTTP 401', at: 5 }));
    expect(connectStatus(db, fakeConnectDeps()).github.error).toBe('HTTP 401');
  });
});

describe('setGithubOrgs', () => {
  it('rejects invalid names and stores valid ones', () => {
    const db = fixtureDb();
    const deps = fakeConnectDeps();
    expect(() => setGithubOrgs(db, deps, ['bad org'])).toThrow();
    expect(getSetting(db, 'githubOrgs')).toBeNull();
    expect(setGithubOrgs(db, deps, ['echo-reef']).github.orgs).toEqual(['echo-reef']);
    expect(getSetting(db, 'githubOrgs')).toBe('["echo-reef"]');
  });
});

describe('setGithubExcludedRepos', () => {
  it('rejects invalid entries naming them, and stores valid ones', () => {
    const db = fixtureDb();
    const deps = fakeConnectDeps();
    expect(() => setGithubExcludedRepos(db, deps, ['bad repo'])).toThrow('bad repo');
    expect(() => setGithubExcludedRepos(db, deps, ['noslash'])).toThrow('noslash');
    expect(getSetting(db, 'githubExcludedRepos')).toBeNull();
    expect(setGithubExcludedRepos(db, deps, ['acme/old-service', 'Me/x.y_z']).github.excludedRepos).toEqual(['acme/old-service', 'Me/x.y_z']);
    expect(getSetting(db, 'githubExcludedRepos')).toBe('["acme/old-service","Me/x.y_z"]');
  });

  it('dedupes', () => {
    const db = fixtureDb();
    expect(setGithubExcludedRepos(db, fakeConnectDeps(), ['a/b', 'a/b']).github.excludedRepos).toEqual(['a/b']);
  });
});

describe('stored GitHub filters are validated on read', () => {
  it('drops bad entries, dedupes case-insensitively, warns once with the count', () => {
    const warn = vi.mocked(console.warn);
    warn.mockClear();
    expect(parseExcludedRepos('["a/b org:other","","Acme/X","acme/x",7,"ok/y"]')).toEqual(['Acme/X', 'ok/y']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('[connect]');
    expect(parseOrgs('["bad org","","Echo","echo","x"]')).toEqual(['Echo', 'x']);
  });

  it('malformed JSON is empty', () => {
    expect(parseExcludedRepos('{nope')).toEqual([]);
    expect(parseOrgs('{nope')).toEqual([]);
  });

  it('connectStatus shows only valid entries', () => {
    const db = fixtureDb();
    setSetting(db, 'githubExcludedRepos', '["a/b org:other","good/repo"]');
    setSetting(db, 'githubOrgs', '["bad org","echo"]');
    const gh = connectStatus(db, fakeConnectDeps()).github;
    expect(gh.excludedRepos).toEqual(['good/repo']);
    expect(gh.orgs).toEqual(['echo']);
  });

  it('save dedupes case-insensitively and logs the deduped count', () => {
    const db = fixtureDb();
    const log = vi.mocked(console.log);
    expect(setGithubExcludedRepos(db, fakeConnectDeps(), ['a/b', 'A/B', 'c/d']).github.excludedRepos).toEqual(['a/b', 'c/d']);
    expect(log).toHaveBeenCalledWith('[connect] github excluded repos set (2)');
  });
});

describe('Jira', () => {
  const input = { baseUrl: 'https://example.atlassian.net/', email: 'me@example.com', apiToken: 'jira-secret' };

  it('stores url and email in settings and the token only in the keychain', async () => {
    const db = fixtureDb();
    const deps = fakeConnectDeps();
    const status = await connectJira(db, deps, input);
    expect(status.jira).toEqual({ connected: true, baseUrl: 'https://example.atlassian.net', email: 'me@example.com', error: null });
    expect(deps.secrets.get('jira-api-token')).toBe('jira-secret');
    expect(JSON.stringify(db.prepare('SELECT * FROM settings').all())).not.toContain('jira-secret');
    expect(JSON.stringify(status)).not.toContain('jira-secret');
  });

  it('refuses a non-https URL and a failed validation, saving nothing', async () => {
    const db = fixtureDb();
    const deps = fakeConnectDeps({ jiraMyself: async (cfg) => { throw new Error(`401 for ${cfg.apiToken}`); } });
    await expect(connectJira(db, deps, { ...input, baseUrl: 'http://x.test' })).rejects.toThrow('https://');
    await expect(connectJira(db, deps, input)).rejects.toThrow('401 for ***');
    expect(deps.secrets.size).toBe(0);
    expect(getSetting(db, 'jiraBaseUrl')).toBeNull();
  });
});

describe('disconnect', () => {
  it('removes the keychain item and the settings keys', async () => {
    const db = fixtureDb();
    const deps = fakeConnectDeps();
    await connectGithub(db, deps, { source: 'token', token: 'ghp_x' });
    setGithubOrgs(db, deps, ['echo-reef']);
    setGithubExcludedRepos(db, deps, ['acme/x']);
    await connectJira(db, deps, { baseUrl: 'https://a.test', email: 'a@b.c', apiToken: 'j' });
    const gh = disconnectGithub(db, deps);
    const jira = disconnectJira(db, deps);
    expect(deps.secrets.size).toBe(0);
    for (const key of ['githubSource', 'githubLogin', 'githubOrgs', 'githubExcludedRepos', 'jiraBaseUrl', 'jiraEmail']) {
      expect(getSetting(db, key)).toBeNull();
    }
    expect(gh.github).toMatchObject({ connected: false, login: null, orgs: [], excludedRepos: [] });
    expect(jira.jira).toMatchObject({ connected: false, baseUrl: null });
  });
});

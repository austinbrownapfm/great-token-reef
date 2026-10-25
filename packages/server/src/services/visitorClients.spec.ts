import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureDb } from './fixtures.ts';
import { keychainGet, type KeychainExec } from './keychain.ts';
import { setSetting } from './settings.ts';
import { visitorErrors } from './reefEvents.ts';
import { VisitorSyncer } from './visitorSync.ts';
import { makeGithubClient, makeJiraClient } from './visitorClients.ts';

const failing = (status: number): KeychainExec => () => {
  throw Object.assign(new Error('Command failed: security'), { status });
};

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('visitor clients and the Keychain', () => {
  it('Jira configured + Keychain denied surfaces an error on the Jira card', async () => {
    const db = fixtureDb();
    setSetting(db, 'jiraBaseUrl', 'https://x.atlassian.net');
    setSetting(db, 'jiraEmail', 'a@b.c');
    const read = (account: 'github-token' | 'jira-api-token') => keychainGet(account, failing(51));
    const syncer = new VisitorSyncer({ db, github: () => null, jira: () => makeJiraClient(db, read) });
    await syncer.sync();
    expect(JSON.stringify(visitorErrors(db))).toContain('exit 51');
    expect(JSON.stringify(visitorErrors(db))).toContain('jira-api-token');
  });

  it('Jira not configured never touches the Keychain', () => {
    const db = fixtureDb();
    const read = vi.fn(() => 'tok');
    expect(makeJiraClient(db, read)).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it('GitHub reads the token only when the source is token', () => {
    const db = fixtureDb();
    const read = vi.fn(() => 'tok');
    expect(makeGithubClient(db, read)).toBeNull();
    setSetting(db, 'githubSource', 'gh');
    expect(makeGithubClient(db, read, async () => 'gh-tok')).not.toBeNull();
    expect(read).not.toHaveBeenCalled();
    setSetting(db, 'githubSource', 'token');
    makeGithubClient(db, read);
    expect(read).toHaveBeenCalledWith('github-token');
  });

  it('GitHub token source + denied Keychain fails its fetches with the readable error', async () => {
    const db = fixtureDb();
    setSetting(db, 'githubSource', 'token');
    const client = makeGithubClient(db, (a) => keychainGet(a, failing(51)))!;
    await expect(client.fetchOpen()).rejects.toThrow(/exit 51/);
  });

  it('a missing item (exit 44) is silent', () => {
    expect(keychainGet('jira-api-token', failing(44))).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});

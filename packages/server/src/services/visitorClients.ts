import type { Db } from '../store/db.ts';
import { parseExcludedRepos, parseOrgs } from './connect.ts';
import { fetchMergedPrs, fetchOpenPrs, ghCliToken } from './github.ts';
import { fetchDoneTickets } from './jira.ts';
import type { KeychainAccount } from './keychain.ts';
import { getSetting } from './settings.ts';
import type { GithubClient, JiraClient } from './visitorSync.ts';

type KeychainRead = (account: KeychainAccount) => string | null;

// A configured source whose token can't be read must not look disconnected: its fetches throw so the error reaches the Connect card.
const failing = (err: unknown): GithubClient & JiraClient => {
  const fail = async (): Promise<never> => { throw err; };
  return { fetchOpen: fail, fetchMerged: fail, fetchDone: fail };
};

const tryRead = (read: KeychainRead, account: KeychainAccount): { token: string | null } | { error: unknown } => {
  try {
    return { token: read(account) };
  } catch (error) {
    return { error };
  }
};

export function makeGithubClient(db: Db, read: KeychainRead, ghToken: () => Promise<string> = ghCliToken): GithubClient | null {
  const source = getSetting(db, 'githubSource');
  if (source !== 'gh' && source !== 'token') return null;
  const orgs = parseOrgs(getSetting(db, 'githubOrgs'));
  const excludedRepos = parseExcludedRepos(getSetting(db, 'githubExcludedRepos'));
  let token: () => Promise<string>;
  if (source === 'gh') {
    token = ghToken;
  } else {
    const read1 = tryRead(read, 'github-token');
    if ('error' in read1) return failing(read1.error);
    if (read1.token === null) return failing(new Error('GitHub token not found in the macOS Keychain'));
    const stored = read1.token;
    token = async () => stored;
  }
  return {
    fetchOpen: async () => fetchOpenPrs(await token(), orgs, excludedRepos),
    fetchMerged: async (since) => fetchMergedPrs(await token(), orgs, excludedRepos, since),
  };
}

export function makeJiraClient(db: Db, read: KeychainRead): JiraClient | null {
  const baseUrl = getSetting(db, 'jiraBaseUrl');
  const email = getSetting(db, 'jiraEmail');
  if (baseUrl === null || email === null) return null;
  const read1 = tryRead(read, 'jira-api-token');
  if ('error' in read1) return failing(read1.error);
  if (read1.token === null) return null;
  const apiToken = read1.token;
  return { fetchDone: (since) => fetchDoneTickets({ baseUrl, email, apiToken }, since) };
}

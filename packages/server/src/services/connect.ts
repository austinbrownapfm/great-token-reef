import type { ConnectGithubBody, ConnectJiraBody, ConnectStatus } from '@gtr/shared';
import type { Db } from '../store/db.ts';
import type { KeychainAccount } from './keychain.ts';
import type { JiraConfig } from './jira.ts';
import { visitorErrors } from './reefEvents.ts';
import { getOfficialLimits } from './reefLimits.ts';
import { deleteSetting, getSetting, setSetting } from './settings.ts';

export interface ConnectDeps {
  keychain: {
    get(account: KeychainAccount): string | null;
    set(account: KeychainAccount, secret: string): void;
    delete(account: KeychainAccount): void;
  };
  githubLogin(token: string): Promise<string>;
  ghToken(): Promise<string>;
  jiraMyself(cfg: JiraConfig): Promise<void>;
  claudeDetected(): boolean;
  onChange(): void;
}

const ORG = /^[A-Za-z0-9-]+$/;
const REPO = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
const failures = new WeakMap<Db, { github?: string; jira?: string }>();

const failureOf = (db: Db) => {
  let entry = failures.get(db);
  if (!entry) failures.set(db, (entry = {}));
  return entry;
};

const readable = (err: unknown, secret?: string) => {
  const message = err instanceof Error ? err.message : String(err);
  return secret ? message.split(secret).join('***') : message;
};

function parseFilterList(raw: string | null, key: string, valid: RegExp): string[] {
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn(`[connect] stored ${key} is not valid JSON; treating as empty`);
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const kept = parsed.filter((e): e is string => {
    if (typeof e !== 'string' || !valid.test(e) || seen.has(e.toLowerCase())) return false;
    seen.add(e.toLowerCase());
    return true;
  });
  if (kept.length < parsed.length) console.warn(`[connect] stored ${key}: dropped ${parsed.length - kept.length} invalid or duplicate entries`);
  return kept;
}

export const parseOrgs = (raw: string | null): string[] => parseFilterList(raw, 'githubOrgs', ORG);

export const parseExcludedRepos = (raw: string | null): string[] => parseFilterList(raw, 'githubExcludedRepos', REPO);

export function connectStatus(db: Db, deps: ConnectDeps): ConnectStatus {
  const source = getSetting(db, 'githubSource');
  const login = getSetting(db, 'githubLogin');
  const baseUrl = getSetting(db, 'jiraBaseUrl');
  const email = getSetting(db, 'jiraEmail');
  const stored = (which: 'github' | 'jira') => visitorErrors(db).find((e) => e.source === which)?.message ?? null;
  const failed = failures.get(db) ?? {};
  return {
    claude: { detected: deps.claudeDetected(), limitsFetchedAt: getOfficialLimits(db)?.fetchedAt ?? null },
    github: {
      connected: (source === 'gh' || source === 'token') && login !== null,
      source: source === 'gh' || source === 'token' ? source : null,
      login,
      orgs: parseOrgs(getSetting(db, 'githubOrgs')),
      excludedRepos: parseExcludedRepos(getSetting(db, 'githubExcludedRepos')),
      error: failed.github ?? stored('github'),
    },
    jira: {
      connected: baseUrl !== null && email !== null,
      baseUrl,
      email,
      error: failed.jira ?? stored('jira'),
    },
  };
}

export async function connectGithub(db: Db, deps: ConnectDeps, input: ConnectGithubBody): Promise<ConnectStatus> {
  let secret: string | undefined;
  try {
    let token: string;
    if (input.source === 'gh') {
      token = await deps.ghToken().catch((err: unknown) => {
        throw new Error(`The gh CLI is not available or not logged in: ${readable(err)}`);
      });
    } else {
      token = input.token.trim();
      secret = token;
      if (!/^\S+$/.test(token)) throw new Error('Enter a GitHub token.');
    }
    secret = token;
    const login = await deps.githubLogin(token);
    if (input.source === 'token') deps.keychain.set('github-token', token);
    else deps.keychain.delete('github-token');
    setSetting(db, 'githubSource', input.source);
    setSetting(db, 'githubLogin', login);
    delete failureOf(db).github;
    console.log(`[connect] github connected as ${login} via ${input.source}`);
    return connectStatus(db, deps);
  } catch (err) {
    const message = readable(err, secret);
    failureOf(db).github = message;
    console.warn(`[connect] github connect failed: ${message}`);
    throw new Error(message);
  }
}

export function setGithubOrgs(db: Db, deps: ConnectDeps, orgs: string[]): ConnectStatus {
  const bad = orgs.find((org) => !ORG.test(org));
  if (bad !== undefined) throw new Error(`Invalid organization name: ${bad.slice(0, 40)}`);
  setSetting(db, 'githubOrgs', JSON.stringify([...new Set(orgs)]));
  console.log(`[connect] github orgs set (${orgs.length})`);
  return connectStatus(db, deps);
}

export function setGithubExcludedRepos(db: Db, deps: ConnectDeps, repos: string[]): ConnectStatus {
  const bad = repos.find((repo) => !REPO.test(repo));
  if (bad !== undefined) throw new Error(`Invalid repo (expected owner/repo): ${bad.slice(0, 40)}`);
  const unique = repos.filter((r, i) => repos.findIndex((o) => o.toLowerCase() === r.toLowerCase()) === i);
  setSetting(db, 'githubExcludedRepos', JSON.stringify(unique));
  console.log(`[connect] github excluded repos set (${unique.length})`);
  return connectStatus(db, deps);
}

export function disconnectGithub(db: Db, deps: ConnectDeps): ConnectStatus {
  deps.keychain.delete('github-token');
  for (const key of ['githubSource', 'githubLogin', 'githubOrgs', 'githubExcludedRepos']) deleteSetting(db, key);
  delete failureOf(db).github;
  console.log('[connect] github disconnected');
  return connectStatus(db, deps);
}

function normalizeBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('Jira URL is not a valid URL.');
  }
  if (url.protocol !== 'https:') throw new Error('Jira URL must start with https://');
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

export async function connectJira(
  db: Db,
  deps: ConnectDeps,
  input: ConnectJiraBody,
): Promise<ConnectStatus> {
  const apiToken = input.apiToken.trim();
  try {
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    const email = input.email.trim();
    if (!email.includes('@')) throw new Error('Enter your Atlassian account email.');
    if (!/^\S+$/.test(apiToken)) throw new Error('Enter a Jira API token.');
    await deps.jiraMyself({ baseUrl, email, apiToken });
    deps.keychain.set('jira-api-token', apiToken);
    setSetting(db, 'jiraBaseUrl', baseUrl);
    setSetting(db, 'jiraEmail', email);
    delete failureOf(db).jira;
    console.log(`[connect] jira connected at ${baseUrl}`);
    return connectStatus(db, deps);
  } catch (err) {
    const message = readable(err, apiToken || undefined);
    failureOf(db).jira = message;
    console.warn(`[connect] jira connect failed: ${message}`);
    throw new Error(message);
  }
}

export function disconnectJira(db: Db, deps: ConnectDeps): ConnectStatus {
  deps.keychain.delete('jira-api-token');
  for (const key of ['jiraBaseUrl', 'jiraEmail']) deleteSetting(db, key);
  delete failureOf(db).jira;
  console.log('[connect] jira disconnected');
  return connectStatus(db, deps);
}

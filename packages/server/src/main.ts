import { execFile } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { config } from './config.ts';
import { openDb } from './store/db.ts';
import { runMigrations } from './store/migrate.ts';
import { MIGRATIONS } from './store/migrations.ts';
import { Bus } from './services/bus.ts';
import { ReefScanner } from './services/reef.ts';
import { CodexUsageScanner } from './services/codexUsageScanner.ts';
import { keychainDelete, keychainGet, keychainSet } from './services/keychain.ts';
import { claudeLoginDetected } from './services/reefLimits.ts';
import { parseOrgs, type ConnectDeps } from './services/connect.ts';
import { fetchMergedPrs, fetchOpenPrs, ghCliToken, githubLogin } from './services/github.ts';
import { fetchDoneTickets, jiraMyself } from './services/jira.ts';
import { getSetting } from './services/settings.ts';
import { VisitorSyncer, type GithubClient, type JiraClient } from './services/visitorSync.ts';
import { createApp } from './app.ts';
import { startServer } from './server.ts';

mkdirSync(config.dataDir, { recursive: true });
const db = openDb(config.dbPath);
const applied = runMigrations(db, MIGRATIONS);
if (applied.length > 0) console.log(`[db] applied migrations: ${applied.join(', ')}`);

const bus = new Bus();
const reefScanner = new ReefScanner({ db, bus, dir: config.ccProjectsDir });
const codexScanner = new CodexUsageScanner({ db, bus, roots: [config.codexSessionsDir] });
const githubClient = (): GithubClient | null => {
  const source = getSetting(db, 'githubSource');
  if (source !== 'gh' && source !== 'token') return null;
  const orgs = parseOrgs(getSetting(db, 'githubOrgs'));
  const token = async () => {
    if (source === 'gh') return ghCliToken();
    const stored = keychainGet('github-token');
    if (stored === null) throw new Error('GitHub token not found in the macOS Keychain');
    return stored;
  };
  return {
    fetchOpen: async () => fetchOpenPrs(await token(), orgs),
    fetchMerged: async (since) => fetchMergedPrs(await token(), orgs, since),
  };
};

const jiraClient = (): JiraClient | null => {
  const baseUrl = getSetting(db, 'jiraBaseUrl');
  const email = getSetting(db, 'jiraEmail');
  const apiToken = keychainGet('jira-api-token');
  if (baseUrl === null || email === null || apiToken === null) return null;
  return { fetchDone: (since) => fetchDoneTickets({ baseUrl, email, apiToken }, since) };
};

const visitorSyncer = new VisitorSyncer({ db, bus, github: githubClient, jira: jiraClient });
const connect: ConnectDeps = {
  keychain: { get: keychainGet, set: keychainSet, delete: keychainDelete },
  githubLogin: (token) => githubLogin(token),
  ghToken: () => ghCliToken(),
  jiraMyself: (cfg) => jiraMyself(cfg),
  claudeDetected: () => claudeLoginDetected(),
  onChange: () => {
    visitorSyncer.sync().catch((err: unknown) => console.error(`[visitors] sync failed: ${(err as Error).message}`));
    bus.emit('reef');
  },
};
const app = createApp({ db, bus, reefScanner, codexScanner, connect });

await startServer({
  app,
  dev: config.dev,
  webRoot: config.webRoot,
  port: config.port,
  host: config.host,
});

// Scans start only once the port is bound: the first pass reads all history.
reefScanner.start(5 * 60 * 1000);
codexScanner.start(60_000);
visitorSyncer.start(5 * 60_000);

const url = `http://${config.host}:${config.port}`;
console.log(`[server] The Great Token Reef → ${url}`);
if (config.openBrowser) {
  execFile('open', [url], (err) => {
    if (err) console.warn(`[server] could not open the browser: ${err.message}`);
  });
}

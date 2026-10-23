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
import type { ConnectDeps } from './services/connect.ts';
import { createApp } from './app.ts';
import { startServer } from './server.ts';

mkdirSync(config.dataDir, { recursive: true });
const db = openDb(config.dbPath);
const applied = runMigrations(db, MIGRATIONS);
if (applied.length > 0) console.log(`[db] applied migrations: ${applied.join(', ')}`);

const bus = new Bus();
const reefScanner = new ReefScanner({ db, bus, dir: config.ccProjectsDir });
const codexScanner = new CodexUsageScanner({ db, bus, roots: [config.codexSessionsDir] });
const notConfigured = async (): Promise<never> => {
  throw new Error('not configured yet');
};
const connect: ConnectDeps = {
  keychain: { get: keychainGet, set: keychainSet, delete: keychainDelete },
  githubLogin: notConfigured,
  ghToken: notConfigured,
  jiraMyself: notConfigured,
  claudeDetected: () => claudeLoginDetected(),
  onChange: () => bus.emit('reef'),
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

const url = `http://${config.host}:${config.port}`;
console.log(`[server] The Great Token Reef → ${url}`);
if (config.openBrowser) {
  execFile('open', [url], (err) => {
    if (err) console.warn(`[server] could not open the browser: ${err.message}`);
  });
}

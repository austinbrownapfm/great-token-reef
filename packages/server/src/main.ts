import { execFile } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { config } from './config.ts';
import { openDb } from './store/db.ts';
import { runMigrations } from './store/migrate.ts';
import { MIGRATIONS } from './store/migrations.ts';
import { Bus } from './services/bus.ts';
import { createApp } from './app.ts';
import { startServer } from './server.ts';

mkdirSync(config.dataDir, { recursive: true });
const db = openDb(config.dbPath);
const applied = runMigrations(db, MIGRATIONS);
if (applied.length > 0) console.log(`[db] applied migrations: ${applied.join(', ')}`);

const bus = new Bus();
const app = createApp({ db, bus });

await startServer({
  app,
  dev: config.dev,
  webRoot: config.webRoot,
  port: config.port,
  host: config.host,
});

const url = `http://${config.host}:${config.port}`;
console.log(`[server] The Great Token Reef → ${url}`);
if (config.openBrowser) {
  execFile('open', [url], (err) => {
    if (err) console.warn(`[server] could not open the browser: ${err.message}`);
  });
}

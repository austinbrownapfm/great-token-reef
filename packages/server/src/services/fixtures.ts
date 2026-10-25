import type { ConnectDeps } from './connect.ts';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../store/migrate.ts';
import { MIGRATIONS } from '../store/migrations.ts';

/** In-memory database with every migration applied. Test-only. */
export function fixtureDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  runMigrations(db, MIGRATIONS);
  return db;
}

/** In-memory Connect dependencies: Keychain is a Map, validators resolve. Test-only. */
export function fakeConnectDeps(overrides: Partial<ConnectDeps> = {}): ConnectDeps & { secrets: Map<string, string> } {
  const secrets = new Map<string, string>();
  return {
    secrets,
    keychain: {
      get: (account) => secrets.get(account) ?? null,
      set: (account, secret) => void secrets.set(account, secret),
      delete: (account) => void secrets.delete(account),
    },
    githubLogin: async () => 'octo',
    ghToken: async () => 'gho_fromcli',
    jiraMyself: async () => undefined,
    claudeDetected: () => false,
    onChange: () => undefined,
    ...overrides,
  };
}

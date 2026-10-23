import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../store/migrate.ts';
import { MIGRATIONS } from '../store/migrations.ts';

/** In-memory database with every migration applied. Test-only. */
export function fixtureDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  runMigrations(db, MIGRATIONS);
  return db;
}

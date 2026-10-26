import type { Db } from './db.ts';

export interface Migration {
  version: number;
  name: string;
  /** SQL statement(s) executed inside one transaction. */
  up: string | string[];
}

export function runMigrations(db: Db, migrations: readonly Migration[]): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT    NOT NULL,
    applied_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);

  const versions = [...migrations].sort((a, b) => a.version - b.version);
  const dupes = versions.filter((m, i) => i > 0 && m.version === versions[i - 1]!.version);
  if (dupes.length > 0) {
    throw new Error(`duplicate migration version(s): ${dupes.map((m) => m.version).join(', ')}`);
  }

  const isApplied = db.prepare('SELECT 1 FROM migrations WHERE version = ?');
  const record = db.prepare('INSERT INTO migrations (version, name) VALUES (?, ?)');
  const applied: number[] = [];

  for (const m of versions) {
    if (isApplied.get(m.version)) continue;
    const statements = Array.isArray(m.up) ? m.up : [m.up];

    db.exec('BEGIN');
    try {
      for (const sql of statements) db.exec(sql);
      record.run(m.version, m.name);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`migration ${m.version} (${m.name}) failed: ${(err as Error).message}`, { cause: err });
    }
    applied.push(m.version);
  }
  return applied;
}

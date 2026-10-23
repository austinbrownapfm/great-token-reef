import { describe, expect, it } from 'vitest';
import { openDb } from '../store/db.ts';
import { runMigrations } from '../store/migrate.ts';
import { MIGRATIONS } from '../store/migrations.ts';
import { deleteSetting, getSetting, setSetting } from './settings.ts';

describe('settings', () => {
  it('gets, upserts and deletes', () => {
    const db = openDb(':memory:');
    runMigrations(db, MIGRATIONS);
    expect(getSetting(db, 'k')).toBeNull();
    setSetting(db, 'k', 'a');
    setSetting(db, 'k', 'b');
    expect(getSetting(db, 'k')).toBe('b');
    deleteSetting(db, 'k');
    expect(getSetting(db, 'k')).toBeNull();
  });
});

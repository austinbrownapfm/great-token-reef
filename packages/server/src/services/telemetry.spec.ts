import { describe, expect, it, vi } from 'vitest';
import { openDb } from '../store/db.ts';
import { runMigrations } from '../store/migrate.ts';
import { MIGRATIONS } from '../store/migrations.ts';
import { createApp } from '../app.ts';
import { Bus } from './bus.ts';
import { recordUsage } from './telemetry.ts';

function freshDb() {
  const db = openDb(':memory:');
  runMigrations(db, MIGRATIONS);
  return db;
}
const count = (db: ReturnType<typeof freshDb>, kind: string) =>
  (db.prepare('SELECT COUNT(*) AS n FROM usage_events WHERE kind = ?').get(kind) as { n: number }).n;

describe('telemetry', () => {
  it('recordUsage writes one usage_events row', () => {
    const db = freshDb();
    recordUsage(db, 'ui', 'reef.view');
    expect(db.prepare('SELECT kind, name, detail FROM usage_events').all()).toEqual([
      { kind: 'ui', name: 'reef.view', detail: null },
    ]);
  });

  it('POST /api/events/ui records a ui event and rejects bad bodies', async () => {
    const db = freshDb();
    const app = createApp({ db, bus: new Bus() });
    const ok = await app.request('/api/events/ui', { method: 'POST', body: JSON.stringify({ name: 'reef.view' }) });
    expect(ok.status).toBe(200);
    const bad = await app.request('/api/events/ui', { method: 'POST', body: '{}' });
    expect(bad.status).toBe(400);
    expect(count(db, 'ui')).toBe(1);
    expect(count(db, 'rest')).toBe(0);
  });
});

describe('bus', () => {
  it('logs a failing listener and still reaches the others', () => {
    const bus = new Bus();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seen: string[] = [];
    bus.subscribe(() => {
      throw new Error('dead');
    });
    bus.subscribe((m) => seen.push(m.type));
    bus.emit('reef', 'x');
    expect(seen).toEqual(['reef']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[server] bus listener failed'));
    warn.mockRestore();
  });
});

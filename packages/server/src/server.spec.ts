import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from './store/db.ts';
import { runMigrations } from './store/migrate.ts';
import { MIGRATIONS } from './store/migrations.ts';
import { Bus } from './services/bus.ts';
import { createApp } from './app.ts';
import { startServer } from './server.ts';

let root: string;
let server: Server;
let port: number;

function get(path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    // Raw path on the wire: fetch() would normalise `..` away before sending.
    const req = request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'gtr-web-'));
  mkdirSync(join(root, 'web', 'dist', 'assets'), { recursive: true });
  writeFileSync(join(root, 'web', 'dist', 'index.html'), '<html>INDEX</html>');
  writeFileSync(join(root, 'web', 'dist', 'assets', 'a.js'), 'console.log("a")');
  writeFileSync(join(root, 'web', 'package.json'), '{"secret":"outside-dist"}');
  writeFileSync(join(root, 'secret.txt'), 'TOP SECRET');
  const db = openDb(':memory:');
  runMigrations(db, MIGRATIONS);
  server = await startServer({
    app: createApp({ db, bus: new Bus() }),
    dev: false,
    webRoot: join(root, 'web'),
    port: 0,
    host: '127.0.0.1',
  });
  port = (server.address() as AddressInfo).port;
});

afterEach(() => {
  server.close();
  rmSync(root, { recursive: true, force: true });
});

describe('startServer (start mode)', () => {
  it('serves index.html at / and for client routes', async () => {
    expect((await get('/')).body).toContain('INDEX');
    expect((await get('/connect')).body).toContain('INDEX');
  });

  it('serves real asset files', async () => {
    const res = await get('/assets/a.js');
    expect(res.status).toBe(200);
    expect(res.body).toBe('console.log("a")');
  });

  it.each([
    '/%2e%2e/%2e%2e/etc/passwd',
    '/../package.json',
    '/assets/../../package.json',
    '/..%2f..%2fsecret.txt',
    '/%2e%2e%2fsecret.txt',
    '/assets/%00.js',
  ])('never serves anything outside dist: %s', async (path) => {
    const res = await get(path);
    expect(res.body).not.toContain('TOP SECRET');
    expect(res.body).not.toContain('outside-dist');
    expect(res.body).not.toContain('root:');
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) expect(res.body).toContain('INDEX');
  });

  it('routes /api/health to the app', async () => {
    const res = await get('/api/health');
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  it('returns 500 for an unreadable file and keeps serving', async () => {
    const file = join(root, 'web', 'dist', 'assets', 'locked.js');
    writeFileSync(file, 'x');
    chmodSync(file, 0o000);
    const bad = await get('/assets/locked.js');
    expect(bad.status).toBe(500);
    expect((await get('/assets/a.js')).status).toBe(200);
    chmodSync(file, 0o644);
  });

  it('binds to 127.0.0.1', () => {
    expect((server.address() as AddressInfo).address).toBe('127.0.0.1');
  });

  it('on EADDRINUSE logs the GTR_PORT message and exits 1', async () => {
    const log = vi.fn();
    const exit = vi.fn();
    const db = openDb(':memory:');
    runMigrations(db, MIGRATIONS);
    await expect(
      startServer({
        app: createApp({ db, bus: new Bus() }),
        dev: false,
        webRoot: join(root, 'web'),
        port,
        host: '127.0.0.1',
        log,
        exit,
      }),
    ).rejects.toMatchObject({ code: 'EADDRINUSE' });
    expect(exit).toHaveBeenCalledWith(1);
    expect(log).toHaveBeenCalledWith(
      `[server] port ${port} is already in use — is The Great Token Reef already running? Set GTR_PORT to use another port.`,
    );
  });
});

import { appendFileSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtureDb } from './fixtures.ts';
import { CodexUsageScanner } from './codexUsageScanner.ts';
import { Bus } from './bus.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const record = (type: string, payload: unknown) => JSON.stringify({ timestamp: '2026-01-01T00:00:00Z', type, payload }) + '\n';
const header = (id = 'synthetic') => record('session_meta', { id, cwd: '/synthetic/café' }) + record('turn_context', { model: 'gpt-5-codex' });
const usage = (input: number, output = 10) => record('event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: input, cached_input_tokens: 20, output_tokens: output, reasoning_output_tokens: 2, total_tokens: input + output } } });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'codex-scanner-')); roots.push(root);
  const db = fixtureDb();
  return { root, db, file: join(root, 'rollout.jsonl'), scanner: new CodexUsageScanner({ db, roots: [root] }) };
}
const totals = (db: ReturnType<typeof fixtureDb>) => db.prepare("SELECT count(*) AS n, sum(input_tokens+cache_read_tokens+output_tokens) AS tokens FROM cc_usage WHERE agent='codex'").get();

describe('CodexUsageScanner (synthetic files and in-memory DB)', () => {
  it('treats absent session roots as empty, warns once across scans and throws nothing', () => {
    const { root, db } = fixture();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const scanner = new CodexUsageScanner({ db, roots: [join(root, 'not-created-yet')] });
    expect(scanner.scan()).toEqual({ files: 0, messages: 0, catches: 0 });
    expect(scanner.scan()).toEqual({ files: 0, messages: 0, catches: 0 });
    expect(scanner.status()).toMatchObject({ files: 0, rootErrors: [] });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    db.close();
  });

  it('indexes native and nested mirrored copies once and replays idempotently', () => {
    const { root, db, file } = fixture();
    const mirror = join(root, 'sbx', '11111111-1111-1111-1111-111111111111');
    mkdirSync(mirror, { recursive: true });
    writeFileSync(file, header() + usage(100));
    writeFileSync(join(mirror, 'copy.jsonl'), readFileSync(file));
    const scanner = new CodexUsageScanner({ db, roots: [root, join(root, 'sbx'), root] });
    expect(scanner.scan()).toMatchObject({ files: 2, messages: 1, catches: 0 });
    expect(totals(db)).toEqual({ n: 1, tokens: 110 });
    expect(scanner.scan().messages).toBe(0);
    expect(scanner.status().files).toBe(2);
    db.close();
  });

  it('persists counters and context across append/restart, retaining partial UTF-8 bytes', () => {
    const { root, db, file, scanner } = fixture();
    writeFileSync(file, header() + usage(100));
    scanner.scan();
    const user = Buffer.from(record('event_msg', { type: 'user_message', message: 'Synthetic café task' }));
    const accent = user.indexOf(Buffer.from('é'));
    appendFileSync(file, user.subarray(0, accent + 1));
    expect(scanner.scan().messages).toBe(0);
    appendFileSync(file, user.subarray(accent + 1));
    appendFileSync(file, usage(150, 20));
    const resumed = new CodexUsageScanner({ db, roots: [root] });
    expect(resumed.scan().messages).toBe(1);
    expect(totals(db)).toEqual({ n: 2, tokens: 170 });
    expect(db.prepare("SELECT label FROM cc_sessions WHERE session_id='codex:synthetic'").get()).toMatchObject({ label: 'Synthetic café task' });
    db.close();
  });

  it('detects truncation and same-size replacement without duplicating existing events', () => {
    const { db, file, scanner } = fixture();
    const original = header() + usage(100);
    writeFileSync(file, original); scanner.scan();
    writeFileSync(file, header()); scanner.scan();
    appendFileSync(file, usage(100)); scanner.scan();
    expect(totals(db)).toEqual({ n: 1, tokens: 110 });
    writeFileSync(file + '.new', header('different') + usage(100));
    renameSync(file + '.new', file);
    expect(scanner.scan().messages).toBe(1);
    expect(totals(db)).toEqual({ n: 2, tokens: 220 });
    db.close();
  });

  it('skips symlinks and keeps malformed complete-line diagnostics across scans', () => {
    const { root, db, file, scanner } = fixture();
    writeFileSync(file, header() + 'not JSON\n' + usage(100));
    symlinkSync(file, join(root, 'alias.jsonl'));
    expect(scanner.scan().files).toBe(1);
    expect(scanner.status()).toMatchObject({ diagnosticCount: 1, errors: [{ path: realpathSync(file), error: expect.stringContaining('malformed JSON') }] });
    scanner.scan();
    expect(scanner.status().diagnosticCount).toBe(1);
    db.close();
  });

  it('commits rate-only snapshots and emits the shared reef event', () => {
    const { root, db, file } = fixture();
    const bus = new Bus(); let events = 0;
    bus.subscribe(() => events++);
    const scanner = new CodexUsageScanner({ db, roots: [root], bus });
    writeFileSync(file, header() + record('event_msg', { type: 'token_count', info: null, rate_limits: { primary: { used_percent: 10, window_minutes: 300, resets_at: 9999999999 } } }));
    expect(scanner.scan().messages).toBe(0);
    expect(db.prepare('SELECT count(*) n FROM codex_limits').get()).toEqual({ n: 1 });
    expect(events).toBe(1);
    scanner.scan(); expect(events).toBe(1);
    db.close();
  });

  it('rolls back both usage and checkpoint on a checkpoint write failure, then safely retries', () => {
    const { db, file, scanner } = fixture();
    writeFileSync(file, header() + usage(100));
    db.exec(`CREATE TRIGGER reject_checkpoint BEFORE INSERT ON codex_files
      WHEN NEW.bytes_read > 0 BEGIN SELECT RAISE(ABORT, 'synthetic checkpoint rejection'); END;`);
    expect(scanner.scan().messages).toBe(0);
    expect(totals(db)).toEqual({ n: 0, tokens: null });
    expect(db.prepare('SELECT bytes_read FROM codex_files').get()).toEqual({ bytes_read: 0 });
    db.exec('DROP TRIGGER reject_checkpoint');
    expect(scanner.scan().messages).toBe(1);
    expect(totals(db)).toEqual({ n: 1, tokens: 110 });
    db.close();
  });

  it('reads a session metadata line larger than 1 MiB and waits for its incomplete tail', () => {
    const { db, file, scanner } = fixture();
    const largeHeader = record('session_meta', { id: 'large', cwd: '/synthetic/project', base_instructions: 'x'.repeat(2 * 1024 * 1024) });
    writeFileSync(file, largeHeader.slice(0, -1));
    expect(scanner.scan().messages).toBe(0);
    expect(scanner.status().files).toBe(0);
    appendFileSync(file, '\n' + usage(100));
    expect(scanner.scan().messages).toBe(1);
    expect(scanner.status().diagnosticCount).toBe(0);
    expect(totals(db)).toEqual({ n: 1, tokens: 110 });
    db.close();
  });

  it('bounds a pass and continues a large backfill without losing complete-line context', () => {
    const { db, file, scanner } = fixture();
    const padding = record('response_item', { type: 'message', role: 'assistant', content: 'x'.repeat(100_000) });
    writeFileSync(file, header() + padding.repeat(60) + usage(100));
    expect(scanner.scan().messages).toBe(0);
    expect(scanner.status().backfilling).toBe(true);
    expect(scanner.scan().messages).toBe(1);
    expect(totals(db)).toEqual({ n: 1, tokens: 110 });
    db.close();
  });
});

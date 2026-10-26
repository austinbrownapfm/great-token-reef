import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { ScannerStatus } from '@gtr/shared';
import type { Db } from '../store/db.ts';
import type { Bus } from './bus.ts';
import { getCodexRewardEpoch, storeCodexBatch } from './reef.ts';
import { CODEX_PARSER_VERSION, codexDiagnostic, newCodexParserState, parseCodexLine, type CodexParserState } from './codexUsage.ts';
import type { CodexLimitSnapshot, CodexSessionRow, CodexUsageRow } from './reefTypes.ts';

const CHUNK_BYTES = 1024 * 1024;
const MAX_RECORD_BYTES = 16 * CHUNK_BYTES;
const SCAN_BYTES = 4 * CHUNK_BYTES;
const SCAN_FILES = 128;
interface FileCheckpoint { size: number; bytes_read: number; state_json: string; parser_version: number; inode: string; prefix_hash: string }
type ScanState = CodexParserState & { discardLine?: boolean };

/** Bounded synchronous passes match ClaudeUsageScanner's public API; backfill yields
 * between passes so a multi-gigabyte sessions tree cannot block the listener. */
export class CodexUsageScanner {
  private scanning = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private iterator: Generator<string> | null = null;
  private pending: string | null = null;
  private rootErrors: string[] = [];
  private lastScanAt: number | null = null;
  private enabled = false;
  private warnedMissing = false;

  constructor(private readonly deps: { db: Db; bus?: Bus; roots: string[] }) {}

  start(intervalMs: number): void {
    if (this.enabled) return;
    this.enabled = true;
    getCodexRewardEpoch(this.deps.db);
    this.schedule(3000);
    this.interval = setInterval(() => this.schedule(), intervalMs);
    this.interval.unref();
  }

  stop(): void {
    this.enabled = false;
    if (this.timer) clearTimeout(this.timer);
    if (this.interval) clearInterval(this.interval);
    this.timer = null;
    this.interval = null;
  }

  schedule(delayMs = 100): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      try { this.scan(); } catch (error) {
        this.rootErrors = [`scan failed: ${(error as Error).message}`];
        console.error('[codex] scan failed:', (error as Error).message);
      }
    }, delayMs);
    this.timer.unref();
  }

  status(): ScannerStatus {
    const rows = this.deps.db.prepare('SELECT path, state_json, last_error FROM codex_files').all() as { path: string; state_json: string; last_error: string | null }[];
    let diagnosticCount = 0;
    const errors: { path: string; error: string; diagnostic: boolean }[] = [];
    for (const row of rows) {
      let diagnostic = false;
      try {
        const state = JSON.parse(row.state_json) as ScanState;
        diagnosticCount += state.diagnosticCount || 0;
        diagnostic = state.diagnostics?.includes(row.last_error ?? '') ?? false;
      } catch { diagnosticCount++; }
      if (row.last_error) errors.push({ path: row.path, error: row.last_error, diagnostic });
    }
    // Keep diagnostics available to tools; prioritize actionable failures in the UI.
    errors.sort((a, b) => Number(a.diagnostic) - Number(b.diagnostic));
    return { enabled: this.enabled, lastScanAt: this.lastScanAt, backfilling: this.iterator !== null,
      files: rows.length, diagnosticCount, errors: errors.slice(0, 20), rootErrors: this.rootErrors };
  }

  scan(): { files: number; messages: number; catches: number } {
    const total = { files: 0, messages: 0, catches: 0 };
    if (this.scanning) return total;
    this.scanning = true;
    try {
      getCodexRewardEpoch(this.deps.db);
      if (!this.iterator) { this.rootErrors = []; this.iterator = this.walkRoots(); }
      let bytes = 0, visited = 0, limitsChanged = false;
      while (visited++ < SCAN_FILES && bytes < SCAN_BYTES) {
        const path = this.pending ?? this.iterator.next().value;
        this.pending = null;
        if (!path) { this.iterator = null; break; }
        try {
          const result = this.scanFile(path);
          if (result.more) this.pending = path;
          total.files += result.touched ? 1 : 0;
          total.messages += result.messages;
          total.catches += result.catches;
          bytes += result.bytes;
          limitsChanged ||= result.limitsChanged;
        } catch (error) {
          // Keep the committed offset intact so a later scan can retry safely.
          this.deps.db.prepare(`INSERT INTO codex_files
            (path,size,bytes_read,state_json,parser_version,inode,prefix_hash,updated_at,last_error)
            VALUES (?,0,0,?,?,'','',unixepoch(),?) ON CONFLICT(path) DO UPDATE SET last_error=excluded.last_error,updated_at=excluded.updated_at`)
            .run(path, JSON.stringify(newCodexParserState()), CODEX_PARSER_VERSION, (error as Error).message);
        }
      }
      this.lastScanAt = Math.floor(Date.now() / 1000);
      if (this.iterator && this.enabled) this.schedule(10);
      if (total.messages || total.catches || limitsChanged) this.deps.bus?.emit('reef');
      return total;
    } finally { this.scanning = false; }
  }

  private *walkRoots(): Generator<string> {
    const roots: string[] = [];
    for (const candidate of this.deps.roots) {
      try {
        if (lstatSync(candidate).isSymbolicLink()) continue;
        roots.push(realpathSync(candidate));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.rootErrors.push(`${candidate}: ${(error as NodeJS.ErrnoException).code ?? 'unreadable'}`);
        else if (!this.warnedMissing) {
          console.warn(`[codex] sessions dir not found: ${candidate} (set GTR_CODEX_SESSIONS_DIR)`);
          this.warnedMissing = true;
        }
      }
    }
    const canonical = [...new Set(roots)].sort((a, b) => a.length - b.length).filter((root, i, all) =>
      !all.slice(0, i).some((parent) => root.startsWith(parent + sep)));
    const errors = this.rootErrors;
    const walk = function* (directory: string): Generator<string> {
      // Dirent traversal never follows a symlink, including nested mirrors.
      let entries;
      try { entries = readdirSync(directory, { withFileTypes: true }); } catch (error) {
        errors.push(`${directory}: ${(error as NodeJS.ErrnoException).code ?? 'unreadable'}`);
        return;
      }
      for (const entry of entries) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) yield* walk(path);
        else if (entry.isFile() && entry.name.endsWith('.jsonl')) yield path;
      }
    };
    for (const root of canonical) {
      try { yield* walk(root); } catch (error) { this.rootErrors.push(`${root}: ${(error as NodeJS.ErrnoException).code ?? 'unreadable'}`); }
    }
  }

  private source(path: string): string {
    // Default mirrors live below sessions/sbx/<source UUID>; a custom mirror
    // root still retains its source UUID as the first relative component.
    const sbx = path.split(sep).lastIndexOf('sbx');
    if (sbx >= 0) return `sandbox:${path.split(sep)[sbx + 1] ?? 'unknown'}`;
    for (const root of this.deps.roots) {
      let canonical: string;
      try { canonical = realpathSync(resolve(root)); } catch { continue; }
      const rel = relative(canonical, path);
      if (rel.startsWith('..') || isAbsolute(rel)) continue;
      const source = rel.split(sep)[0];
      if (source && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(source)) return `sandbox:${source}`;
    }
    return 'local';
  }

  private scanFile(path: string): { touched: boolean; bytes: number; messages: number; catches: number; more: boolean; limitsChanged: boolean } {
    const empty = { touched: false, bytes: 0, messages: 0, catches: 0, more: false, limitsChanged: false };
    const db = this.deps.db;
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile()) return empty;
      const inode = `${stat.dev}:${stat.ino}`;
      const prev = db.prepare('SELECT * FROM codex_files WHERE path=?').get(path) as FileCheckpoint | undefined;
      // Hash a stable prefix length recorded in the checkpoint. Growing a
      // short file must not look like replacement simply because it grew.
      const prefixLength = Math.min(prev ? Number(prev.prefix_hash.split(':')[0]) || Math.min(stat.size, 4096) : stat.size, 4096, stat.size);
      const prefix = Buffer.alloc(prefixLength);
      readSync(fd, prefix, 0, prefix.length, 0);
      const prefixHash = `${prefixLength}:${createHash('sha256').update(prefix).digest('hex')}`;
      const same = prev && prev.parser_version === CODEX_PARSER_VERSION && prev.inode === inode && prev.bytes_read <= stat.size && prev.prefix_hash === prefixHash;
      const start = same ? prev.bytes_read : 0;
      const state: ScanState = same ? JSON.parse(prev.state_json) as ScanState : newCodexParserState();
      if (stat.size <= start) return empty;
      let buffer = Buffer.alloc(Math.min(CHUNK_BYTES, stat.size - start));
      let count = readSync(fd, buffer, 0, buffer.length, start);
      let lastNewline = buffer.lastIndexOf(10, count - 1);
      while (lastNewline < 0 && count === buffer.length && count < MAX_RECORD_BYTES && start + count < stat.size) {
        const larger = Buffer.alloc(Math.min(buffer.length * 2, MAX_RECORD_BYTES, stat.size - start));
        buffer.copy(larger, 0, 0, count);
        const added = readSync(fd, larger, count, larger.length - count, start + count);
        count += added; buffer = larger;
        lastNewline = buffer.lastIndexOf(10, count - 1);
        if (!added) break;
      }
      let consumed = lastNewline + 1;
      const usage: CodexUsageRow[] = [], sessions: CodexSessionRow[] = [], limits: CodexLimitSnapshot[] = [];
      const source = this.source(path);
      if (lastNewline < 0) {
        if (count < MAX_RECORD_BYTES) return empty; // incomplete UTF-8/JSON line: retry after append
        if (!state.discardLine) codexDiagnostic(state, 'record exceeds 16 MiB; skipped');
        state.discardLine = true;
        consumed = count;
      } else {
        const lines = buffer.subarray(0, consumed).toString('utf8').split('\n');
        lines.pop();
        if (state.discardLine) { lines.shift(); state.line++; state.discardLine = false; }
        for (const line of lines) {
          if (!line.trim()) continue;
          const parsed = parseCodexLine(line, state, source);
          usage.push(...parsed.usage); sessions.push(...parsed.sessions); limits.push(...parsed.limits);
        }
      }
      let limitsChanged = false;
      const stored = storeCodexBatch(db, usage, sessions, () => {
        db.prepare(`INSERT INTO codex_files
          (path,size,bytes_read,state_json,parser_version,inode,prefix_hash,updated_at,last_error)
          VALUES (?,?,?,?,?,?,?,unixepoch(),?) ON CONFLICT(path) DO UPDATE SET
          size=excluded.size,bytes_read=excluded.bytes_read,state_json=excluded.state_json,parser_version=excluded.parser_version,
          inode=excluded.inode,prefix_hash=excluded.prefix_hash,updated_at=excluded.updated_at,last_error=excluded.last_error`)
          .run(path, stat.size, start + consumed, JSON.stringify(state), CODEX_PARSER_VERSION, inode, prefixHash, state.diagnostics.at(-1) ?? null);
        for (const snapshot of limits) {
          const source = `${snapshot.source}:${snapshot.limitId}`;
          const old = db.prepare('SELECT observed_at,snapshot_json FROM codex_limits WHERE source=?').get(source) as { observed_at: number; snapshot_json: string } | undefined;
          const json = JSON.stringify(snapshot);
          if ((!old || old.observed_at <= snapshot.observedAt) && old?.snapshot_json !== json) {
            db.prepare(`INSERT INTO codex_limits(source,observed_at,snapshot_json) VALUES(?,?,?)
              ON CONFLICT(source) DO UPDATE SET observed_at=excluded.observed_at,snapshot_json=excluded.snapshot_json`).run(source, snapshot.observedAt, json);
            limitsChanged = true;
          }
        }
      });
      return { touched: true, bytes: consumed, ...stored, more: start + consumed < stat.size && (consumed === count || start + count < stat.size), limitsChanged };
    } finally { closeSync(fd); }
  }
}

import { closeSync, constants, fstatSync, openSync, readSync, readdirSync, realpathSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { ScannerStatus } from '@gtr/shared';
import type { Db } from '../store/db.ts';
import type { Bus } from './bus.ts';
import { repriceClaudeUsage, storeClaudeBatch } from './reef.ts';
import type { ClaudeTranscript, ClaudeUsageRow } from './reefTypes.ts';

// Tails ~/.claude/projects/**/*.jsonl incrementally: cc_files remembers a byte
// offset per file, only appended complete lines are parsed, and
// assistant-message usage upserts into cc_usage keyed by request_id (so
// streaming re-emits dedupe themselves).

const CHUNK_BYTES = 1024 * 1024;
const MAX_RECORD_BYTES = 16 * CHUNK_BYTES;
const SCAN_BYTES = 4 * CHUNK_BYTES;
const SCAN_FILES = 128;
const OVERSIZED = 'record exceeds 16 MiB; skipped';

interface FileCheckpoint { bytes_read: number; skip_partial: number; last_error: string | null }
interface FileResult { touched: boolean; bytes: number; messages: number; catches: number; more: boolean }

/** Bounded synchronous passes, same shape as CodexUsageScanner: backfill yields
 * between passes so a multi-gigabyte projects tree cannot block the listener. */
export class ClaudeUsageScanner {
  private scanning = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private iterator: Generator<string> | null = null;
  private pending: string | null = null;
  private rootErrors: string[] = [];
  private lastScanAt: number | null = null;
  private enabled = false;
  private warnedMissing = false;
  private root: string | null = null;

  constructor(private readonly deps: { db: Db; bus?: Bus; dir: string }) {}

  start(intervalMs: number): void {
    if (this.enabled) return;
    this.enabled = true;
    // Defer the first pass so the initial backfill never delays the port bind.
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
      try {
        const r = this.scan();
        if (r.messages > 0 || r.catches > 0) {
          console.log(`[reef] scan: ${r.messages} messages, ${r.catches} catches (${r.files} files touched)`);
        }
      } catch (error) {
        this.rootErrors.push(`scan failed: ${(error as Error).message}`);
        console.error(`[reef] scan failed: ${(error as Error).message}`);
      }
    }, delayMs);
    this.timer.unref();
  }

  status(): ScannerStatus {
    const rows = this.deps.db.prepare('SELECT path, last_error FROM cc_files').all() as { path: string; last_error: string | null }[];
    const errors = rows.filter((r) => r.last_error)
      .map((r) => ({ path: r.path, error: r.last_error!, diagnostic: r.last_error === OVERSIZED }));
    // Keep diagnostics available to tools; prioritize actionable failures in the UI.
    errors.sort((a, b) => Number(a.diagnostic) - Number(b.diagnostic));
    return { enabled: this.enabled, lastScanAt: this.lastScanAt, backfilling: this.iterator !== null,
      files: rows.length, diagnosticCount: errors.filter((e) => e.diagnostic).length,
      errors: errors.slice(0, 20), rootErrors: this.rootErrors };
  }

  scan(): { files: number; messages: number; catches: number } {
    const total = { files: 0, messages: 0, catches: 0 };
    if (this.scanning) return total;
    this.scanning = true;
    try {
      repriceClaudeUsage(this.deps.db);
      if (!this.iterator) { this.rootErrors = []; this.iterator = this.walkRoot(); }
      let bytes = 0, visited = 0;
      while (visited++ < SCAN_FILES && bytes < SCAN_BYTES) {
        const rel = this.pending ?? this.iterator.next().value;
        this.pending = null;
        if (!rel) { this.iterator = null; break; }
        try {
          const result = this.scanFile(rel);
          if (result.more) this.pending = rel;
          total.files += result.touched ? 1 : 0;
          total.messages += result.messages;
          total.catches += result.catches;
          bytes += result.bytes;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; // deleted between listing and open
          // The committed offset stays put, so the next pass retries this file.
          console.error(`[reef] file ${rel} failed: ${(error as Error).message}`);
          this.deps.db.prepare(`INSERT INTO cc_files (path, last_error, updated_at) VALUES (?, ?, unixepoch())
            ON CONFLICT(path) DO UPDATE SET last_error = excluded.last_error, updated_at = excluded.updated_at`)
            .run(rel, (error as Error).message);
        }
      }
      this.lastScanAt = Math.floor(Date.now() / 1000);
      if (this.iterator && this.enabled) this.schedule(10);
      if (total.messages || total.catches) this.deps.bus?.emit('reef');
      return total;
    } finally { this.scanning = false; }
  }

  /** Yields .jsonl paths relative to the projects dir; cc_files is keyed by them. */
  private *walkRoot(): Generator<string> {
    let root: string;
    try {
      root = realpathSync(this.deps.dir);
      this.root = root;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') this.rootErrors.push(`${this.deps.dir}: ${code ?? 'unreadable'}`);
      else if (!this.warnedMissing) {
        console.warn(`[reef] projects dir not readable: ${this.deps.dir} (set GTR_CC_PROJECTS_DIR)`);
        this.warnedMissing = true;
      }
      return;
    }
    const errors = this.rootErrors;
    const walk = function* (directory: string): Generator<string> {
      // Dirent traversal never follows a symlink below the root.
      let entries;
      try { entries = readdirSync(directory, { withFileTypes: true }); } catch (error) {
        errors.push(`${directory}: ${(error as NodeJS.ErrnoException).code ?? 'unreadable'}`);
        return;
      }
      for (const entry of entries) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) yield* walk(path);
        else if (entry.isFile() && entry.name.endsWith('.jsonl')) yield relative(root, path);
      }
    };
    yield* walk(root);
  }

  /** A file that now reads cleanly drops its earlier failure; an oversized-line note stays. */
  private clearStaleError(rel: string, prev: FileCheckpoint | undefined, result: FileResult): FileResult {
    if (prev?.last_error && prev.last_error !== OVERSIZED) {
      this.deps.db.prepare('UPDATE cc_files SET last_error = NULL WHERE path = ?').run(rel);
    }
    return result;
  }

  private scanFile(rel: string): FileResult {
    const empty: FileResult = { touched: false, bytes: 0, messages: 0, catches: 0, more: false };
    const db = this.deps.db;
    const fd = openSync(join(this.root ?? this.deps.dir, rel), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile()) return empty;
      const prev = db.prepare('SELECT bytes_read, skip_partial, last_error FROM cc_files WHERE path = ?').get(rel) as
        | FileCheckpoint
        | undefined;
      // A shrunk file was rewritten — rescan from 0 (request_id upserts keep this idempotent).
      const rewritten = !prev || prev.bytes_read > stat.size;
      const start = rewritten ? 0 : prev.bytes_read;
      let skipPartial = !rewritten && prev.skip_partial === 1;
      if (stat.size <= start) return this.clearStaleError(rel, prev, empty);
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
      let rows: ClaudeTranscript = { usage: [], sessions: [], titles: [] };
      let note: string | null = null;
      if (lastNewline < 0) {
        if (count < MAX_RECORD_BYTES) return this.clearStaleError(rel, prev, empty); // torn write: wait for the rest of the line
        skipPartial = true;
        note = OVERSIZED;
        consumed = count;
      } else {
        const lines = buffer.subarray(0, consumed).toString('utf8').split('\n');
        lines.pop();
        if (skipPartial) { lines.shift(); skipPartial = false; }
        rows = parseTranscriptLines(lines);
      }
      // An oversized-line note outlives the chunk that found it; any other error clears on success.
      const lastError = note ?? (prev?.last_error === OVERSIZED && !rewritten ? OVERSIZED : null);
      const stored = storeClaudeBatch(db, rows, () => {
        db.prepare(
          `INSERT INTO cc_files (path, size, bytes_read, skip_partial, last_error, updated_at)
           VALUES (?, ?, ?, ?, ?, unixepoch())
           ON CONFLICT(path) DO UPDATE SET size = excluded.size, bytes_read = excluded.bytes_read,
             skip_partial = excluded.skip_partial, last_error = excluded.last_error, updated_at = excluded.updated_at`,
        ).run(rel, stat.size, start + consumed, skipPartial ? 1 : 0, lastError);
      });
      return { touched: true, bytes: consumed, ...stored,
        more: start + consumed < stat.size && (consumed === count || start + count < stat.size) };
    } finally { closeSync(fd); }
  }
}

/** Parse Claude Code transcript JSONL lines. */
function parseTranscriptLines(lines: string[]): ClaudeTranscript {
  const usage: ClaudeUsageRow[] = [];
  const sessions: ClaudeTranscript['sessions'] = [];
  const titles: ClaudeTranscript['titles'] = [];
  const seenSessionLabel = new Set<string>();

  for (const line of lines) {
    if (!line) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue; // torn or non-JSON line — skip, never abort the file
    }
    const sessionId = (obj.sessionId ?? obj.session_id) as string | undefined;
    // ai-title entries carry no timestamp, so they must be read before the ts guard.
    if (obj.type === 'ai-title' && sessionId && typeof obj.aiTitle === 'string' && obj.aiTitle.trim()) {
      titles.push({ sessionId, title: obj.aiTitle.trim() });
      continue;
    }
    const ts = typeof obj.timestamp === 'string' ? Math.floor(Date.parse(obj.timestamp) / 1000) : NaN;
    if (!sessionId || !Number.isFinite(ts)) continue;
    const project = typeof obj.cwd === 'string' ? obj.cwd : '';
    const message = obj.message as Record<string, unknown> | undefined;

    if (obj.type === 'assistant' && typeof obj.requestId === 'string' && message) {
      const u = message.usage as Record<string, unknown> | undefined;
      if (!u) continue;
      const cache = u.cache_creation as Record<string, unknown> | undefined;
      usage.push({
        requestId: obj.requestId,
        ts,
        sessionId,
        project,
        model: typeof message.model === 'string' ? message.model : 'unknown',
        input: num(u.input_tokens),
        output: num(u.output_tokens),
        cacheRead: num(u.cache_read_input_tokens),
        // Older CLI versions have only the flat total — treat it as 5m.
        cacheW5m: cache ? num(cache.ephemeral_5m_input_tokens) : num(u.cache_creation_input_tokens),
        cacheW1h: cache ? num(cache.ephemeral_1h_input_tokens) : 0,
      });
    } else if (obj.type === 'user' && !obj.isMeta && message && !seenSessionLabel.has(sessionId)) {
      const text = userText(message.content);
      if (text) {
        seenSessionLabel.add(sessionId);
        sessions.push({ sessionId, project, ts, label: text.slice(0, 140) });
      }
    }
  }
  return { usage, sessions, titles };
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function userText(content: unknown): string {
  let text = '';
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    const part = content.find((p) => (p as { type?: string }).type === 'text') as { text?: string } | undefined;
    text = part?.text ?? '';
  }
  text = text.trim();
  // Skip harness noise: command wrappers, tool results, system reminders.
  if (!text || text.startsWith('<')) return '';
  return text.replace(/\s+/g, ' ');
}

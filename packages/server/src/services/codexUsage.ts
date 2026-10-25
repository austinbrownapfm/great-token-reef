import { createHash } from 'node:crypto';
import { estimateCodexCost } from './pricing.ts';
import type { CodexLimitSnapshot, CodexLimitWindow, CodexSessionRow, CodexUsageRow } from './reefTypes.ts';

export const CODEX_PARSER_VERSION = 2;
type Json = Record<string, unknown>;
interface Counters { input: number; cached: number; output: number; reasoning: number; cacheWrite: number }
export interface CodexParserState {
  session: CodexSessionRow | null;
  model: string;
  previous: Counters | null;
  boundary: number | null;
  owned: boolean;
  blocked: boolean;
  line: number;
  diagnostics: string[];
  diagnosticCount: number;
}
export function newCodexParserState(): CodexParserState {
  return { session: null, model: 'unknown', previous: null, boundary: null, owned: false, blocked: false, line: 0, diagnostics: [], diagnosticCount: 0 };
}
function object(value: unknown): Json | null { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : null; }
function integer(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function seconds(value: unknown): number | null {
  const n = typeof value === 'string' ? Date.parse(value) / 1000 : NaN;
  return Number.isFinite(n) ? Math.floor(n) : null;
}
export function codexDiagnostic(state: CodexParserState, message: string): void {
  state.diagnosticCount++;
  state.diagnostics.push(`line ${state.line}: ${message}`);
  if (state.diagnostics.length > 20) state.diagnostics.shift();
}
function counters(value: unknown): Counters | null {
  const v = object(value);
  if (!v || !integer(v.input_tokens) || !integer(v.output_tokens)) return null;
  const cached = v.cached_input_tokens ?? 0, reasoning = v.reasoning_output_tokens ?? 0, cacheWrite = v.cache_write_input_tokens ?? 0;
  if (!integer(cached) || !integer(reasoning) || !integer(cacheWrite) || cached > v.input_tokens || reasoning > v.output_tokens) return null;
  if (v.total_tokens !== undefined && v.total_tokens !== v.input_tokens + v.output_tokens) return null;
  return { input: v.input_tokens, cached, output: v.output_tokens, reasoning, cacheWrite };
}
function limitWindow(value: unknown, ts: number): CodexLimitWindow | null {
  const v = object(value);
  if (!v || typeof v.used_percent !== 'number' || !Number.isFinite(v.used_percent) || v.used_percent < 0 || typeof v.window_minutes !== 'number' || !Number.isFinite(v.window_minutes) || v.window_minutes <= 0) return null;
  return { usedPercent: v.used_percent, windowMinutes: v.window_minutes,
    resetsAt: integer(v.resets_at) ? v.resets_at : integer(v.resets_in_seconds) ? ts + v.resets_in_seconds : null };
}

/** Mutates only JSON-serializable checkpoint state. Never retains prompt/tool content. */
export function parseCodexLine(line: string, state: CodexParserState, source = 'local'): {
  usage: CodexUsageRow[]; sessions: CodexSessionRow[]; limits: CodexLimitSnapshot[];
} {
  const result: { usage: CodexUsageRow[]; sessions: CodexSessionRow[]; limits: CodexLimitSnapshot[] } = { usage: [], sessions: [], limits: [] };
  state.line++;
  let record: Json | null;
  try { record = object(JSON.parse(line)); } catch { codexDiagnostic(state, 'malformed JSON record'); return result; }
  const payload = object(record?.payload);
  if (!record || !payload) { codexDiagnostic(state, 'unsupported record envelope'); return result; }
  const ts = seconds(record.timestamp);
  if (record.type === 'session_meta' && !state.session) {
    const id = payload.id ?? payload.session_id;
    if (typeof id !== 'string' || !id || ts === null) { codexDiagnostic(state, 'invalid session metadata'); return result; }
    const parent = payload.forked_from_id ?? payload.parent_thread_id;
    state.session = { sessionId: `codex:${id}`, nativeId: id, parentSessionId: typeof parent === 'string' ? `codex:${parent}` : null,
      project: typeof payload.cwd === 'string' ? payload.cwd : '', ts, label: '', modelProvider: typeof payload.model_provider === 'string' ? payload.model_provider : null, source };
    state.boundary = integer(payload.subagent_history_start_ordinal) ? payload.subagent_history_start_ordinal : null;
    // A parent ID records ancestry; only a fork declares copied history.
    // Older independent subagents have parent_thread_id without a boundary.
    const forked = typeof payload.forked_from_id === 'string' && payload.forked_from_id.length > 0;
    state.owned = !forked && state.boundary === null;
    state.blocked = forked && state.boundary === null;
    if (state.blocked) codexDiagnostic(state, 'fork has no validated owned-history boundary; usage excluded');
    result.sessions.push({ ...state.session });
    return result;
  }
  if (!state.session) { codexDiagnostic(state, 'record precedes canonical session metadata'); return result; }
  if (state.blocked) return result;
  if (!state.owned) {
    // Observed 0.153/0.154 layout: copied parent history precedes a settings
    // event at exactly this ordinal, explicitly naming the child thread.
    if (record.ordinal === state.boundary && record.type === 'event_msg' && payload.type === 'thread_settings_applied' && payload.thread_id === state.session.nativeId) {
      state.owned = true;
      state.previous = null;
      const settings = object(payload.thread_settings);
      state.model = typeof settings?.model === 'string' ? settings.model : 'unknown';
    } else if (integer(record.ordinal) && state.boundary !== null && record.ordinal > state.boundary) {
      state.blocked = true;
      codexDiagnostic(state, 'owned-history boundary missing or unsupported; usage excluded');
    }
    return result;
  }
  // Repeated embedded metadata must never rename the owning session.
  if (record.type === 'session_meta') return result;
  if (record.type === 'turn_context') {
    if (typeof payload.model === 'string') state.model = payload.model;
    return result;
  }
  const userMessage = record.type === 'event_msg' && payload.type === 'user_message' && typeof payload.message === 'string'
    ? payload.message : record.type === 'response_item' && payload.type === 'message' && payload.role === 'user' && Array.isArray(payload.content)
      ? payload.content.map((part) => { const item = object(part); return (item?.type === 'input_text' || item?.type === 'text') && typeof item.text === 'string' ? item.text : ''; }).join('\n') : null;
  if (!state.session.label && userMessage) {
    const label = userMessage.trim();
    if (label && !/^(?:<|# AGENTS\.md|\[System|You are )/i.test(label)) {
      state.session.label = label.replace(/\s+/g, ' ').slice(0, 160);
      result.sessions.push({ ...state.session });
    }
  }
  if (record.type !== 'event_msg' || payload.type !== 'token_count') return result;
  if (ts === null) { codexDiagnostic(state, 'usage has no valid timestamp'); return result; }
  const rates = object(payload.rate_limits);
  if (rates) result.limits.push({ observedAt: ts, source, limitId: typeof rates.limit_id === 'string' ? rates.limit_id : 'codex',
    primary: limitWindow(rates.primary, ts), secondary: limitWindow(rates.secondary, ts),
    unlimited: rates.unlimited === true,
    plan: typeof rates.plan_type === 'string' ? rates.plan_type : null });
  const info = object(payload.info);
  if (!info) return result;
  const current = counters(info.total_token_usage);
  if (!current) { codexDiagnostic(state, 'invalid cumulative counters; usage excluded'); return result; }
  const previous = state.previous;
  state.previous = current;
  const last = counters(info.last_token_usage);
  if (!previous && state.session.parentSessionId && (!last || JSON.stringify(last) !== JSON.stringify(current))) {
    codexDiagnostic(state, 'initial child cumulative counters may include inherited usage; baseline retained without credit');
    return result;
  }
  const delta: Counters = previous ? { input: current.input - previous.input, cached: current.cached - previous.cached,
    output: current.output - previous.output, reasoning: current.reasoning - previous.reasoning, cacheWrite: current.cacheWrite - previous.cacheWrite } : { ...current };
  if (Object.values(delta).some((n) => n < 0)) { codexDiagnostic(state, 'cumulative counter reset; ambiguous increment excluded, baseline advanced'); return result; }
  if (delta.cached > delta.input || delta.reasoning > delta.output) { codexDiagnostic(state, 'inconsistent counter delta subsets; increment excluded'); return result; }
  if (delta.input + delta.output === 0) return result;
  // Last-event counters can repeat or represent only the final request in a
  // cumulative jump. They corroborate the snapshot, never add extra tokens.
  if (info.last_token_usage != null && !last) codexDiagnostic(state, 'invalid last-event counters; valid cumulative delta retained');
  if (delta.cacheWrite > 0) codexDiagnostic(state, 'cache-write billing semantics unavailable; cost unpriced');
  const fingerprint = createHash('sha256').update(JSON.stringify([state.session.nativeId, record.timestamp, state.model, current])).digest('hex');
  const input = delta.input - delta.cached;
  result.usage.push({ requestId: `codex:${state.session.nativeId}:${fingerprint}`, ts, sessionId: state.session.sessionId,
    project: state.session.project, model: state.model, input, output: delta.output, cacheRead: delta.cached,
    reasoningOutput: delta.reasoning, cacheWriteInput: delta.cacheWrite,
    cost: estimateCodexCost(state.model, { input, cacheRead: delta.cached, output: delta.output, cacheWriteInput: delta.cacheWrite }) });
  return result;
}

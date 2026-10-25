import { describe, expect, it } from 'vitest';
import { newCodexParserState, parseCodexLine } from './codexUsage.ts';

const timestamp = '2026-09-11T10:00:00Z';
const record = (type: string, payload: unknown, ordinal?: number) => JSON.stringify({ type, timestamp, payload, ...(ordinal === undefined ? {} : { ordinal }) });
const vector = (input: number, cached = 0, output = 10, reasoning = 2, cacheWrite = 0) => ({ input_tokens: input, cached_input_tokens: cached, output_tokens: output, reasoning_output_tokens: reasoning, cache_write_input_tokens: cacheWrite, total_tokens: input + output });
const token = (total: unknown, ordinal?: number, extra = {}) => record('event_msg', { type: 'token_count', info: { total_token_usage: total, last_token_usage: total }, ...extra }, ordinal);
function parser(id = 'session') {
  const state = newCodexParserState();
  parseCodexLine(record('session_meta', { id, cwd: '/synthetic/project', model_provider: 'openai' }), state);
  parseCodexLine(record('turn_context', { model: 'gpt-5-codex' }), state);
  return state;
}

describe('Codex cumulative usage parsing', () => {
  it('counts disjoint categories and suppresses repeated cumulative snapshots', () => {
    const state = parser();
    const first = parseCodexLine(token(vector(100, 30)), state).usage[0]!;
    expect(first).toMatchObject({ input: 70, cacheRead: 30, output: 10, reasoningOutput: 2, sessionId: 'codex:session' });
    expect(parseCodexLine(token(vector(100, 30)), state).usage).toEqual([]);
    expect(parseCodexLine(token(vector(180, 60, 15, 3)), state).usage[0]).toMatchObject({ input: 50, cacheRead: 30, output: 5, reasoningOutput: 1 });
  });

  it('retains session/model/counters through serialized checkpoint restart', () => {
    const state = parser();
    parseCodexLine(token(vector(100, 20)), state);
    const resumed = JSON.parse(JSON.stringify(state));
    expect(parseCodexLine(token(vector(150, 30, 15)), resumed).usage[0]).toMatchObject({ input: 40, cacheRead: 10, output: 5, model: 'gpt-5-codex' });
  });

  it('fingerprints native and mirrored events identically, ignoring rate snapshots', () => {
    const first = parseCodexLine(token(vector(100)), parser(), 'local').usage[0]!;
    const mirror = parseCodexLine(token(vector(100), undefined, { rate_limits: { primary: null } }), parser(), 'sandbox:fixture').usage[0]!;
    expect(first.requestId).toBe(mirror.requestId);
    expect(parseCodexLine(token(vector(100)), parser('other')).usage[0]!.requestId).not.toBe(first.requestId);
  });

  it('processes rate-only and unchanged-usage snapshots without inventing windows', () => {
    const state = parser();
    const rates = { primary: { used_percent: 24, window_minutes: 300, resets_in_seconds: 120 }, secondary: null, credits: { unlimited: true }, limit_id: 'codex', plan_type: 'pro' };
    const parsed = parseCodexLine(record('event_msg', { type: 'token_count', info: null, rate_limits: rates }), state);
    expect(parsed.usage).toEqual([]);
    expect(parsed.limits[0]).toMatchObject({ source: 'local', primary: { usedPercent: 24, windowMinutes: 300 }, secondary: null, unlimited: false, plan: 'pro' });
    parseCodexLine(token(vector(100)), state);
    expect(parseCodexLine(token(vector(100), undefined, { rate_limits: rates }), state).limits).toHaveLength(1);
    expect(parseCodexLine(record('event_msg', { type: 'token_count', info: null, rate_limits: { primary: { used_percent: 0, window_minutes: 0 } } }), state).limits[0]!.primary).toBeNull();
  });

  it('keeps unknown model cost unknown and does not add cache-write informational tokens', () => {
    const state = parser(); state.model = 'unpriced';
    expect(parseCodexLine(token(vector(100, 20, 10, 2, 5)), state).usage[0]).toMatchObject({ input: 80, cacheRead: 20, output: 10, cacheWriteInput: 5, cost: null });
    expect(state.diagnostics.join()).toContain('cache-write');
  });

  it('excludes ambiguous reset increments and resumes from the observed new baseline', () => {
    const state = parser();
    parseCodexLine(token(vector(100)), state);
    expect(parseCodexLine(token(vector(20, 0, 2, 1)), state).usage).toEqual([]);
    expect(state.diagnostics.join()).toContain('reset');
    expect(parseCodexLine(token(vector(40, 0, 4, 1)), state).usage[0]).toMatchObject({ input: 20, output: 2 });
  });

  it('rejects invalid cumulative subset/total relationships', () => {
    const state = parser();
    expect(parseCodexLine(token(vector(10, 20)), state).usage).toEqual([]);
    expect(parseCodexLine(token({ ...vector(20), total_tokens: 999 }), state).usage).toEqual([]);
    expect(state.diagnosticCount).toBe(2);
  });

  it('keeps malformed records observable without storing their text', () => {
    const state = parser();
    parseCodexLine('private prompt is not JSON', state);
    expect(state.diagnostics.join()).toContain('malformed JSON');
    expect(JSON.stringify(state)).not.toContain('private prompt');
    expect(parseCodexLine(token(vector(100)), state).usage).toHaveLength(1);
  });

  it('uses genuine user event labels and excludes injected instruction text', () => {
    const state = parser();
    parseCodexLine(record('event_msg', { type: 'user_message', message: '<environment_context>injected</environment_context>' }), state);
    expect(state.session!.label).toBe('');
    parseCodexLine(record('event_msg', { type: 'user_message', message: 'Build a synthetic café' }), state);
    expect(state.session!.label).toBe('Build a synthetic café');
  });

  it('preserves first child identity and excludes inherited parent counters/context/labels', () => {
    const state = newCodexParserState();
    parseCodexLine(record('session_meta', { id: 'child', forked_from_id: 'parent', subagent_history_start_ordinal: 5 }, 0), state);
    parseCodexLine(record('session_meta', { id: 'parent' }, 1), state);
    parseCodexLine(record('turn_context', { model: 'parent-model' }, 2), state);
    expect(parseCodexLine(token(vector(9000), 3), state).usage).toEqual([]);
    parseCodexLine(record('event_msg', { type: 'user_message', message: 'parent label' }, 4), state);
    parseCodexLine(record('event_msg', { type: 'thread_settings_applied', thread_id: 'child', thread_settings: { model: 'gpt-5-codex' } }, 5), state);
    expect(parseCodexLine(token(vector(100), 6), state).usage[0]).toMatchObject({ sessionId: 'codex:child', input: 100, model: 'gpt-5-codex' });
    expect(state.session).toMatchObject({ nativeId: 'child', parentSessionId: 'codex:parent', label: '' });
  });

  it('excludes the first child snapshot if cumulative counters still include parent usage', () => {
    const state = newCodexParserState();
    parseCodexLine(record('session_meta', { id: 'child', parent_thread_id: 'parent', subagent_history_start_ordinal: 2 }, 0), state);
    parseCodexLine(record('session_meta', { id: 'parent' }, 1), state);
    parseCodexLine(record('event_msg', { type: 'thread_settings_applied', thread_id: 'child' }, 2), state);
    const ambiguous = record('event_msg', { type: 'token_count', info: { total_token_usage: vector(1000, 100, 100, 10), last_token_usage: vector(100, 10, 10, 1) } }, 3);
    expect(parseCodexLine(ambiguous, state).usage).toEqual([]);
    expect(state.diagnostics.join()).toContain('may include inherited usage');
    expect(parseCodexLine(token(vector(1100, 110, 110, 11), 4), state).usage[0]).toMatchObject({ input: 90, cacheRead: 10, output: 10 });
  });

  it('distinguishes explicit unlimited quota from unlimited credits', () => {
    const state = parser();
    const credits = parseCodexLine(record('event_msg', { type: 'token_count', rate_limits: { credits: { unlimited: true } } }), state);
    expect(credits.limits[0]!.unlimited).toBe(false);
    const quota = parseCodexLine(record('event_msg', { type: 'token_count', rate_limits: { unlimited: true } }), state);
    expect(quota.limits[0]!.unlimited).toBe(true);
  });

  it('excludes unsupported fork history and wrong-thread boundary events', () => {
    const noBoundary = newCodexParserState();
    parseCodexLine(record('session_meta', { id: 'child', forked_from_id: 'parent' }), noBoundary);
    expect(parseCodexLine(token(vector(100)), noBoundary).usage).toEqual([]);
    expect(noBoundary.diagnosticCount).toBe(1);
    const state = newCodexParserState();
    parseCodexLine(record('session_meta', { id: 'child', forked_from_id: 'parent', subagent_history_start_ordinal: 2 }, 0), state);
    parseCodexLine(record('event_msg', { type: 'thread_settings_applied', thread_id: 'other' }, 2), state);
    expect(parseCodexLine(token(vector(100), 3), state).usage).toEqual([]);
    expect(state.blocked).toBe(true);
  });
});

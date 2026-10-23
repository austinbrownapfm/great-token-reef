import { createHash } from 'node:crypto';

// Claude rates, USD per million tokens, from the Anthropic price sheet
// (https://platform.claude.com/docs/en/about-claude/pricing, checked 2026-10-19).
// The sheet lists display names only; the IDs are the ones Claude Code logs.
// 5-minute cache writes are 1.25× input and 1-hour writes 2× for every model;
// cache reads default to 0.1× input. Editing this table re-prices stored
// history on the next server start (see repriceClaudeUsage in reef.ts).
interface ClaudeRate {
  input: number;
  output: number;
  cacheReadMult?: number;
  /** Rates for a request whose whole prompt (input + cache reads + writes) is over `promptTokens`. */
  longPrompt?: { promptTokens: number; input: number; output: number };
}

const CLAUDE_RATES: Record<string, ClaudeRate> = {
  'claude-fable-5-1': { input: 10, output: 50, cacheReadMult: 0.025 },
  'claude-fable-5': { input: 10, output: 50 },
  'claude-opus-5-5': { input: 4, output: 20, cacheReadMult: 0.05 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheReadMult: 0.05 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-5-5': {
    input: 0.1, output: 0.5,
    longPrompt: { promptTokens: 100_000, input: 0.5, output: 2.5 },
  },
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
  // Claude Code's placeholder for locally generated messages — no billing.
  '<synthetic>': { input: 0, output: 0 },
};

export interface CcTokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheW5m: number;
  cacheW1h: number;
}

/** USD for one Claude Code message, or null when the model isn't on the price sheet table. */
export function estimateCcCost(model: string, u: CcTokenUsage): number | null {
  const base = Object.hasOwn(CLAUDE_RATES, model) ? CLAUDE_RATES[model] : undefined;
  if (!base) return null;
  const prompt = u.input + u.cacheRead + u.cacheW5m + u.cacheW1h;
  const rates = base.longPrompt && prompt > base.longPrompt.promptTokens ? base.longPrompt : base;
  return (
    (u.input * rates.input +
      u.output * rates.output +
      u.cacheRead * rates.input * (base.cacheReadMult ?? 0.1) +
      u.cacheW5m * rates.input * 1.25 +
      u.cacheW1h * rates.input * 2) /
    1_000_000
  );
}

/** Changes whenever CLAUDE_RATES does — the trigger for re-pricing stored usage. */
export const CLAUDE_RATES_FINGERPRINT = createHash('sha1').update(JSON.stringify(CLAUDE_RATES)).digest('hex');

// Standard API-equivalent USD per million tokens, verified 2026-09-11.
// Sources: https://developers.openai.com/api/docs/models/<model-id>
// These rates are separate from Claude's historical pricing/cache rules.
const CODEX_PRICING: Record<string, { input: number; cached: number; output: number; longContext?: boolean }> = {
  'gpt-5-codex': { input: 1.25, cached: 0.125, output: 10 },
  'gpt-5.1-codex': { input: 1.25, cached: 0.125, output: 10 },
  'gpt-5.1-codex-max': { input: 1.25, cached: 0.125, output: 10 },
  'gpt-5.2-codex': { input: 1.75, cached: 0.175, output: 14 },
  'gpt-5.3-codex': { input: 1.75, cached: 0.175, output: 14 },
  'gpt-5.4': { input: 2.5, cached: 0.25, output: 15, longContext: true },
  'gpt-5.5': { input: 5, cached: 0.5, output: 30, longContext: true },
  'gpt-5.6': { input: 4, cached: 0.4, output: 20, longContext: true },
  'gpt-5.6-sol': { input: 4, cached: 0.4, output: 20, longContext: true },
  'gpt-5.6-terra': { input: 2, cached: 0.2, output: 12, longContext: true },
  'gpt-5.6-luna': { input: 0.2, cached: 0.02, output: 1.2, longContext: true },
  'gpt-6-astra': { input: 10, cached: 1, output: 50, longContext: true },
};

/** input excludes cached reads; output already includes reasoning tokens. */
export function estimateCodexCost(model: string, usage: {
  input: number; cacheRead: number; output: number; cacheWriteInput?: number;
}): number | null {
  const rates = Object.hasOwn(CODEX_PRICING, model) ? CODEX_PRICING[model] : undefined;
  const writes = usage.cacheWriteInput ?? 0;
  if (!rates || [usage.input, usage.cacheRead, usage.output, writes].some((n) => !Number.isSafeInteger(n) || n < 0)) return null;
  // Nonzero rollout cache-write counters and aggregated long-context usage
  // need additional billing context. Keep their tokens, mark cost unknown.
  if (writes > 0 || (rates.longContext && usage.input + usage.cacheRead > 272_000)) return null;
  return (usage.input * rates.input + usage.cacheRead * rates.cached + usage.output * rates.output) / 1_000_000;
}

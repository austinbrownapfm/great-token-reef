import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Db } from '../store/db.ts';
import { getSetting } from './settings.ts';

// Official plan limits for the Reef gauges — the same trick PokeTokenBar
// uses (Sources/PokeTokenBar/Core/OAuthLimitsProvider.swift): read Claude
// Code's own OAuth access token and ask Anthropic's oauth usage endpoint for
// the REAL 5h/7d window utilization + reset times, instead of estimating
// budgets from observed peaks. Manual refresh only (button on /reef) — the
// endpoint is undocumented, so we never poll it.
//
// The token is read fresh on every refresh (Claude Code rotates it itself)
// and never stored or logged.

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const LIMITS_KEY = 'limits';

export interface OfficialWindow {
  /** Percent, 0–100 (Anthropic reports utilization, not token budgets). */
  utilization: number | null;
  /** ISO-8601 reset time. */
  resetsAt: string | null;
}

export interface OfficialLimits {
  fiveHour: OfficialWindow | null;
  sevenDay: OfficialWindow | null;
  sevenDayOpus: OfficialWindow | null;
  sevenDaySonnet: OfficialWindow | null;
  /** e.g. "Max 20x" from subscriptionType + rateLimitTier. */
  plan: string | null;
  fetchedAt: number;
}

interface OauthCreds {
  accessToken: string;
  subscriptionType?: string;
  rateLimitTier?: string;
}

/**
 * All credential sources, freshest first. On macOS the Keychain holds the
 * token Claude Code actually rotates — a stale ~/.claude/.credentials.json
 * from an older version must not shadow it (it 401s). Expired candidates
 * (expiresAt in the past) sort last but are still tried: clock skew beats
 * refusing outright.
 */
function credentialCandidates(): OauthCreds[] {
  const out: OauthCreds[] = [];
  const add = (raw: string | null) => {
    if (!raw) return;
    try {
      const oauth = (JSON.parse(raw) as { claudeAiOauth?: OauthCreds & { expiresAt?: number } }).claudeAiOauth;
      if (oauth?.accessToken && !out.some((c) => c.accessToken === oauth.accessToken)) out.push(oauth);
    } catch {
      // unparseable source — skip
    }
  };
  try {
    add(execFileSync('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], {
      encoding: 'utf8',
      timeout: 10_000, // may wait on a Keychain prompt
    }));
  } catch {
    // not macOS, keychain locked, or item missing
  }
  try {
    add(readFileSync(join(homedir(), '.claude', '.credentials.json'), 'utf8'));
  } catch {
    // no credentials file
  }
  if (out.length === 0) {
    throw new Error('no Claude Code credentials (Keychain "Claude Code-credentials" or ~/.claude/.credentials.json)');
  }
  const now = Date.now();
  return out.sort((a, b) => Number(isExpired(b, now)) - Number(isExpired(a, now))).reverse();
}

const isExpired = (c: OauthCreds & { expiresAt?: number }, now: number) =>
  typeof c.expiresAt === 'number' && c.expiresAt < now;

/** Pure mapper (unit-tested): oauth usage JSON + creds → OfficialLimits. */
export function mapOauthUsage(
  json: Record<string, unknown>,
  creds: { subscriptionType?: string; rateLimitTier?: string },
  fetchedAt: number,
): OfficialLimits {
  const window = (v: unknown): OfficialWindow | null => {
    if (!v || typeof v !== 'object') return null;
    const w = v as { utilization?: unknown; resets_at?: unknown };
    return {
      utilization: typeof w.utilization === 'number' ? w.utilization : null,
      resetsAt: typeof w.resets_at === 'string' ? w.resets_at : null,
    };
  };
  let plan: string | null = null;
  if (creds.subscriptionType) {
    plan = creds.subscriptionType.charAt(0).toUpperCase() + creds.subscriptionType.slice(1);
    const mult = creds.rateLimitTier?.match(/(\d+)x/)?.[1];
    if (mult) plan += ` ${mult}x`;
  }
  return {
    fiveHour: window(json.five_hour),
    sevenDay: window(json.seven_day),
    sevenDayOpus: window(json.seven_day_opus),
    sevenDaySonnet: window(json.seven_day_sonnet),
    plan,
    fetchedAt,
  };
}

export async function refreshOfficialLimits(db: Db): Promise<OfficialLimits> {
  const candidates = credentialCandidates();
  let creds: OauthCreds | null = null;
  let json: Record<string, unknown> | null = null;
  let lastStatus = 0;
  for (const candidate of candidates) {
    const res = await fetch(USAGE_URL, {
      headers: {
        authorization: `Bearer ${candidate.accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      creds = candidate;
      json = (await res.json()) as Record<string, unknown>;
      break;
    }
    lastStatus = res.status;
    if (res.status !== 401 && res.status !== 403) break; // non-auth error: don't burn more candidates
  }
  if (!creds || !json) {
    throw new Error(
      lastStatus === 401 || lastStatus === 403
        ? `all Claude Code tokens rejected (HTTP ${lastStatus}) — use Claude Code on the Mac once to refresh its token, then re-sync`
        : `oauth usage endpoint HTTP ${lastStatus}`,
    );
  }
  const limits = mapOauthUsage(json, creds, Math.floor(Date.now() / 1000));
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(LIMITS_KEY, JSON.stringify(limits));
  console.log(
    `[limits] official limits synced: 5h ${limits.fiveHour?.utilization ?? '?'}% · 7d ${limits.sevenDay?.utilization ?? '?'}% · plan ${limits.plan ?? 'unknown'}`,
  );
  return limits;
}

export function getOfficialLimits(db: Db): OfficialLimits | null {
  const raw = getSetting(db, LIMITS_KEY);
  return raw ? (JSON.parse(raw) as OfficialLimits) : null;
}

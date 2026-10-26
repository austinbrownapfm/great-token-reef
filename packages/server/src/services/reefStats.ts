import {
  CodexLimits,
  type OfficialLimits,
  type QuotaBurn,
  type QuotaWeek,
  type ReefCatch,
  type ReefModelRow,
  type ReefProjectRow,
  type ReefSessionRow,
  type ReefSummary,
  type ReefTrendRow,
  type Window5h,
} from '@gtr/shared';
import type { Db } from '../store/db.ts';
import { ladderTokens } from './legendaryAwards.ts';
import { getOfficialLimits } from './reefLimits.ts';
import { pendingCount } from './reefRelease.ts';
import { TOK, WINDOW_5H, deriveCatch, type CatchColumns } from './reefRows.ts';
import { getReefBudgets, readCodexRewardEpoch } from './reefState.ts';
import type { ReefAgentFilter } from './reefTypes.ts';

// Usage and quota queries behind the Reef's read routes.

function tokensPerActiveMin7d(db: Db, agent: ReefAgentFilter, weekTokens: number, now: number): number {
  const { n } = db.prepare(
    `SELECT COUNT(DISTINCT ts / 60) AS n FROM cc_usage
     WHERE ts > ? AND (? = 'all' OR agent = ?)`,
  ).get(now - 7 * 86400, agent, agent) as { n: number };
  return n > 0 ? Math.round(weekTokens / n) : 0;
}

function claudeSummary(db: Db): {
  today: { tokens: number; cost: number; catches: number };
  window5h: Window5h;
  week: QuotaWeek;
  burn: QuotaBurn;
  official: OfficialLimits | null;
  lastCatch: ReefCatch | null;
  lifetime: {
    tokens: number; cost: number; since: number | null;
    catches: number; speciesDiscovered: number;
  };
} {
  const now = Math.floor(Date.now() / 1000);
  const dayStart = Math.floor(new Date(new Date().setHours(0, 0, 0, 0)).getTime() / 1000);
  const budgets = getReefBudgets(db);

  const today = db.prepare(
    `SELECT COALESCE(SUM(${TOK}), 0) AS tokens, COALESCE(SUM(cost), 0) AS cost
     FROM cc_usage WHERE agent = 'claude' AND ts >= ?`,
  ).get(dayStart) as { tokens: number; cost: number };
  const todayCatches = (db.prepare(
    'SELECT COUNT(*) AS n FROM cc_catches WHERE caught_at >= ?',
  ).get(dayStart) as { n: number }).n;

  // 5h windows: chain from first activity — a window opens at the first
  // message after the previous window's 5h elapses (mirrors how the plan
  // limit windows behave). 5-minute buckets keep this cheap over 14 days.
  const buckets = db.prepare(
    `SELECT (ts / 300) * 300 AS bucket, SUM(${TOK}) AS tokens
     FROM cc_usage WHERE agent = 'claude' AND ts > ? GROUP BY bucket ORDER BY bucket`,
  ).all(now - 14 * 86400) as { bucket: number; tokens: number }[];

  let windowStart: number | null = null;
  let windowTokens = 0;
  let maxWindowTokens = 0;
  for (const b of buckets) {
    if (windowStart === null || b.bucket >= windowStart + WINDOW_5H) {
      windowStart = b.bucket;
      windowTokens = 0;
    }
    windowTokens += b.tokens;
    if (windowTokens > maxWindowTokens) maxWindowTokens = windowTokens;
  }
  const inWindow = windowStart !== null && now < windowStart + WINDOW_5H;
  const cur5h = inWindow ? windowTokens : 0;
  const budget5h = budgets.window5h ?? (maxWindowTokens > 0 ? Math.ceil(maxWindowTokens * 1.1) : null);

  const week = db.prepare(
    `SELECT COALESCE(SUM(${TOK}), 0) AS tokens, COALESCE(SUM(cost), 0) AS cost
     FROM cc_usage WHERE agent = 'claude' AND ts > ?`,
  ).get(now - 7 * 86400) as { tokens: number; cost: number };
  // Estimated weekly budget: worst consecutive-7-day total in the last 14.
  const daily = db.prepare(
    `SELECT (ts / 86400) AS day, SUM(${TOK}) AS tokens FROM cc_usage
     WHERE agent = 'claude' AND ts > ? GROUP BY day ORDER BY day`,
  ).all(now - 14 * 86400) as { day: number; tokens: number }[];
  let maxWeek = 0;
  for (let i = 0; i < daily.length; i++) {
    let sum = 0;
    for (let j = i; j < daily.length && daily[j]!.day < daily[i]!.day + 7; j++) sum += daily[j]!.tokens;
    if (sum > maxWeek) maxWeek = sum;
  }
  const budgetWeek = budgets.week ?? (maxWeek > 0 ? Math.ceil(maxWeek * 1.1) : null);

  const lastHour = db.prepare(
    `SELECT COALESCE(SUM(${TOK}), 0) AS tokens, COALESCE(SUM(cost), 0) AS cost
     FROM cc_usage WHERE agent = 'claude' AND ts > ?`,
  ).get(now - 3600) as { tokens: number; cost: number };
  const tokensPerMin = lastHour.tokens / 60;
  // Forecast: at the last hour's pace, when does the current window budget run out?
  let limitAt: number | null = null;
  if (inWindow && budget5h && tokensPerMin > 0 && cur5h < budget5h) {
    const minutes = (budget5h - cur5h) / tokensPerMin;
    const hit = now + Math.round(minutes * 60);
    if (hit < windowStart! + WINDOW_5H) limitAt = hit;
  }

  const lastCatchRow = (db.prepare(
    'SELECT * FROM cc_catches ORDER BY caught_at DESC, id DESC LIMIT 1',
  ).get() ?? null) as CatchColumns | null;
  const lastCatch = lastCatchRow ? deriveCatch(lastCatchRow) : null;

  const lifetime = db.prepare(
    `SELECT COALESCE(SUM(${TOK}), 0) AS tokens, COALESCE(SUM(cost), 0) AS cost, MIN(ts) AS since
     FROM cc_usage WHERE agent = 'claude'`,
  ).get() as { tokens: number; cost: number; since: number | null };
  const catchTotals = db.prepare(
    `SELECT COUNT(*) AS catches, COUNT(DISTINCT CASE WHEN rarity != 'legendary' THEN species END) AS species
     FROM cc_catches`,
  ).get() as { catches: number; species: number };

  return {
    today: { ...today, catches: todayCatches },
    window5h: {
      tokens: cur5h,
      budget: budget5h,
      budgetEstimated: budgets.window5h === null,
      startedAt: inWindow ? windowStart : null,
      resetAt: inWindow ? windowStart! + WINDOW_5H : null,
      limitAt,
    },
    week: { ...week, budget: budgetWeek, budgetEstimated: budgets.week === null },
    burn: {
      tokensPerMin: Math.round(tokensPerMin),
      costPerHour: Math.round(lastHour.cost * 100) / 100,
      tokensPerMin7d: Math.round(week.tokens / (7 * 24 * 60)),
      tokensPerActiveMin7d: tokensPerActiveMin7d(db, 'claude', week.tokens, now),
    },
    official: getOfficialLimits(db),
    lastCatch,
    lifetime: {
      tokens: lifetime.tokens, cost: lifetime.cost, since: lifetime.since,
      catches: catchTotals.catches, speciesDiscovered: catchTotals.species,
    },
  };
}

/** Usage selection is independent of Claude quotas and the shared collection. */
export function reefSummary(db: Db, agent: ReefAgentFilter = 'claude'): ReefSummary {
  const claude = claudeSummary(db);
  const now = Math.floor(Date.now() / 1000);
  const dayStart = Math.floor(new Date(new Date().setHours(0, 0, 0, 0)).getTime() / 1000);
  const totals = (since: number) => db.prepare(
    `SELECT COALESCE(SUM(${TOK}), 0) AS tokens, COALESCE(SUM(cost), 0) AS cost,
            COALESCE(SUM(CASE WHEN cost_known = 0 THEN 1 ELSE 0 END), 0) AS unpricedEvents,
            MIN(ts) AS since
     FROM cc_usage WHERE ts >= ? AND (? = 'all' OR agent = ?)`,
  ).get(since, agent, agent) as { tokens: number; cost: number; unpricedEvents: number; since: number | null };
  const today = totals(dayStart);
  const week = totals(now - 7 * 86400 + 1);
  const hour = totals(now - 3600 + 1);
  const lifetime = totals(0);
  const limitRow = db.prepare(
    'SELECT snapshot_json FROM codex_limits ORDER BY observed_at DESC, source LIMIT 1',
  ).get() as { snapshot_json: string } | undefined;
  let codexLimits: CodexLimits | null = null;
  if (limitRow) {
    try {
      const parsed = CodexLimits.safeParse(JSON.parse(limitRow.snapshot_json));
      if (parsed.success) codexLimits = parsed.data;
      else console.warn(`[codex] stored limit snapshot no longer matches the API contract; showing none: ${parsed.error.issues[0]?.message}`);
    } catch { /* ignore invalid stored telemetry */ }
  }
  return {
    ...claude,
    pending: pendingCount(db),
    today: { ...claude.today, tokens: today.tokens, cost: today.cost, unpricedEvents: today.unpricedEvents },
    week: { ...claude.week, tokens: week.tokens, cost: week.cost, unpricedEvents: week.unpricedEvents },
    burn: {
      tokensPerMin: Math.round(hour.tokens / 60),
      costPerHour: Math.round(hour.cost * 100) / 100,
      unpricedEvents: hour.unpricedEvents,
      tokensPerMin7d: Math.round(week.tokens / (7 * 24 * 60)),
      tokensPerActiveMin7d: tokensPerActiveMin7d(db, agent, week.tokens, now),
    },
    lifetime: {
      ...claude.lifetime, tokens: lifetime.tokens, cost: lifetime.cost, since: lifetime.since,
      unpricedEvents: lifetime.unpricedEvents,
    },
    claudeQuota: { window5h: claude.window5h, week: claude.week, burn: claude.burn, official: claude.official },
    rewards: {
      tokens: ladderTokens(db),
      catches: claude.lifetime.catches,
      speciesDiscovered: claude.lifetime.speciesDiscovered,
      lastCatch: claude.lastCatch,
    },
    codexLimits,
    unpricedEvents: lifetime.unpricedEvents,
  };
}

export function reefTrend(db: Db, days: number, agent: ReefAgentFilter = 'claude'): ReefTrendRow[] {
  return db.prepare(
    `SELECT date(ts, 'unixepoch', 'localtime') AS day, model, agent,
            SUM(${TOK}) AS tokens, ROUND(SUM(cost), 4) AS cost,
            SUM(CASE WHEN cost_known = 0 THEN 1 ELSE 0 END) AS unpricedEvents
     FROM cc_usage WHERE ts > unixepoch() - ? * 86400 AND (? = 'all' OR agent = ?)
     GROUP BY day, model, agent ORDER BY day`,
  ).all(days, agent, agent) as ReefTrendRow[];
}

export function reefModels(db: Db, days: number, agent: ReefAgentFilter = 'claude'): ReefModelRow[] {
  return db.prepare(
    `SELECT model, agent, COUNT(*) AS calls,
            SUM(input_tokens) AS input, SUM(output_tokens) AS output,
            SUM(cache_read_tokens) AS cache_read,
            SUM(cache_w5m_tokens + cache_w1h_tokens) AS cache_write,
            ROUND(SUM(cost), 2) AS cost,
            SUM(CASE WHEN cost_known = 0 THEN 1 ELSE 0 END) AS unpricedEvents
     FROM cc_usage WHERE ts > unixepoch() - ? * 86400 AND (? = 'all' OR agent = ?)
     GROUP BY model, agent ORDER BY cost DESC`,
  ).all(days, agent, agent) as ReefModelRow[];
}

export function reefProjects(db: Db, days: number, agent: ReefAgentFilter = 'claude'): ReefProjectRow[] {
  return db.prepare(
    `SELECT project, SUM(${TOK}) AS tokens, ROUND(SUM(cost), 2) AS cost,
            SUM(CASE WHEN cost_known = 0 THEN 1 ELSE 0 END) AS unpricedEvents,
            COUNT(DISTINCT session_id) AS sessions, MAX(ts) AS last_used
     FROM cc_usage WHERE ts > unixepoch() - ? * 86400 AND (? = 'all' OR agent = ?)
     GROUP BY project ORDER BY cost DESC`,
  ).all(days, agent, agent) as ReefProjectRow[];
}

export function reefSessions(db: Db, days: number, limit = 20, agent: ReefAgentFilter = 'claude'): ReefSessionRow[] {
  return db.prepare(
    `SELECT u.session_id,
            COALESCE(
              NULLIF(s.ai_title, ''),
              NULLIF(s.label, ''),
              (SELECT '↳ ' || COALESCE(NULLIF(p.ai_title, ''), NULLIF(p.label, ''))
                 FROM cc_sessions p
                WHERE p.session_id = s.parent_session_id
                  AND COALESCE(NULLIF(p.ai_title, ''), NULLIF(p.label, '')) IS NOT NULL),
              TRIM(replace(u.project, rtrim(u.project, replace(u.project, '/', '')), '') || ' · '
                   || strftime('%Y-%m-%d', MIN(u.ts), 'unixepoch'), ' ·')
            ) AS label, u.project, u.agent,
            s.native_id, s.parent_session_id, s.model_provider, s.source,
            MIN(u.ts) AS started_at, MAX(u.ts) AS ended_at,
            SUM(${TOK}) AS tokens,
            SUM(CASE WHEN u.agent = 'claude' OR u.ts >= ? THEN ${TOK} ELSE 0 END) AS rewardTokens,
            ROUND(SUM(u.cost), 2) AS cost,
            SUM(CASE WHEN u.cost_known = 0 THEN 1 ELSE 0 END) AS unpricedEvents,
            (SELECT COUNT(*) FROM cc_catches c WHERE c.session_id = u.session_id) AS catches
     FROM cc_usage u
     LEFT JOIN cc_sessions s ON s.session_id = u.session_id
     WHERE u.ts > unixepoch() - ? * 86400 AND (? = 'all' OR u.agent = ?)
     GROUP BY u.session_id ORDER BY ended_at DESC LIMIT ?`,
  ).all(readCodexRewardEpoch(db), days, agent, agent, limit) as ReefSessionRow[];
}

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import {
  SPECIES_COUNT,
  LEGENDARY_DEFS,
  LEGENDARY_ID_BASE,
  catchesEarned,
  milestoneAt,
  nextLegendary,
  speciesRarity,
} from '@gtr/shared';
import {
  api,
  type ReefAgent,
  type ReefCollection,
  type CodexLimits,
  type ReefSessionRow,
  type ReefSummary,
} from '../lib/api';
import { compactNumber, formatDate, formatDateTime, timeAgo } from '../lib/format';
import { legendaryProgress, legendarySlot, previewLegendary } from '../lib/legendaryRows';
import { RARITY_PILL } from '../lib/rarity';
import { officialFresh } from '../lib/reefQuota';
import { NO_HELD_REWARDS, speciesSetOf, visibleRewards } from '../lib/tankDecor';
import { uiEvent } from '../lib/telemetry';
import { Fish } from '../components/Fish';
import { ReefInventory } from '../components/ReefInventory';
import { Tank } from '../components/Tank';
import { Empty, Loading, chip, inputCls } from '../components/ui';

// The Reef — Claude Code and Codex usage analytics as an aquarium (design:
// .superpowers/brainstorm/cc-usage-20260818/design.html). All numbers are
// API-equivalent cost: what desktop usage would bill at published rates.

const MODEL_COLORS = ['#0e7490', '#7c3aed', '#ca8a04', '#dc2626', '#059669', '#6b7280'];

const TABS = [
  ['collection', 'Collection'],
  ['inventory', 'Inventory'],
  ['models', 'By Model'],
  ['projects', 'By Project'],
  ['sessions', 'Session Leaderboard'],
] as const;
type ReefTab = (typeof TABS)[number][0];

export function ReefView() {
  useEffect(() => uiEvent('reef.view'), []);
  const navigate = useNavigate();
  const { tab = 'collection', agent = 'all', species: highlight } = useSearch({ strict: false }) as {
    tab?: ReefTab; agent?: ReefAgent; species?: number;
  };
  // The tank's running release holds set rewards until their unveil; the Dex and the Inventory hold them too.
  const [heldRewards, setHeldRewards] = useState<ReadonlySet<string>>(NO_HELD_REWARDS);
  const summary = useQuery({ queryKey: ['reef', 'summary', agent], queryFn: () => api.reef.summary(agent), refetchInterval: 60_000 });
  const setTab = (t: ReefTab) => {
    uiEvent('reef.tab', t);
    void navigate({ to: '/', search: { tab: t === 'collection' ? undefined : t, agent }, replace: true });
  };

  return (
    <div className="mx-auto max-w-6xl p-6">
      <Header summary={summary.data} />
      <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Usage agent">
        {(['all', 'claude', 'codex'] as const).map((value) => (
          <button key={value} className={chip(agent === value)} aria-pressed={agent === value}
            onClick={() => { void navigate({ to: '/', search: { tab: tab === 'collection' ? undefined : tab, agent: value }, replace: true }); }}>
            {value === 'all' ? 'All' : value === 'claude' ? 'Claude' : 'Codex'}
          </button>
        ))}
        <span className="text-xs text-zinc-400">Usage filter · collection shared across agents</span>
      </div>
      {agent !== 'claude' && <CodexTracking />}
      <Tank onHeldRewards={setHeldRewards} />
      {summary.isPending ? <Loading /> : summary.data && <Vitals s={summary.data} agent={agent} />}
      <TrendChart agent={agent} />
      <div className="mt-8 flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${
              tab === key
                ? 'border-cyan-600 font-medium'
                : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mt-5">
        {tab === 'collection' && <Collection highlight={highlight} held={heldRewards} ladderTokens={summary.data?.rewards.tokens} />}
        {tab === 'inventory' && <ReefInventory held={heldRewards} />}
        {tab === 'models' && <ModelsTable agent={agent} />}
        {tab === 'projects' && <ProjectsTable agent={agent} />}
        {tab === 'sessions' && <SessionsTable agent={agent} />}
      </div>
    </div>
  );
}

function CodexTracking() {
  const status = useQuery({
    queryKey: ['reef', 'codex-status'],
    queryFn: api.reef.codexStatus,
    refetchInterval: 60_000,
  });
  if (status.isPending) return <div className="mt-2 text-xs text-zinc-400">Codex: checking indexing status…</div>;
  if (!status.data) return <div className="mt-2 text-xs text-amber-600">Codex indexing status unavailable · {status.error?.message}</div>;
  const s = status.data;
  const state = !s.enabled ? 'indexing paused'
    : s.backfilling ? 'indexing history…'
    : !s.lastScanAt ? 'waiting for first scan'
    : s.files === 0 ? 'no logs found'
    : `${s.files} log ${s.files === 1 ? 'file' : 'files'} indexed`;
  const errors = s.errors.filter((error) => !error.diagnostic);
  const hasWarnings = errors.length > 0 || s.rootErrors.length > 0;
  return (
    <div className="mt-2 text-xs text-zinc-500">
      Codex: {state}{s.lastScanAt ? ` · last scan ${timeAgo(s.lastScanAt)}` : ''}
      {hasWarnings && (
        <details className="mt-1 text-amber-600">
          <summary className="cursor-pointer">Indexing warnings</summary>
          <p className="mt-1">Recent file and directory reports:</p>
          <ul className="mt-1 list-inside list-disc break-words">
            {s.rootErrors.map((error, i) => <li key={`root-${i}`}>{error}</li>)}
            {errors.map(({ path, error }, i) => <li key={`file-${i}`}>{path}: {error}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

function Header({ summary }: { summary?: ReefSummary }) {
  const qc = useQueryClient();
  const scan = useMutation({
    mutationFn: api.reef.scan,
    onSuccess: (r) => {
      uiEvent('reef.scan', `${r.messages} messages, ${r.catches} catches`);
      void qc.invalidateQueries({ queryKey: ['reef'] });
    },
  });
  const sync = useMutation({
    mutationFn: api.reef.refreshLimits,
    onSuccess: () => {
      uiEvent('reef.limits.sync');
      void qc.invalidateQueries({ queryKey: ['reef'] });
    },
  });
  const btn =
    'rounded border border-zinc-300 px-2 py-0.5 text-xs text-zinc-500 hover:border-cyan-600 disabled:opacity-40 dark:border-zinc-700';
  return (
    <div className="flex flex-wrap items-baseline gap-3">
      <h1 className="text-lg font-semibold">🪸 The Reef</h1>
      {summary?.claudeQuota.official?.plan && (
        <span className="rounded bg-cyan-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-cyan-800 dark:bg-cyan-950 dark:text-cyan-300">
          Claude {summary.claudeQuota.official.plan}
        </span>
      )}
      <span className="text-xs text-zinc-400">
        Claude Code + Codex usage · API-equivalent cost
        {summary?.lifetime.since ? ` · since ${formatDate(summary.lifetime.since)}` : ''}
      </span>
      <span className="ml-auto flex items-center gap-2">
        {sync.isError && <span className="text-xs text-red-500">{(sync.error as Error).message}</span>}
        <button onClick={() => sync.mutate()} disabled={sync.isPending} className={btn}
          title="Fetch official plan limits via Claude Code's OAuth token">
          {sync.isPending ? 'syncing…' : '⇅ sync Claude limits'}
        </button>
        <button onClick={() => scan.mutate()} disabled={scan.isPending} className={btn}>
          {scan.isPending ? 'casting…' : '↻ scan now'}
        </button>
      </span>
    </div>
  );
}

// --- the tank ---------------------------------------------------------------

// --- vitals: gauges + burn + today -------------------------------------------

function Vitals({ s, agent }: { s: ReefSummary; agent: ReefAgent }) {
  const q = s.claudeQuota;
  const now = Math.floor(Date.now() / 1000);
  const off5h = q.official?.fiveHour;
  const off7d = q.official?.sevenDay;
  const off5hFresh = officialFresh(off5h, q.official?.fetchedAt, 5 * 3600, now);
  const off7dFresh = officialFresh(off7d, q.official?.fetchedAt, 7 * 86400, now);
  const syncedAgo = q.official ? formatCountdown(now - q.official.fetchedAt) : null;
  const perModel = [
    q.official?.sevenDayOpus?.utilization != null ? `Opus ${Math.round(q.official.sevenDayOpus.utilization)}%` : null,
    q.official?.sevenDaySonnet?.utilization != null ? `Sonnet ${Math.round(q.official.sevenDaySonnet.utilization)}%` : null,
  ].filter(Boolean).join(' · ');

  return (
    <>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Card title="Today">
          <div className="text-xl font-semibold">{costLabel(s.today.cost, s.today.unpricedEvents ?? s.unpricedEvents)}</div>
          <div className="mt-1 text-xs text-zinc-400">
            {compactNumber(s.today.tokens)} tok · {s.today.catches} 🎣
          </div>
          <div className="mt-1 text-xs text-zinc-400">
            {costLabel(s.week.cost, s.week.unpricedEvents ?? s.unpricedEvents)} · {compactNumber(s.week.tokens)} tok this week
          </div>
          <div className="mt-1 text-xs text-zinc-400">
            {compactNumber(s.rewards.tokens)} shared depth
            {nextLegendary(s.rewards.tokens) && <> · next legendary at {compactNumber(nextLegendary(s.rewards.tokens)!.threshold)}</>}
          </div>
        </Card>
        <SessionCards agent={agent} />
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {agent !== 'codex' && <>
          {off5hFresh ? (
            <PercentGaugeCard
              title="Claude · 5-hour limit (official)"
              utilization={off5h?.utilization ?? 0}
              footer={`${officialReset(off5h?.resetsAt ?? null, now)} · measured ${compactNumber(q.window5h.tokens)} tok · synced ${syncedAgo} ago`}
            />
          ) : (
            <GaugeCard
              title="Claude · 5-hour window"
              tokens={q.window5h.tokens}
              budget={q.window5h.budget}
              estimated={q.window5h.budgetEstimated}
              footer={
                q.window5h.resetAt
                  ? `resets in ${formatCountdown(q.window5h.resetAt - now)}${
                      q.window5h.limitAt ? ` · limit ~${new Date(q.window5h.limitAt * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''
                    }`
                  : 'idle — window opens on next message'
              }
            />
          )}
          {off7dFresh ? (
            <PercentGaugeCard
              title="Claude · 7-day limit (official)"
              utilization={off7d?.utilization ?? 0}
              footer={[officialReset(off7d?.resetsAt ?? null, now), perModel, `$${q.week.cost.toFixed(2)} this week`]
                .filter(Boolean)
                .join(' · ')}
            />
          ) : (
            <GaugeCard
              title="Claude · 7-day window"
              tokens={q.week.tokens}
              budget={q.week.budget}
              estimated={q.week.budgetEstimated}
              footer={`$${q.week.cost.toFixed(2)} this week`}
            />
          )}
        </>}
        {agent !== 'claude' && <CodexQuota limits={s.codexLimits} />}
      <Card title="Burn rate (last hour)">
        <div className="text-xl font-semibold">{compactNumber(s.burn.tokensPerMin)}/min</div>
        <div className="text-xs text-zinc-400">
          {costLabel(s.burn.costPerHour, s.burn.unpricedEvents ?? s.unpricedEvents)}/hr · 7d avg {compactNumber(s.burn.tokensPerMin7d)}/min
        </div>
      </Card>
      </div>
    </>
  );
}

function CodexQuota({ limits }: { limits: CodexLimits | null }) {
  if (!limits || (!limits.primary && !limits.secondary && !limits.unlimited)) return null;
  const now = Math.floor(Date.now() / 1000);
  const stale = now - limits.observedAt > 15 * 60;
  const observed = `${stale ? 'stale · ' : ''}observed ${timeAgo(limits.observedAt)} · ${limits.source} · ${limits.limitId}${limits.plan ? ` · ${limits.plan}` : ''}`;
  if (!limits.primary && !limits.secondary) return (
    <Card title="Codex limits">
      <div className="text-sm text-zinc-500">Unlimited (observed) · {observed}</div>
    </Card>
  );
  const windows = [['primary', limits.primary], ['secondary', limits.secondary]] as const;
  return (
    <>
      {windows.map(([name, window]) => {
        if (!window) return null;
        const duration = window.windowMinutes >= 60 ? `${window.windowMinutes / 60}h` : `${window.windowMinutes}m`;
        const reset = window.resetsAt
          ? window.resetsAt > now ? `resets in ${formatCountdown(window.resetsAt - now)}` : 'reset time passed'
          : null;
        return (
          <PercentGaugeCard key={name} title={`Codex · ${duration} ${name} limit`}
            utilization={window.usedPercent} footer={[reset, observed].filter(Boolean).join(' · ')} />
        );
      })}
    </>
  );
}

function costLabel(cost: number, unpricedEvents = 0): string {
  return `$${cost.toFixed(2)}${unpricedEvents > 0 ? ' known subtotal' : ''}`;
}

/** The 4 most recently active sessions, each with its next-fish rung progress. */
function SessionCards({ agent }: { agent: ReefAgent }) {
  const sessions = useQuery({
    queryKey: ['reef', 'sessions', 3650, agent],
    queryFn: () => api.reef.sessions(3650, agent),
    refetchInterval: 60_000,
  });
  return (
    <>
      {(sessions.data ?? []).slice(0, 4).map((r: ReefSessionRow) => {
        const n = catchesEarned(r.rewardTokens);
        const prev = n > 0 ? milestoneAt(n - 1) : 0;
        const next = milestoneAt(n);
        const pct = (r.rewardTokens - prev) / (next - prev);
        return (
          <Card key={r.session_id} title={`${r.agent} · ${timeAgo(r.ended_at)}`}>
            <div className="truncate text-xs font-medium" title={r.label}>
              {r.label || <span className="text-zinc-400">(untitled)</span>}
            </div>
            <div className="mt-1.5 h-2 rounded bg-zinc-200 dark:bg-zinc-800">
              <div
                className="h-2 rounded bg-teal-500"
                style={{ width: `${Math.max(1, Math.min(100, pct * 100))}%` }}
              />
            </div>
            <div className="mt-1 text-xs text-zinc-400">
              {Math.round(pct * 100)}% · {compactNumber(r.rewardTokens)} reward tok · next 🎣 at {compactNumber(next)}
            </div>
          </Card>
        );
      })}
    </>
  );
}

function officialReset(resetsAt: string | null, now: number): string {
  if (!resetsAt) return '';
  const ts = Math.floor(Date.parse(resetsAt) / 1000);
  return Number.isFinite(ts) && ts > now ? `resets in ${formatCountdown(ts - now)}` : 'resets soon';
}

function PercentGaugeCard({ title, utilization, footer }: {
  title: string; utilization: number; footer: string;
}) {
  const pct = Math.min(1, utilization / 100);
  const bar = pct >= 0.9 ? 'bg-red-500' : pct >= 0.75 ? 'bg-amber-500' : 'bg-cyan-600';
  return (
    <Card title={title}>
      <div className="text-xl font-semibold">{utilization.toFixed(utilization < 10 ? 1 : 0)}%</div>
      <div className="mt-1.5 h-2 rounded bg-zinc-200 dark:bg-zinc-800">
        <div className={`h-2 rounded ${bar}`} style={{ width: `${Math.max(1, pct * 100)}%` }} />
      </div>
      <div className="mt-1 text-xs text-zinc-400">{footer}</div>
    </Card>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">{title}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function GaugeCard({ title, tokens, budget, estimated, footer }: {
  title: string; tokens: number; budget: number | null; estimated: boolean; footer: string;
}) {
  const pct = budget ? Math.min(1, tokens / budget) : 0;
  const bar = pct >= 0.9 ? 'bg-red-500' : pct >= 0.75 ? 'bg-amber-500' : 'bg-cyan-600';
  return (
    <Card title={title}>
      <div className="text-xl font-semibold">
        {compactNumber(tokens)}
        {budget && (
          <span className="text-sm font-normal text-zinc-400">
            {' '}/ {compactNumber(budget)}{estimated ? '*' : ''}
          </span>
        )}
      </div>
      <div className="mt-1.5 h-2 rounded bg-zinc-200 dark:bg-zinc-800">
        <div className={`h-2 rounded ${bar}`} style={{ width: `${Math.max(1, pct * 100)}%` }} />
      </div>
      <div className="mt-1 text-xs text-zinc-400">
        {footer}
        {estimated && budget ? ' · *estimated from observed peaks' : ''}
      </div>
    </Card>
  );
}

// --- daily trend --------------------------------------------------------------

function TrendChart({ agent }: { agent: ReefAgent }) {
  const [days, setDays] = useState(30);
  const trend = useQuery({ queryKey: ['reef', 'trend', days, agent], queryFn: () => api.reef.trend(days, agent) });

  const { byDay, models, maxCost, tokensByDayModel } = useMemo(() => {
    const rows = trend.data ?? [];
    const models = [...new Set(rows.map((r) => `${r.agent} · ${r.model}`))];
    const byDay = new Map<string, Map<string, number>>();
    const tokensByDayModel = new Map<string, number>();
    for (const r of rows) {
      const key = `${r.agent} · ${r.model}`;
      if (!byDay.has(r.day)) byDay.set(r.day, new Map());
      byDay.get(r.day)!.set(key, r.cost);
      tokensByDayModel.set(`${r.day}::${key}`, r.tokens);
    }
    let maxCost = 0;
    for (const m of byDay.values()) {
      const t = [...m.values()].reduce((a, b) => a + b, 0);
      if (t > maxCost) maxCost = t;
    }
    return { byDay, models, maxCost, tokensByDayModel };
  }, [trend.data]);

  const dayKeys = [...byDay.keys()].sort();

  return (
    <section className="mt-8">
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-semibold">Daily trend</h2>
        {(trend.data ?? []).some((r) => r.unpricedEvents > 0) && <span className="text-xs text-amber-600">Known cost subtotal · unpriced usage included in tokens</span>}
        {[30, 90].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`rounded px-1.5 py-0.5 text-xs ${days === d ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800'}`}
          >
            {d}d
          </button>
        ))}
        <span className="ml-auto flex gap-3 text-[11px] text-zinc-400">
          {models.map((m, i) => (
            <span key={m} className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ background: MODEL_COLORS[i % MODEL_COLORS.length] }} />
              {m.replace(/^claude-/, '')}
            </span>
          ))}
        </span>
      </div>
      {trend.isPending ? (
        <Loading />
      ) : dayKeys.length === 0 ? (
        <Empty>No usage yet — the scanner checks every minute.</Empty>
      ) : (
        <div className="mt-2 flex h-36 items-end gap-[2px]">
          {dayKeys.map((day) => {
            const perModel = byDay.get(day)!;
            const total = [...perModel.values()].reduce((a, b) => a + b, 0);
            return (
              <div key={day} className="group relative flex-1" style={{ height: '100%' }}>
                <div className="absolute bottom-0 flex w-full flex-col-reverse" style={{ height: `${maxCost ? (total / maxCost) * 100 : 0}%` }}>
                  {models.map((m, i) =>
                    perModel.has(m) ? (
                      <div
                        key={m}
                        title={`${m.replace(/^claude-/, '')} · ${day}\n${compactNumber(tokensByDayModel.get(`${day}::${m}`) ?? 0)} tokens · ${costLabel(perModel.get(m)!)}`}
                        style={{
                          height: `${(total ? perModel.get(m)! / total : 0) * 100}%`,
                          background: MODEL_COLORS[i % MODEL_COLORS.length],
                        }}
                      />
                    ) : null,
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// --- tables -------------------------------------------------------------------

const th = 'py-1 pr-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-400';
const thr = 'py-1 pr-3 text-right text-xs font-semibold uppercase tracking-wide text-zinc-400';
const td = 'border-t border-zinc-200 py-1.5 pr-3 dark:border-zinc-800';

function ModelsTable({ agent }: { agent: ReefAgent }) {
  const models = useQuery({ queryKey: ['reef', 'models', 30, agent], queryFn: () => api.reef.models(30, agent) });
  return (
    <section>
      <h2 className="text-sm font-semibold">By model (30d)</h2>
      {models.isPending ? <Loading /> : (
        <table className="mt-2 w-full text-sm">
          <thead><tr>
            <th className={th}>Model</th><th className={thr}>Usage events</th><th className={thr}>In</th>
            <th className={thr}>Out</th><th className={thr}>Cache r/w</th><th className={thr}>Cost</th>
          </tr></thead>
          <tbody>
            {(models.data ?? []).map((r) => (
              <tr key={`${r.agent}:${r.model}`}>
                <td className={`${td} font-mono text-xs`}>{r.agent} · {r.model}</td>
                <td className={`${td} text-right`}>{compactNumber(r.calls)}</td>
                <td className={`${td} text-right text-zinc-500`}>{compactNumber(r.input)}</td>
                <td className={`${td} text-right text-zinc-500`}>{compactNumber(r.output)}</td>
                <td className={`${td} text-right text-zinc-500`}>{compactNumber(r.cache_read)} / {compactNumber(r.cache_write)}</td>
                <td className={`${td} text-right font-medium`}>{costLabel(r.cost, r.unpricedEvents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function ProjectsTable({ agent }: { agent: ReefAgent }) {
  const projects = useQuery({ queryKey: ['reef', 'projects', 30, agent], queryFn: () => api.reef.projects(30, agent) });
  return (
    <section>
      <h2 className="text-sm font-semibold">By project (30d)</h2>
      {projects.isPending ? <Loading /> : (
        <table className="mt-2 w-full text-sm">
          <thead><tr>
            <th className={th}>Project</th><th className={thr}>Sessions</th>
            <th className={thr}>Tokens</th><th className={thr}>Cost</th><th className={thr}>Last</th>
          </tr></thead>
          <tbody>
            {(projects.data ?? []).map((r) => (
              <tr key={r.project}>
                <td className={`${td} font-mono text-xs`} title={r.project}>{basename(r.project)}</td>
                <td className={`${td} text-right`}>{r.sessions}</td>
                <td className={`${td} text-right text-zinc-500`}>{compactNumber(r.tokens)}</td>
                <td className={`${td} text-right font-medium`}>{costLabel(r.cost, r.unpricedEvents)}</td>
                <td className={`${td} text-right text-zinc-400`}>{timeAgo(r.last_used)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function SessionsTable({ agent }: { agent: ReefAgent }) {
  const [days, setDays] = useState(7);
  const sessions = useQuery({ queryKey: ['reef', 'sessions', days, agent], queryFn: () => api.reef.sessions(days, agent) });
  return (
    <section>
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-semibold">Session leaderboard</h2>
        {[7, 30, 3650].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`rounded px-1.5 py-0.5 text-xs ${days === d ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800'}`}
          >
            {d === 3650 ? 'all' : `${d}d`}
          </button>
        ))}
      </div>
      {sessions.isPending ? <Loading /> : (
        <table className="mt-2 w-full text-sm">
          <thead><tr>
            <th className={th}>Session</th><th className={th}>Project</th>
            <th className={thr}>Tokens</th><th className={thr}>Cost</th>
            <th className={thr}>🎣</th><th className={thr}>Started</th><th className={thr}>Last</th>
          </tr></thead>
          <tbody>
            {(sessions.data ?? []).map((r: ReefSessionRow) => (
              <tr key={r.session_id}>
                <td className={`${td} max-w-md truncate`} title={r.label}>{r.agent} · {r.label || <span className="text-zinc-400">(untitled)</span>}</td>
                <td className={`${td} font-mono text-xs text-zinc-500`}>{basename(r.project)}</td>
                <td className={`${td} text-right text-zinc-500`}>{compactNumber(r.tokens)}</td>
                <td className={`${td} text-right font-medium`}>{costLabel(r.cost, r.unpricedEvents)}</td>
                <td className={`${td} text-right`}>{r.catches || ''}</td>
                <td className={`${td} text-right text-zinc-400`}>{formatDate(r.started_at)}</td>
                <td className={`${td} text-right text-zinc-400`}>{timeAgo(r.ended_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// --- collection ----------------------------------------------------------------

const RARITY_FILTERS = ['all', 'common', 'uncommon', 'rare', 'epic', 'legendary'] as const;
type RarityFilter = (typeof RARITY_FILTERS)[number];

const todayLocal = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local tz

function Collection({ highlight, held, ladderTokens }: { highlight?: number; held: ReadonlySet<string>; ladderTokens?: number }) {
  const { reefLegends } = useSearch({ strict: false }) as { reefLegends?: 'preview' };
  const [date, setDate] = useState<'all' | string>('all');
  const [rarity, setRarity] = useState<RarityFilter>('all');
  const isToday = date === todayLocal();

  const collection = useQuery({
    queryKey: ['reef', 'collection'],
    queryFn: api.reef.collection,
    enabled: date === 'all',
  });
  const catchLog = useQuery({
    queryKey: ['reef', 'catches', date, rarity],
    queryFn: () => api.reef.catches({ date, rarity: rarity === 'all' ? undefined : rarity }),
    enabled: date !== 'all',
  });
  const rewards = useQuery({ queryKey: ['reef', 'rewards'], queryFn: api.reef.rewards, retry: false });
  // A running release's badges wait for their tank unveil.
  const badges = useMemo(() => new Set(rewards.data ? visibleRewards(rewards.data, held).badges : []), [rewards.data, held]);
  const col = collection.data;
  const undiscovered: Record<string, number> = useMemo(() => {
    const counts: Record<string, number> = { common: 0, uncommon: 0, rare: 0, epic: 0 };
    for (let i = 0; i < SPECIES_COUNT; i++) counts[speciesRarity(i)]!++;
    for (const s of col?.species ?? []) counts[s.rarity]!--;
    return counts;
  }, [col]);
  const speciesShown = useMemo(
    () => (col ? (rarity === 'all' ? col.species : col.species.filter((s) => s.rarity === rarity)) : []),
    [col, rarity],
  );

  const setDateFiltered = (v: string) => {
    uiEvent('reef.collection.date', v);
    setDate(v);
  };
  // Tank click-through (?species=N): scroll the card into view once loaded.
  useEffect(() => {
    if (highlight === undefined || !col) return;
    document.getElementById(`reef-species-${highlight}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlight, col]);

  return (
    <section>
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-sm font-semibold">Collection</h2>
        {date === 'all' && col ? (
          <span className="text-xs text-zinc-400">
            {col.species.length} of {SPECIES_COUNT} species · still lurking:{' '}
            {(['common', 'uncommon', 'rare', 'epic'] as const).map((r) => `${undiscovered[r]} ${r}`).join(', ')}
          </span>
        ) : (
          catchLog.data && (
            <span className="text-xs text-zinc-400">
              🎣 {catchLog.data.count} caught {isToday ? 'today' : `on ${date}`}
            </span>
          )
        )}
        <input
          type="date"
          value={date === 'all' ? '' : date}
          max={todayLocal()}
          onChange={(e) => setDateFiltered(e.target.value || 'all')}
          className={`${inputCls} ml-auto px-2 py-1 text-xs`}
        />
        {date === 'all' ? (
          <button onClick={() => setDateFiltered(todayLocal())} className={chip(false)}>
            Today
          </button>
        ) : (
          <button onClick={() => setDateFiltered('all')} className={chip(false)}>
            All time
          </button>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {RARITY_FILTERS.map((r) => (
          <button
            key={r}
            onClick={() => {
              uiEvent('reef.collection.rarity', r);
              setRarity(r);
            }}
            className={chip(rarity === r)}
          >
            {r}
          </button>
        ))}
      </div>

      {date === 'all' ? (
        !col ? null : (
          <>
            {rarity === 'all' && <LegendaryStrip catches={reefLegends === 'preview' ? previewLegendary() : col.legendary} ladderTokens={ladderTokens} />}
            {speciesShown.length === 0 ? (
              <Empty>
                {rarity === 'all' ? 'Nothing caught yet. Go burn some tokens.' : `No ${rarity} species caught yet.`}
              </Empty>
            ) : (
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {speciesShown.map((s) => {
                  const gold = badges.has(speciesSetOf(s.species) ?? '');
                  return (
                    <div
                      key={s.species}
                      id={`reef-species-${s.species}`}
                      className={`relative rounded-lg border p-2 text-center ${
                        highlight === s.species
                          ? 'border-cyan-500 ring-2 ring-cyan-500/40'
                          : gold
                            ? 'border-amber-400 ring-1 ring-amber-300/50 dark:border-amber-500/70'
                            : 'border-zinc-200 dark:border-zinc-800'
                      }`}
                    >
                      {gold && (
                        <span className="reef-dex-badge absolute right-1.5 top-1.5" title="Gold badge: every variant of this species caught">
                          ★
                        </span>
                      )}
                      <Fish species={s.species} shiny={s.shiny_count > 0} className="mx-auto h-14 w-24 [&>svg]:h-full [&>svg]:w-full" />
                      <div className="mt-1 truncate text-xs font-medium">
                        {s.shiny_count > 0 ? '✨ ' : ''}{s.name}
                      </div>
                      <div className="mt-0.5 flex items-center justify-center gap-1.5 text-[10px] text-zinc-400">
                        <span className={`rounded px-1 font-medium uppercase ${RARITY_PILL[s.rarity]}`}>{s.rarity}</span>
                        ×{s.count} · PB {s.best_size}cm
                      </div>
                      <div className="mt-0.5 truncate text-[10px] text-zinc-400" title={s.first_project}>
                        {s.count > 1 ? 'First caught' : 'Caught'} in {basename(s.first_project)}
                      </div>
                      <div className="text-[10px] text-zinc-400">{formatDateTime(s.first_caught)}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )
      ) : !catchLog.data ? null : catchLog.data.catches.length === 0 ? (
        <Empty>
          Nothing {rarity === 'all' ? '' : `${rarity} `}caught {isToday ? 'today' : 'that day'}.
        </Empty>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {catchLog.data.catches.map((c) => (
            <div key={c.id} className="rounded-lg border border-zinc-200 p-2 text-center dark:border-zinc-800">
              <Fish species={c.species} shiny={c.shiny > 0} className="mx-auto h-14 w-24 [&>svg]:h-full [&>svg]:w-full" />
              <div className="mt-1 truncate text-xs font-medium">
                {c.shiny > 0 ? '✨ ' : ''}
                {c.name}
              </div>
              <div className="mt-0.5 flex items-center justify-center gap-1.5 text-[10px] text-zinc-400">
                <span className={`rounded px-1 font-medium uppercase ${RARITY_PILL[c.rarity]}`}>{c.rarity}</span>
                {c.size}cm
              </div>
              <div className="mt-0.5 truncate text-[10px] text-zinc-400" title={c.project}>
                {c.agent ? `${c.agent === 'codex' ? 'Codex' : 'Claude'} · ` : ''}Caught in {basename(c.project)}
              </div>
              <div className="text-[10px] text-zinc-400">{formatDateTime(c.caught_at)}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// --- helpers -------------------------------------------------------------------

type LegendaryCatch = ReefCollection['legendary'][number];

// Twelve slots in ladder order, each showing only the highest tier reached; an unearned one is a dark silhouette with its token threshold.
function LegendaryStrip({ catches, ladderTokens }: { catches: LegendaryCatch[]; ladderTokens?: number }) {
  const progress = ladderTokens === undefined ? null : legendaryProgress(ladderTokens);
  return (
    <div className="mt-3 rounded-lg border border-orange-200 bg-orange-50 p-3 dark:border-orange-900 dark:bg-orange-950/30">
      <div className="text-[10px] uppercase tracking-wide text-zinc-400">Legendaries · thresholds are tokens since install</div>
      {progress && ladderTokens !== undefined && (
        <div className="mt-2" data-legend-progress>
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span>
              <span className="font-semibold">{compactNumber(ladderTokens)}</span>
              <span className="text-zinc-400"> tokens</span>
            </span>
            <span className="text-zinc-500">
              {progress.next
                ? <>next: {progress.next.shiny ? '✨ ' : ''}{LEGENDARY_DEFS[progress.next.index]!.name} at {compactNumber(progress.next.threshold)}</>
                : 'every legendary caught'}
            </span>
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress.pct)}
            className="mt-1 h-2 overflow-hidden rounded-full bg-orange-200/60 dark:bg-orange-900/50"
          >
            <div className="h-full rounded-full bg-amber-400" style={{ width: `${progress.pct}%` }} />
          </div>
        </div>
      )}
      <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {LEGENDARY_DEFS.map((d, i) => {
          const { shiny, caught, next } = legendarySlot(catches, i);
          return (
            <div key={d.name} data-legend-slot={i} className="rounded-md border border-orange-200/70 p-2 text-center dark:border-orange-900/70">
              <div className="text-xs font-medium">
                {shiny ? '✨ ' : ''}
                {d.name}
              </div>
              <Fish
                species={LEGENDARY_ID_BASE + i}
                shiny={shiny}
                title={caught ? `${d.name}${shiny ? ' (shiny)' : ''}` : `Not caught yet: ${compactNumber(next ?? 0)} tokens since install`}
                className={`mx-auto mt-1 h-12 w-full [&>svg]:h-full [&>svg]:w-full ${caught ? '' : 'opacity-70 brightness-0'} ${shiny ? 'reef-shiny' : ''}`}
              />
              <div className="mt-0.5 text-[10px] text-zinc-400">
                {caught ? formatDateTime(caught.caught_at) : compactNumber(next ?? 0)}
              </div>
              {caught && next !== null && <div className="text-[10px] text-zinc-400">✨ shiny at {compactNumber(next)}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const basename = (p: string) => p.split('/').filter(Boolean).pop() ?? p ?? '?';

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return 'now';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

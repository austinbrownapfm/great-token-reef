import { useQuery } from '@tanstack/react-query';
import { catchesEarned, milestoneAt, nextLegendary } from '@gtr/shared';
import { api, type ReefAgentFilter, type CodexLimits, type ReefSessionRow, type ReefSummary } from '../../lib/api';
import { compactNumber, timeAgo } from '../../lib/format';
import { gaugeColor, officialFresh } from '../../lib/reefQuota';
import { costLabel } from './labels';

export function Vitals({ s, agent }: { s: ReefSummary; agent: ReefAgentFilter }) {
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
          <div className="text-xl font-semibold">{costLabel(s.today.cost, s.today.unpricedEvents)}</div>
          <div className="mt-1 text-xs text-zinc-400">
            {compactNumber(s.today.tokens)} tok · {s.today.catches} 🎣
          </div>
          <div className="mt-1 text-xs text-zinc-400">
            {costLabel(s.week.cost, s.week.unpricedEvents)} · {compactNumber(s.week.tokens)} tok this week
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
          {costLabel(s.burn.costPerHour, s.burn.unpricedEvents)}/hr · 7d avg {compactNumber(s.burn.tokensPerMin7d)}/min
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

/** The 4 most recently active sessions, each with its next-fish rung progress. */
function SessionCards({ agent }: { agent: ReefAgentFilter }) {
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
  const bar = gaugeColor(pct, estimated);
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
        {estimated && budget ? ' · *estimate from your busiest past window. Sync Claude limits for real numbers.' : ''}
      </div>
    </Card>
  );
}

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return 'now';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

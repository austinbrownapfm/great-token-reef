import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { OpenPr } from '@gtr/shared';
import { api, type ReefSummary } from '../lib/api';
import { compactNumber } from '../lib/format';
import { claudeQuota } from '../lib/reefQuota';
import { weatherFor } from '../lib/tankEnv';
import { uiEvent } from '../lib/telemetry';
import { Fish } from './Fish';

// Ambient Reef widget (right end of the nav, every page): most recent catch
// idling, today's API-equivalent spend, and the 5h-window ring gauge.
// SSE ('reef' events on each scan) keeps it fresh; the 60s refetch just
// keeps the countdown honest.

export function ReefWidget() {
  const s = useReefSummary();
  if (!s) return null;
  const quota = claudeQuota(s, Math.floor(Date.now() / 1000));
  const fresh = s.pending > 0 ? s.pending : 0;

  return (
    <Link
      to="/"
      search={fresh ? { agent: 'all', release: 1 } : { agent: 'all' }}
      title={`${fresh ? `${fresh} waiting (fish, visitors, rewards) — click to release them. ` : ''}The Reef — Claude Code + Codex usage. Ring: Claude 5-hour limit only.`}
      className="relative flex items-center gap-2 rounded-full border border-zinc-200 py-0.5 pl-1 pr-2.5 hover:border-cyan-600 dark:border-zinc-800 dark:hover:border-cyan-500"
    >
      {fresh > 0 && (
        <span
          aria-label={`${fresh} waiting to release`}
          className="reef-release-badge absolute -left-1.5 -top-1.5 z-10 min-w-[1.15rem] rounded-full bg-amber-400 px-1 text-center text-[10px] font-bold leading-[1.15rem] text-amber-950 ring-2 ring-white dark:ring-zinc-950"
        >
          {fresh > 99 ? '99+' : fresh}
        </span>
      )}
      {s.rewards.lastCatch ? (
        <Fish
          species={s.rewards.lastCatch.species}
          shiny={s.rewards.lastCatch.shiny === 1}
          className="h-6 w-11 [&>svg]:h-full [&>svg]:w-full"
          title={`${s.rewards.lastCatch.shiny ? '✨ ' : ''}${s.rewards.lastCatch.name}${s.rewards.lastCatch.agent ? ` · ${s.rewards.lastCatch.agent === 'codex' ? 'Codex' : 'Claude'}` : ''}`}
        />
      ) : (
        <span className="px-1">🎣</span>
      )}
      <span className="text-[11px] leading-tight">
        <span className="font-semibold">{spendLabel(s)}</span>
        <br />
        <span className="text-zinc-400">
          {compactNumber(s.today.tokens)} tok
          {quota.resetIn !== null ? ` · Claude resets ${formatShort(quota.resetIn)}` : ''}
        </span>
      </span>
      <QuotaRing pct={quota.pct} className="h-6 w-6" />
    </Link>
  );
}

// Always-on HUD for the fullscreen tank: the same spend + 5h ring as the
// nav widget, sized to read from across the room.
export function QuotaHud({ className }: { className?: string }) {
  const s = useReefSummary();
  if (!s) return null;
  const quota = claudeQuota(s, Math.floor(Date.now() / 1000));
  return (
    <div data-reef-nofeed className={`flex items-center gap-3 rounded-full bg-black/35 py-1.5 pl-2 pr-4 text-white backdrop-blur-sm ${className ?? ''}`}>
      <QuotaRing
        pct={quota.pct}
        className={`h-10 w-10 ${weatherFor(quota.pct) >= 5 ? 'reef-storm-pulse' : ''}`}
        track="stroke-white/20"
      />
      <span className="text-sm leading-tight">
        <span className="font-semibold">{spendLabel(s)}</span>
        <br />
        <span className="text-white/70">
          {compactNumber(s.today.tokens)} tok
          {quota.resetIn !== null ? ` · 5h window resets ${formatShort(quota.resetIn)}` : ''}
        </span>
      </span>
    </div>
  );
}

const HUD_PR_STATE: Record<OpenPr['state'], { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'bg-white/15 text-white/70' },
  ready: { label: 'Ready', cls: 'bg-blue-400/25 text-blue-200' },
  approved: { label: 'Approved', cls: 'bg-green-400/25 text-green-200' },
  changes_requested: { label: 'Changes', cls: 'bg-red-400/25 text-red-200' },
};

// Fullscreen bottom row beside QuotaHud: up to 5 open PRs; the 'reef' SSE event keeps it fresh.
export function PrHud({ className }: { className?: string }) {
  const open = useQuery({ queryKey: ['reef', 'prs'], queryFn: api.reef.prs, retry: false });
  const prs = (open.data ?? []).slice(0, 5);
  if (prs.length === 0) return null;
  return (
    <div className={`grid grid-cols-5 gap-3 ${className ?? ''}`}>
      {prs.map((pr) => {
        const state = HUD_PR_STATE[pr.state];
        return (
          <a
            key={pr.id}
            href={pr.url}
            target="_blank"
            rel="noreferrer"
            onClick={() => uiEvent('reef.open_pr', pr.id)}
            className="min-w-0 rounded-lg bg-black/35 px-3 py-2 text-white backdrop-blur-sm hover:bg-black/50"
          >
            <div className="truncate text-xs font-medium" title={pr.title}>{pr.title}</div>
            <div className="mt-1.5 flex items-center gap-1.5 text-xs text-white/70">
              <span
                className={`h-2 w-2 flex-none rounded-full ${pr.needsMe ? 'bg-red-500' : 'bg-white/30'}`}
                title={pr.needsMe ? 'Needs you' : undefined}
              />
              <span className="min-w-0 flex-1 truncate">{pr.repo} #{pr.number}</span>
              {pr.botFindings > 0 && <span title="Bot findings">🤖 {pr.botFindings}</span>}
              <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] ${state.cls}`}>{state.label}</span>
            </div>
          </a>
        );
      })}
    </div>
  );
}

export function useReefSummary(): ReefSummary | undefined {
  return useQuery({
    queryKey: ['reef', 'summary', 'all'],
    queryFn: () => api.reef.summary('all'),
    refetchInterval: 60_000,
    retry: false,
  }).data;
}

function spendLabel(s: ReefSummary): string {
  const partial = (s.today.unpricedEvents ?? s.unpricedEvents) > 0 ? ' known subtotal' : '';
  return `$${s.today.cost.toFixed(2)}${partial} today`;
}

function QuotaRing({ pct, className, track }: { pct: number; className: string; track?: string }) {
  const ring = pct >= 0.9 ? 'stroke-red-500' : pct >= 0.75 ? 'stroke-amber-500' : 'stroke-cyan-600';
  const C = 2 * Math.PI * 14;
  return (
    <svg viewBox="0 0 36 36" className={className} role="img" aria-label="Claude 5-hour limit">
      <title>Claude 5-hour limit</title>
      <circle cx="18" cy="18" r="14" fill="none" strokeWidth="5" className={track ?? 'stroke-zinc-200 dark:stroke-zinc-800'} />
      <circle
        cx="18" cy="18" r="14" fill="none" strokeWidth="5" strokeLinecap="round"
        className={ring}
        strokeDasharray={`${pct * C} ${C}`}
        transform="rotate(-90 18 18)"
      />
    </svg>
  );
}

function formatShort(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

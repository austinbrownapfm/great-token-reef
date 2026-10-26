import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ReefSummary } from '../../lib/api';
import { formatDate, timeAgo } from '../../lib/format';
import { uiEvent } from '../../lib/telemetry';

const TRACKED = {
  claude: { label: 'Claude Code', queryFn: api.reef.claudeStatus },
  codex: { label: 'Codex', queryFn: api.reef.codexStatus },
} as const;

export function AgentTracking({ agent }: { agent: keyof typeof TRACKED }) {
  const { label, queryFn } = TRACKED[agent];
  const status = useQuery({
    queryKey: ['reef', `${agent}-status`],
    queryFn,
    refetchInterval: 60_000,
  });
  if (status.isPending) return <div className="mt-2 text-xs text-zinc-400">{label}: checking indexing status…</div>;
  if (!status.data) return <div className="mt-2 text-xs text-amber-600">{label} indexing status unavailable · {status.error?.message}</div>;
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
      {label}: {state}{s.lastScanAt ? ` · last scan ${timeAgo(s.lastScanAt)}` : ''}
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

export function Header({ summary, codexShown }: { summary?: ReefSummary; codexShown: boolean }) {
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
        {codexShown ? 'Claude Code + Codex usage' : 'Claude Code usage'} · API-equivalent cost
        {summary?.lifetime.since ? ` · since ${formatDate(summary.lifetime.since)}` : ''}
      </span>
      <span className="ml-auto flex items-center gap-2">
        {scan.isError && <span className="text-xs text-red-500">{(scan.error as Error).message}</span>}
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

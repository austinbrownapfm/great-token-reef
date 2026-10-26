import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type ReefAgentFilter, type ReefSessionRow } from '../../lib/api';
import { compactNumber, formatDate, timeAgo } from '../../lib/format';
import { Loading } from '../../components/ui';
import { basename, costLabel } from './labels';

const th = 'py-1 pr-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-400';
const thr = 'py-1 pr-3 text-right text-xs font-semibold uppercase tracking-wide text-zinc-400';
const td = 'border-t border-zinc-200 py-1.5 pr-3 dark:border-zinc-800';

export function ModelsTable({ agent }: { agent: ReefAgentFilter }) {
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

export function ProjectsTable({ agent }: { agent: ReefAgentFilter }) {
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

export function SessionsTable({ agent }: { agent: ReefAgentFilter }) {
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

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type ReefAgentFilter } from '../../lib/api';
import { compactNumber } from '../../lib/format';
import { Empty, Loading } from '../../components/ui';
import { costLabel } from './labels';

const MODEL_COLORS = ['#0e7490', '#7c3aed', '#ca8a04', '#dc2626', '#059669', '#6b7280'];

export function TrendChart({ agent }: { agent: ReefAgentFilter }) {
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

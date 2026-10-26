import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { SPECIES_COUNT, LEGENDARY_DEFS, LEGENDARY_ID_BASE, RarityValue, speciesRarity } from '@gtr/shared';
import { api, type ReefCollection } from '../../lib/api';
import { compactNumber, formatDateTime } from '../../lib/format';
import { legendaryProgress, legendarySlot, previewLegendary } from '../../lib/legendaryRows';
import { RARITY_PILL } from '../../lib/rarity';
import { speciesSetOf, visibleRewards } from '../../lib/tankDecor';
import { uiEvent } from '../../lib/telemetry';
import { Fish } from '../../components/Fish';
import { Empty, chip, inputCls } from '../../components/ui';
import { basename } from './labels';

const RARITY_FILTERS = ['all', ...RarityValue.options] as const;
type RarityFilter = (typeof RARITY_FILTERS)[number];

const todayLocal = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local tz

export function Collection({ highlight, held, ladderTokens }: { highlight?: number; held: ReadonlySet<string>; ladderTokens?: number }) {
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
                {rarity === 'all' ? 'No fish yet. Fish come from sessions you run after installing The Great Token Reef. A session lands its first fish at 2M tokens. Your earlier history still counts in the stats above.' : `No ${rarity} species caught yet.`}
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

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { FISH_SETS } from '@gtr/shared';
import { api, type ReefFishPicks, type ReefRewards, type ReefSpeciesRow } from '../lib/api';
import { allSpecies } from '../lib/legendaryRows';
import { RARITIES, RARITY_PILL } from '../lib/rarity';
import { addFish, dropIndex, moveItem, removeFish, searchFish, startingPick } from '../lib/reefFishPicker';
import { inventoryCounts, releasedInventory, toGoLabel } from '../lib/reefInventory';
import { FISH_CAPS, type FishView } from '../lib/tankPicks';
import { maskCollection } from '../lib/tankRelease';
import { uiEvent } from '../lib/telemetry';
import { Fish } from './Fish';
import { BackdropThumb, DecorSvg } from './TankDecor';
import { Loading } from './ui';

// Inventory tab on the Reef page (living-tank spec §4, option C): earned decor, backdrop picker, locked sets.

const SET_LABEL = new Map(FISH_SETS.map((s) => [s.id, s.label]));

/** `held`: reward keys a running tank release still holds for their unveil (see visibleRewards). */
export function ReefInventory({ held }: { held: ReadonlySet<string> }) {
  useEffect(() => uiEvent('reef.inventory.view'), []);
  const qc = useQueryClient();
  const navigate = useNavigate({ from: '/' });
  const rewards = useQuery({ queryKey: ['reef', 'rewards'], queryFn: api.reef.rewards, retry: false });
  const collection = useQuery({ queryKey: ['reef', 'collection'], queryFn: api.reef.collection });
  const pending = useQuery({ queryKey: ['reef', 'pending'], queryFn: api.reef.pending, retry: false });
  // Released catches only, so a fish still waiting in the net can't be picked either.
  const released = useMemo(
    () => (collection.data && pending.data ? maskCollection(collection.data.species, pending.data.all) : null),
    [collection.data, pending.data],
  );
  // The Fish picker also lists legendaries, which the server keeps out of collection.species.
  const pickable = useMemo(() => (collection.data ? allSpecies(collection.data, false) : null), [collection.data]);
  const releasedPickable = useMemo(
    () => (pickable && pending.data ? maskCollection(pickable, pending.data.all) : null),
    [pickable, pending.data],
  );
  // A running release's set rewards wait for their tank unveil here too.
  const model = useMemo(
    () => (rewards.data && collection.data && released ? releasedInventory(rewards.data, held, collection.data.species, released) : null),
    [rewards.data, held, collection.data, released],
  );

  const saved = (r: ReefRewards) => qc.setQueryData(['reef', 'rewards'], r);
  const toggle = useMutation({
    mutationFn: (d: { item: string; shown: boolean }) => api.reef.setDecor(d.item, { shown: d.shown }),
    onSuccess: (r, d) => {
      uiEvent('reef.inventory.toggle', `${d.item}:${d.shown ? 'shown' : 'hidden'}`);
      saved(r);
    },
    onError: (err, d) => console.warn('[reef] decor toggle failed', d.item, err),
  });
  const backdrop = useMutation({
    mutationFn: api.reef.setBackdrop,
    onSuccess: (r, item) => {
      uiEvent('reef.inventory.backdrop', item);
      saved(r);
    },
    onError: (err, item) => console.warn('[reef] backdrop change failed', item, err),
  });
  const arrange = () => void navigate({ to: '/', search: (prev) => ({ ...prev, arrange: 1 }) });

  if (rewards.isError) return <div className="text-sm text-red-500">Inventory unavailable · {rewards.error.message}</div>;
  // Without pending, released catches cannot be told from new ones; say so rather than show zero progress.
  if (pending.isError) return <div className="text-sm text-red-500">Inventory progress unavailable · {pending.error.message}</div>;
  if (!model || !released || !pickable || !releasedPickable) return <Loading />;
  const error = toggle.error ?? backdrop.error;
  const badgeNames = model.badges.earned.map((id) => SET_LABEL.get(id) ?? id);
  const counts = inventoryCounts(model);

  return (
    <section>
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-sm font-semibold">Inventory</h2>
        <span className="text-xs text-zinc-400">
          {counts.decor} of {counts.decorTotal} decor pieces ·{' '}
          {counts.backdrops} of {counts.backdropTotal} backdrops
        </span>
        {error && <span className="text-xs text-red-500">{error.message}</span>}
        <button
          type="button"
          onClick={arrange}
          disabled={model.decor.length === 0}
          className="ml-auto rounded border border-zinc-300 px-2 py-0.5 text-xs text-zinc-600 hover:border-cyan-600 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300"
          title="Open the tank fullscreen and drag pieces along the sand"
        >
          ✎ Arrange in tank
        </button>
      </div>

      <FishSection released={releasedPickable} all={pickable} />

      <h3 className="mt-5 text-[11px] font-medium uppercase tracking-wide text-zinc-400">Backdrop</h3>
      <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {model.backdrops.map((b) => (
          <button
            key={b.item}
            type="button"
            disabled={!b.earned || b.active || backdrop.isPending}
            aria-pressed={b.active}
            onClick={() => backdrop.mutate(b.item)}
            className={`group/bd rounded-lg border p-1.5 text-left text-xs ${
              b.active ? 'border-cyan-600 ring-2 ring-cyan-600/30' : 'border-zinc-200 dark:border-zinc-800'
            } ${b.earned && !b.active ? 'hover:border-cyan-600' : ''} disabled:cursor-default`}
          >
            <BackdropThumb item={b.item} className={`h-14 w-full ${b.earned ? '' : 'opacity-40 grayscale'}`} />
            <div className="mt-1 flex items-baseline gap-1">
              <span className="font-medium">{b.label}</span>
              {b.active && <span className="text-cyan-600">✓</span>}
              {b.locked && <span className="ml-auto text-[10px] text-zinc-400">🔒 {toGoLabel(b.locked)}</span>}
            </div>
            {b.locked && <div className="text-[10px] text-zinc-400">{b.locked.label} set · {b.locked.have}/{b.locked.total}</div>}
          </button>
        ))}
      </div>

      <h3 className="mt-5 text-[11px] font-medium uppercase tracking-wide text-zinc-400">Decor</h3>
      <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {model.decor.map((d) => (
          <div
            key={d.item}
            className={`rounded-lg border border-zinc-200 p-2 text-center text-xs dark:border-zinc-800 ${d.shown ? '' : 'opacity-50'}`}
          >
            <DecorThumb item={d.item} />
            <div className="mt-1 truncate font-medium">{d.label}</div>
            <button
              type="button"
              aria-pressed={d.shown}
              disabled={toggle.isPending}
              onClick={() => toggle.mutate({ item: d.item, shown: !d.shown })}
              className={`mt-1 rounded-full px-2 py-px text-[11px] ${
                d.shown
                  ? 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-300'
                  : 'bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
              }`}
            >
              {d.shown ? 'Shown' : 'Hidden'}
            </button>
          </div>
        ))}
        {model.locked.map((l) => (
          <div
            key={l.setId}
            className="rounded-lg border border-dashed border-zinc-300 p-2 text-center text-xs text-zinc-400 dark:border-zinc-700"
            title={`Catch every ${l.label} variant to earn this piece`}
          >
            <DecorThumb item={l.item ?? ''} locked />
            <div className="mt-1 truncate">{l.label}</div>
            <div className="mt-1 text-[11px]">{toGoLabel(l)}</div>
          </div>
        ))}
      </div>

      <h3 className="mt-5 text-[11px] font-medium uppercase tracking-wide text-zinc-400">Species badges</h3>
      <div className="mt-1.5 rounded-lg border border-zinc-200 p-2 text-xs dark:border-zinc-800">
        <span className="font-medium text-amber-600">★ {model.badges.earned.length} of {model.badges.total}</span>
        {badgeNames.length > 0 && <span className="text-zinc-500"> · {badgeNames.join(', ')}</span>}
        {model.badges.next.length > 0 && (
          <div className="mt-1 text-zinc-400">
            Closest: {model.badges.next.map((n) => `${n.label} ${toGoLabel(n)}`).join(' · ')}
          </div>
        )}
      </div>
    </section>
  );
}

// Locked pieces draw as a dark silhouette of their art.
function DecorThumb({ item, locked = false }: { item: string; locked?: boolean }) {
  return (
    <div className="flex h-14 items-end justify-center rounded-md bg-gradient-to-b from-[#0e7490]/15 to-[#a8874e]/30 px-1 pb-1">
      <DecorSvg item={item} className={`h-12 w-full ${locked ? 'opacity-30 brightness-0 dark:invert' : ''}`} />
    </div>
  );
}

const FISH_KEY = ['reef', 'fish'] as const;
const VIEW_LABEL: Record<FishView, string> = { strip: 'Strip', full: 'Fullscreen' };

type FishAction = 'add' | 'remove' | 'move';
interface FishChange {
  view: FishView;
  species: number[];
  action: FishAction;
}

// Fish section (fish-picker spec, mockup option B): the strip and fullscreen picks side by side.
function FishSection({ released, all }: { released: ReefSpeciesRow[]; all: ReefSpeciesRow[] }) {
  const qc = useQueryClient();
  const fish = useQuery({ queryKey: FISH_KEY, queryFn: api.reef.fish, retry: false });
  const save = useMutation({
    mutationFn: (c: FishChange) => api.reef.setFish(c.view, c.species),
    onMutate: async (c) => {
      await qc.cancelQueries({ queryKey: FISH_KEY });
      const prev = qc.getQueryData<ReefFishPicks>(FISH_KEY);
      if (prev) qc.setQueryData<ReefFishPicks>(FISH_KEY, { ...prev, [c.view]: c.species });
      return { prev };
    },
    onSuccess: (fresh, c) => {
      console.log(`[reef] ${c.view} fish pick saved (${c.action}): ${c.species.join(',')}`);
      uiEvent(`reef.inventory.fish.${c.action}`, c.view);
      qc.setQueryData(FISH_KEY, fresh);
    },
    onError: (err, c, ctx) => {
      console.error(`[reef] ${c.view} fish pick save failed (${c.action}); reverting`, err);
      if (ctx?.prev) qc.setQueryData(FISH_KEY, ctx.prev);
    },
  });
  const rows = useMemo(() => new Map([...all, ...released].map((r) => [r.species, r])), [all, released]);

  let body: React.ReactNode;
  if (fish.isError) body = <div className="mt-1.5 text-xs text-red-500">Fish picks unavailable · {fish.error.message}</div>;
  else if (!fish.data) body = <div className="mt-1.5 animate-pulse text-xs text-zinc-400">Loading fish…</div>;
  else {
    const picks = fish.data;
    body = (
      <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
        {(['strip', 'full'] as const).map((view) => (
          <FishList
            key={view}
            view={view}
            pick={picks[view]}
            released={released}
            rows={rows}
            busy={save.isPending}
            onChange={(species, action) => save.mutate({ view, species, action })}
          />
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="mt-4 flex flex-wrap items-baseline gap-2">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">Fish</h3>
        {save.isPending && <span className="text-[11px] text-zinc-400">Saving…</span>}
        {save.error && <span className="text-xs text-red-500">Couldn't save the fish pick · {save.error.message}</span>}
      </div>
      {body}
    </>
  );
}

function FishList({ view, pick, released, rows, busy, onChange }: {
  view: FishView;
  pick: number[] | null;
  released: ReefSpeciesRow[];
  rows: Map<number, ReefSpeciesRow>;
  busy: boolean;
  onChange: (species: number[], action: FishAction) => void;
}) {
  const cap = FISH_CAPS[view];
  // A null pick lists what the tank will open with, so the counter matches what an add starts from.
  const list = useMemo(() => startingPick(pick, released, view), [pick, released, view]);
  const inList = useMemo(() => new Set(list), [list]);
  const [adding, setAdding] = useState(false);
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const rowRefs = useRef<(HTMLLIElement | null)[]>([]);
  // Edits wait for the previous save so an optimistic revert can never undo a later change; buttons show it via aria-disabled.
  const change = (species: number[], action: FishAction) => {
    if (!busy && species !== list) onChange(species, action);
  };
  const move = (from: number, to: number) => change(moveItem(list, from, to), 'move');
  const add = (id: number) => change(addFish(list, id, cap), 'add');

  // Target index in the list without the dragged row: how many other rows sit above the pointer.
  const indexAt = (y: number, from: number) =>
    dropIndex(y, rowRefs.current.map((el) => el?.getBoundingClientRect() ?? null), from, list.length);

  return (
    <div className="rounded-lg border border-zinc-200 p-2 text-xs dark:border-zinc-800">
      <h4 className="font-medium text-cyan-700 dark:text-cyan-400">
        {VIEW_LABEL[view]} · {list.length} of {cap}
      </h4>
      {pick === null && <div className="mt-1 italic text-zinc-400">Not set yet — opens with today's fish</div>}
      {pick !== null && list.length === 0 && <div className="mt-1 text-zinc-400">No fish picked — the tank stays empty.</div>}
      <ul className={`mt-1 ${busy ? 'opacity-70' : ''}`}>
        {list.map((id, i) => {
          const row = rows.get(id);
          const name = row?.name ?? `#${id}`;
          const line = drag && drag.from !== i && drag.over === i
            ? drag.over < drag.from ? 'shadow-[inset_0_2px_0_#0891b2]' : 'shadow-[inset_0_-2px_0_#0891b2]'
            : '';
          return (
            <li
              key={id}
              ref={(el) => { rowRefs.current[i] = el; }}
              className={`flex items-center gap-1.5 border-b border-zinc-100 py-0.5 last:border-b-0 dark:border-zinc-800/60 ${line} ${
                drag?.from === i ? 'bg-cyan-50 dark:bg-cyan-950/40' : ''
              }`}
            >
              <span
                className="cursor-grab touch-none select-none px-0.5 text-zinc-400 active:cursor-grabbing"
                title="Drag to reorder"
                aria-hidden
                onPointerDown={(e) => {
                  if (busy || e.button !== 0) return;
                  e.preventDefault();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setDrag({ from: i, over: i });
                }}
                onPointerMove={(e) => {
                  if (!drag) return;
                  const over = indexAt(e.clientY, drag.from);
                  if (over !== drag.over) setDrag({ ...drag, over });
                }}
                onPointerUp={() => {
                  if (drag && drag.over !== drag.from) move(drag.from, drag.over);
                  setDrag(null);
                }}
                onPointerCancel={() => setDrag(null)}
              >
                ⠿
              </span>
              <Fish species={id} shiny={(row?.shiny_count ?? 0) > 0} className="h-5 w-8 shrink-0 [&>svg]:h-full [&>svg]:w-full" />
              <span className="min-w-0 flex-1 truncate">{name}</span>
              {row && <span className={`rounded px-1 text-[10px] font-medium uppercase ${RARITY_PILL[row.rarity]}`}>{row.rarity}</span>}
              <RowButton label={`Move ${name} up`} hidden={i === 0} busy={busy} onClick={() => move(i, i - 1)}>▲</RowButton>
              <RowButton label={`Move ${name} down`} hidden={i === list.length - 1} busy={busy} onClick={() => move(i, i + 1)}>▼</RowButton>
              <RowButton label={`Remove ${name} from the ${VIEW_LABEL[view].toLowerCase()}`} busy={busy} onClick={() => change(removeFish(list, id), 'remove')}>✕</RowButton>
            </li>
          );
        })}
      </ul>
      {adding ? (
        <AddFish
          released={released}
          exclude={inList}
          full={list.length >= cap}
          busy={busy}
          onAdd={add}
          onClose={() => setAdding(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={list.length >= cap}
          className="mt-1 text-zinc-500 hover:text-cyan-700 disabled:opacity-40 dark:text-zinc-400 dark:hover:text-cyan-400"
          title={list.length >= cap ? `The ${VIEW_LABEL[view].toLowerCase()} holds at most ${cap} fish` : undefined}
        >
          ＋ Add fish
        </button>
      )}
    </div>
  );
}

// aria-disabled rather than disabled, so keyboard focus stays on the button while a save runs.
function RowButton({ label, hidden = false, busy, onClick, children }: {
  label: string;
  hidden?: boolean;
  busy: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-disabled={busy || undefined}
      onClick={() => !busy && onClick()}
      className={`rounded px-1 text-[10px] text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 aria-disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 ${
        hidden ? 'invisible' : ''
      }`}
    >
      {children}
    </button>
  );
}

function AddFish({ released, exclude, full, busy, onAdd, onClose }: {
  released: ReefSpeciesRow[];
  exclude: Set<number>;
  full: boolean;
  busy: boolean;
  onAdd: (id: number) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [rarity, setRarity] = useState<string | null>(null);
  const results = useMemo(() => searchFish(released, query, rarity, exclude), [released, query, rarity, exclude]);
  return (
    <div className="mt-1.5 rounded-md border border-zinc-200 p-1.5 dark:border-zinc-800" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="flex gap-1">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search caught fish"
          aria-label="Search caught fish"
          className="min-w-0 flex-1 rounded border border-zinc-300 bg-transparent px-1.5 py-0.5 dark:border-zinc-700"
        />
        <select
          value={rarity ?? ''}
          onChange={(e) => setRarity(e.target.value || null)}
          aria-label="Rarity"
          className="rounded border border-zinc-300 bg-transparent px-1 py-0.5 dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="">All</option>
          {RARITIES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <button type="button" onClick={onClose} aria-label="Close search" className="px-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
          ✕
        </button>
      </div>
      {full && <div className="mt-1 text-zinc-400">Full — remove a fish to add another.</div>}
      <ul className="mt-1 max-h-56 overflow-y-auto">
        {results.map((r) => (
          <li key={r.species}>
            <button
              type="button"
              disabled={full || busy}
              onClick={() => onAdd(r.species)}
              className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-cyan-50 disabled:opacity-40 dark:hover:bg-cyan-950/40"
            >
              <Fish species={r.species} shiny={r.shiny_count > 0} className="h-5 w-8 shrink-0 [&>svg]:h-full [&>svg]:w-full" />
              <span className="min-w-0 flex-1 truncate">{r.name}</span>
              <span className={`rounded px-1 text-[10px] font-medium uppercase ${RARITY_PILL[r.rarity]}`}>{r.rarity}</span>
            </button>
          </li>
        ))}
        {results.length === 0 && <li className="px-1 py-0.5 text-zinc-400">No released fish match.</li>}
      </ul>
    </div>
  );
}

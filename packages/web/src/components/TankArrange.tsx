import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { api, type ReefRewards } from '../lib/api';
import { arrangeChanges, arrangeExitDetail, arrangeStage, arrowNudge, clampFrac, pinDecor, trayDrop, type ArrangeStage } from '../lib/reefInventory';
import { DECOR_META, type DecorPlacement } from '../lib/tankDecor';
import { uiEvent } from '../lib/telemetry';
import { DecorSvg } from './TankDecor';
import { TankNoticeChip, type TankNotice } from './TankNotices';

// Arrange mode in the fullscreen tank (living-tank spec §4): drag decor along the sand, hide into a tray, Done saves.

type DecorRow = ReefRewards['decor'][number];
type Rocks = { x: number; w: number }[];

/** Pixels a press must travel before it counts as a drag rather than a click. */
const DRAG_SLOP = 6;

/**
 * Arrange mode, driven by `?arrange=1`: it lives in fullscreen (asked for on entry, theater if refused), and
 * leaving fullscreen cancels it. `draft` is the working copy, null when not arranging.
 */
export function useTankArrange({ active, earned, width, rocks, fullscreen, toggle }: {
  active: boolean; earned: DecorRow[]; width: number; rocks: Rocks; fullscreen: boolean; toggle: () => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate({ from: '/' });
  const enter = useCallback(() => void navigate({ to: '/', search: (prev) => ({ ...prev, arrange: 1 }) }), [navigate]);
  const exit = useCallback(
    () => void navigate({ to: '/', search: (prev) => ({ ...prev, arrange: undefined }), replace: true }),
    [navigate],
  );
  // Set by our own exits, which log their own detail; an exit without it came from the browser's Back.
  const leaving = useRef(false);
  const cancel = useCallback(() => {
    uiEvent('reef.tank.arrange', 'cancel');
    leaving.current = true;
    exit();
  }, [exit]);
  const stage = useRef<ArrangeStage>(null);
  useEffect(() => {
    if (!active) {
      const detail = arrangeExitDetail(stage.current !== null, leaving.current);
      if (detail) uiEvent('reef.tank.arrange', detail);
      stage.current = null;
      leaving.current = false;
      return;
    }
    if (stage.current === null) uiEvent('reef.tank.arrange', 'open');
    const next = arrangeStage(stage.current, fullscreen);
    stage.current = next.stage;
    if (next.action === 'cancel') cancel();
    else if (next.action === 'toggle') toggle();
  }, [active, fullscreen, toggle, cancel]);

  const [session, setSession] = useState<{ saved: DecorRow[]; draft: DecorRow[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Pin at the current size (the tank may still be growing into fullscreen when arranging starts).
  const size = useRef({ width, rocks });
  size.current = { width, rocks };
  const pin = useCallback((d: DecorRow[]) => (size.current.width > 0 ? pinDecor(d, size.current.width, size.current.rocks) : d), []);
  // Every edit pins first, so hiding or moving one piece never shifts an auto-placed one.
  const edit = useCallback((fn: (cur: DecorRow[]) => DecorRow[]) => {
    setSession((s) => s && { ...s, draft: pin(fn(pin(s.draft))) });
  }, [pin]);

  // Snapshot once per session; a later rewards refetch must not wipe the arrangement in progress.
  if (active && !session) setSession({ saved: earned, draft: earned });
  if (!active && session) {
    setSession(null);
    setError(null);
  }

  const move = useCallback((item: string, xFrac: number) => {
    edit((cur) => cur.map((d) => (d.item === item ? { ...d, xFrac } : d)));
  }, [edit]);
  const hide = useCallback((item: string) => {
    edit((cur) => cur.map((d) => (d.item === item ? { ...d, shown: false } : d)));
  }, [edit]);
  // No drop spot: back where it last stood, else the first free spot.
  const show = useCallback((item: string, xFrac: number | null) => {
    edit((cur) => cur.map((d) => (d.item === item ? { ...d, shown: true, xFrac: xFrac ?? d.xFrac } : d)));
  }, [edit]);

  const done = useCallback(async () => {
    if (!session) return;
    // Also writes the spot of every shown piece that had none, so later hides never move it.
    const changes = arrangeChanges(session.saved, pin(session.draft));
    setSaving(true);
    setError(null);
    try {
      let last: ReefRewards | null = null;
      for (const c of changes) last = await api.reef.setDecor(c.item, c.patch);
      // Seed the cache with the final state so the tank never flashes the old layout before the refetch.
      if (last) qc.setQueryData(['reef', 'rewards'], last);
      console.log(`[reef] arrange saved ${changes.length} decor changes`);
      uiEvent('reef.tank.arrange', `save:${changes.length}`);
      leaving.current = true;
      exit();
    } catch (err) {
      console.warn('[reef] arrange save failed', err);
      setError(err instanceof Error ? err.message : String(err));
      void qc.invalidateQueries({ queryKey: ['reef', 'rewards'] });
    } finally {
      setSaving(false);
    }
  }, [session, pin, qc, exit]);

  return { draft: session?.draft ?? null, saving, error, move, hide, show, done, enter, cancel };
}

export function TankArrange({
  pieces, draft, width, fullscreen, saving, error, onMove, onHide, onShow, onDone, onCancel, notices,
}: {
  pieces: DecorPlacement[];
  draft: DecorRow[];
  width: number;
  fullscreen: boolean;
  saving: boolean;
  error: string | null;
  onMove: (item: string, xFrac: number) => void;
  onHide: (item: string) => void;
  onShow: (item: string, xFrac: number | null) => void;
  onDone: () => void;
  onCancel: () => void;
  /** the tank's failure chips, shown in the toolbar while it covers their usual spot */
  notices: TankNotice[];
}) {
  const hidden = draft.filter((d) => !d.shown);
  return (
    <>
      <div
        data-reef-nofeed
        className="absolute left-3 top-3 z-40 flex items-center gap-2 rounded-lg bg-black/60 px-3 py-1.5 text-xs text-white shadow-lg backdrop-blur-sm"
      >
        <span>✎ Arranging · drag pieces along the sand · 👁 hides</span>
        {error && <span className="text-red-300">{error}</span>}
        {notices.map((n) => <TankNoticeChip key={n.key} notice={n} />)}
        <button type="button" onClick={onCancel} disabled={saving} className="rounded px-2 py-0.5 text-white/80 hover:bg-white/15">
          Cancel
        </button>
        <button
          type="button"
          onClick={onDone}
          disabled={saving}
          className="rounded bg-cyan-600 px-2 py-0.5 font-medium hover:bg-cyan-500 disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Done'}
        </button>
      </div>
      {pieces.map((p) => (
        <Handle key={p.item} piece={p} width={width} onMove={onMove} onHide={onHide} />
      ))}
      <Tray hidden={hidden} width={width} fullscreen={fullscreen} onShow={onShow} />
    </>
  );
}

function Handle({ piece, width, onMove, onHide }: {
  piece: DecorPlacement; width: number; onMove: (item: string, xFrac: number) => void; onHide: (item: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; art: HTMLElement | null; x: number } | null>(null);
  const label = DECOR_META[piece.item]?.label ?? piece.item;
  // Pointer moves write styles directly; React hears only the drop.
  const place = (x: number) => {
    const left = `${x - piece.w / 2}px`;
    if (ref.current) ref.current.style.left = left;
    if (drag.current?.art) drag.current.art.style.left = left;
  };
  return (
    <div
      ref={ref}
      data-reef-nofeed
      role="slider"
      tabIndex={0}
      aria-label={`${label} position`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round((piece.x / Math.max(1, width)) * 100)}
      className="absolute z-30 cursor-grab touch-none rounded-md outline-2 outline-offset-2 outline-amber-200 outline-dashed hover:bg-white/10 focus-visible:bg-white/15 active:cursor-grabbing"
      style={{ left: piece.left, top: piece.top, width: piece.w, height: piece.h }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const art = e.currentTarget.closest('.reef-tank')?.querySelector<HTMLElement>(`[data-reef-decor="${piece.item}"]`) ?? null;
        drag.current = { startX: e.clientX, art, x: piece.x };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        d.x = clampFrac(piece.x + e.clientX - d.startX, piece.w, width) * width;
        place(d.x);
      }}
      onPointerUp={() => {
        const d = drag.current;
        if (!d) return;
        if (Math.abs(d.x - piece.x) >= 1) onMove(piece.item, d.x / width);
        else place(piece.x);
        drag.current = null;
      }}
      onPointerCancel={() => {
        place(piece.x);
        drag.current = null;
      }}
      onKeyDown={(e) => {
        const xFrac = arrowNudge(e.key, piece.x, piece.w, width);
        if (xFrac === null) return;
        e.preventDefault();
        onMove(piece.item, xFrac);
      }}
    >
      <button
        type="button"
        onClick={() => onHide(piece.item)}
        aria-label={`Hide ${label}`}
        title={`Hide ${label}`}
        className="absolute -right-3 -top-3 rounded-full bg-slate-900/80 px-1.5 py-0.5 text-[11px] leading-none text-white hover:bg-slate-900"
      >
        👁
      </button>
    </div>
  );
}

function Tray({ hidden, width, fullscreen, onShow }: {
  hidden: DecorRow[]; width: number; fullscreen: boolean; onShow: (item: string, xFrac: number | null) => void;
}) {
  const trayRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const [ghost, setGhost] = useState<string | null>(null);
  const press = useRef<{ item: string; x: number; y: number; dragging: boolean } | null>(null);
  const suppressClick = useRef(false);
  const follow = (x: number, y: number) => {
    const g = ghostRef.current;
    if (g) g.style.transform = `translate(${x - 32}px, ${y - 32}px)`;
  };
  useEffect(() => {
    if (!ghost || !press.current) return;
    follow(press.current.x, press.current.y);
  }, [ghost]);
  return (
    <>
      <div
        ref={trayRef}
        data-reef-nofeed
        className="absolute left-3 top-14 z-40 flex max-w-[calc(100%-1.5rem)] items-center gap-2 overflow-x-auto rounded-lg bg-slate-900/85 px-3 py-2 text-xs text-slate-200 shadow-lg"
      >
        <span className="flex-none">Hidden:</span>
        {hidden.length === 0 && <span className="text-slate-400">nothing hidden · 👁 on a piece puts it here</span>}
        {hidden.map((d) => {
          const label = DECOR_META[d.item]?.label ?? d.item;
          return (
            <button
              key={d.item}
              type="button"
              title={`Drag ${label} into the tank, or click to put it back`}
              aria-label={`Show ${label}`}
              className="flex h-10 w-16 flex-none touch-none items-end justify-center rounded-md border border-dashed border-slate-500 bg-slate-800 p-1 hover:border-cyan-400"
              onPointerDown={(e) => {
                // A drag that showed a piece unmounts its button before any click, so the flag resets here.
                suppressClick.current = false;
                e.currentTarget.setPointerCapture(e.pointerId);
                press.current = { item: d.item, x: e.clientX, y: e.clientY, dragging: false };
              }}
              onPointerMove={(e) => {
                const p = press.current;
                if (!p) return;
                if (!p.dragging && Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_SLOP) return;
                if (!p.dragging) {
                  p.dragging = true;
                  setGhost(p.item);
                }
                p.x = e.clientX;
                p.y = e.clientY;
                follow(e.clientX, e.clientY);
              }}
              onPointerUp={(e) => {
                const p = press.current;
                press.current = null;
                setGhost(null);
                if (!p?.dragging) return;
                suppressClick.current = true;
                const tank = trayRef.current?.closest('.reef-tank')?.getBoundingClientRect();
                const tray = trayRef.current?.getBoundingClientRect();
                const xFrac = trayDrop(p.item, { x: e.clientX, y: e.clientY }, tray, tank, width, fullscreen);
                if (xFrac !== null) onShow(p.item, xFrac);
              }}
              onPointerCancel={() => {
                press.current = null;
                setGhost(null);
              }}
              onClick={() => {
                if (suppressClick.current) {
                  suppressClick.current = false;
                  return;
                }
                onShow(d.item, null);
              }}
            >
              <DecorSvg item={d.item} className="h-full w-full" />
            </button>
          );
        })}
      </div>
      {ghost && (
        <div ref={ghostRef} className="pointer-events-none fixed left-0 top-0 z-50 h-16 w-16 opacity-80" data-reef-nofeed>
          <DecorSvg item={ghost} className="h-full w-full" />
        </div>
      )}
    </>
  );
}


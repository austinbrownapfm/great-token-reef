import type { ReactNode } from 'react';

// --- Design system recipes (layered workbench) --------------------------------
// Ground: the app shell paints bg-zinc-50 dark:bg-zinc-950. Content sits on
// elevated white/zinc-900 surfaces. Accent: teal. Reuse these — consistency IS
// the design; don't fork per-view variants.

/** Static elevated surface (cards, panels, form containers). */
export const surface =
  'rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900';

/** Clickable card — surface + hover elevation. */
export const surfaceHover = `${surface} transition-shadow hover:shadow-md`;

/** Large detail sheet. */
export const sheet =
  'rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900';

/** Inputs / selects / textareas. Append widths & extras at the call site. */
export const inputCls =
  'rounded-md border border-zinc-300 bg-white text-zinc-900 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100';

/** Primary action button (teal). Padding stays at the call site. */
export const btnPrimary =
  'rounded-md bg-teal-600 font-medium text-white hover:bg-teal-700 disabled:opacity-40';

/** Neutral outline secondary button. Padding stays at the call site. */
export const btnSecondary =
  'rounded-md border border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800';

/** Filter chip / tab. The ONE active-chip recipe. */
export const chip = (active: boolean) =>
  `rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
    active
      ? 'border-teal-600/30 bg-teal-50 font-medium text-teal-700 dark:border-teal-400/30 dark:bg-teal-950 dark:text-teal-300'
      : 'border-transparent text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800'
  }`;

/** Inline text link / linky button. */
export const linkAccent = 'text-teal-600 hover:underline dark:text-teal-400';

/** Keyboard-hint chip. */
export const kbdCls =
  'rounded border border-zinc-300 bg-zinc-100 px-1 py-px font-mono text-[10px] text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400';

/** Page header h1. Pair with a text-sm text-zinc-500 subtitle line. */
export const pageTitle = 'text-xl font-semibold tracking-tight';

/** Table card wrapper + header-row recipe. */
export const tableWrap =
  'overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900';
export const theadCls =
  'bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-800/50';
export const tbodyCls = 'divide-y divide-zinc-200 dark:divide-zinc-800';
export const trHover = 'hover:bg-zinc-50 dark:hover:bg-zinc-800/40';

// -------------------------------------------------------------------------------

export function Empty({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mx-auto my-8 w-fit max-w-[90%] rounded-lg border border-dashed border-zinc-300 px-8 py-10 text-center dark:border-zinc-700">
      <p className="text-sm font-medium text-zinc-500">{children}</p>
      {hint && <p className="mt-1 text-xs text-zinc-400">{hint}</p>}
    </div>
  );
}

export function Loading() {
  return <p className="animate-pulse p-10 text-center text-sm text-zinc-400">Loading…</p>;
}

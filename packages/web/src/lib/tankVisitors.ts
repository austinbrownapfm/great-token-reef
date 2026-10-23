import type { ReefVisitorError } from '@gtr/shared';
import type { ReefEvent, ReefEventKind } from './api';
import { compactNumber } from './format';
import type { ReleaseStep } from './tankRelease';

// Visitors (living-tank spec §3, fish-picker spec "Chests"): pure labels, links, caps and resting spots for the chest, bottle and whale.

export type VisitorStep = Extract<ReleaseStep, { kind: 'visitor' | 'visitorBatch' }>;
export interface VisitorLine { title: string; detail?: string }
export interface VisitorLabel { kind: ReefEventKind; icon: string; head: string; lines: VisitorLine[] }
/** One chest, bottle or whale resting in the tank until clicked; `x` is its spot as a fraction of the tank width (a whale's cruise phase). */
export interface VisitorMoment { key: number; step: VisitorStep; x: number; leaving?: true; compact?: true }
export type VisitorKind = 'pr' | 'ticket' | 'whale';

const ICON: Record<ReefEventKind, string> = { pr: '📦', ticket: '🍾', whale: '🐋', set: '🏆' };
const HEAD: Record<ReefEventKind, string> = { pr: 'PR merged', ticket: 'Ticket done', whale: 'Deep session', set: 'Set complete' };

// Payloads come from the server as JSON; any field may be missing or the wrong type.
function str(e: ReefEvent, name: string): string | undefined {
  const p = e.payload;
  const v = p && typeof p === 'object' ? (p as Record<string, unknown>)[name] : undefined;
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function num(e: ReefEvent, name: string): number | undefined {
  const p = e.payload;
  const v = p && typeof p === 'object' ? (p as Record<string, unknown>)[name] : undefined;
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

const line = (title: string, detail?: string): VisitorLine => (detail ? { title, detail } : { title });

function eventLine(e: ReefEvent): VisitorLine {
  switch (e.kind) {
    case 'pr': {
      const repo = str(e, 'repo')?.split('/').pop() || undefined;
      const n = num(e, 'number');
      const where = repo && n !== undefined ? `${repo} #${n}` : repo;
      const title = str(e, 'title');
      return title ? line(title, where) : line(where ?? e.ref);
    }
    case 'ticket': {
      const key = str(e, 'key') ?? e.ref;
      const summary = str(e, 'summary');
      return summary ? line(summary, key) : line(key);
    }
    case 'whale': {
      const depth = num(e, 'depthTokens');
      return line(str(e, 'label') ?? e.ref, depth && depth > 0 ? `${compactNumber(depth)} tokens deep` : undefined);
    }
    default:
      return line(str(e, 'label') ?? e.ref);
  }
}

export function visitorLabel(step: VisitorStep): VisitorLabel {
  if (step.kind === 'visitorBatch') {
    const k = step.eventKind;
    const n = step.events.length;
    return { kind: k, icon: ICON[k], head: k === 'pr' ? `${n} PRs merged` : `${n} tickets done`, lines: step.events.map(eventLine) };
  }
  const k = step.event.kind;
  return { kind: k, icon: ICON[k], head: HEAD[k], lines: [eventLine(step.event)] };
}

/** A chest's width in px; landing spots keep one chest width clear of rocks, decor and other chests. */
export const chestWidth = (fullscreen: boolean): number => (fullscreen ? 64 : 44);

/** How many of each kind may rest in the tank at once; past it the oldest of that kind leaves. */
export const VISITOR_CAPS: Record<VisitorKind, number> = { pr: 12, ticket: 6, whale: 3 };

export function visitorKind(step: VisitorStep): ReefEventKind {
  return step.kind === 'visitorBatch' ? step.eventKind : step.event.kind;
}

/** Adds `next`; the oldest still-resting visitors of its kind past the cap are flagged leaving (keys in `evict`). */
export function admitVisitor(list: VisitorMoment[], next: VisitorMoment): { keep: VisitorMoment[]; evict: number[] } {
  const kind = visitorKind(next.step);
  const cap = kind in VISITOR_CAPS ? VISITOR_CAPS[kind as VisitorKind] : Infinity;
  const resting = list.filter((v) => !v.leaving && visitorKind(v.step) === kind);
  const evict = resting.slice(0, Math.max(0, resting.length + 1 - cap)).map((v) => v.key);
  const keep = [...list.map((v) => (evict.includes(v.key) ? { ...v, leaving: true as const } : v)), next];
  return { keep, evict };
}

export type Span = [number, number];

// [lo, hi] minus every blocked span.
function freeSpans(lo: number, hi: number, blocked: Span[]): Span[] {
  let spans: Span[] = [[lo, hi]];
  for (const [a, b] of blocked) {
    spans = spans.flatMap(([s, e]): Span[] => {
      if (b <= s || a >= e) return [[s, e]];
      return [...(a > s ? [[s, a] as Span] : []), ...(b < e ? [[b, e] as Span] : [])];
    });
  }
  return spans;
}

function pickInSpans(spans: Span[], rng: () => number): number | null {
  const total = spans.reduce((n, [a, b]) => n + (b - a), 0);
  if (total <= 0) return null;
  let r = rng() * total;
  for (const [a, b] of spans) {
    if (r <= b - a) return a + r;
    r -= b - a;
  }
  return spans[spans.length - 1]![1];
}

// The spot in [lo, hi] farthest from its nearest neighbour (edge to edge), on a fine grid.
function freestSpot(lo: number, hi: number, others: { x: number; half: number }[]): number {
  const steps = 200;
  let best = lo;
  let bestGap = -Infinity;
  for (let i = 0; i <= steps; i++) {
    const x = lo + ((hi - lo) * i) / steps;
    const gap = Math.min(...others.map((o) => Math.abs(x - o.x) - o.half));
    if (gap > bestGap) {
      bestGap = gap;
      best = x;
    }
  }
  return best;
}

/** A chest's landing x (px): random on the sand, a chest width clear of every taken range (centre x, width); else the freest spot. */
export function pickChestX(width: number, taken: { x: number; w: number }[], chestW: number, rng: () => number = Math.random): number {
  const lo = chestW;
  const hi = width - chestW;
  if (hi < lo) return width / 2;
  const reach = (t: { w: number }) => t.w / 2 + chestW * 1.5;
  const free = pickInSpans(freeSpans(lo, hi, taken.map((t): Span => [t.x - reach(t), t.x + reach(t)])), rng);
  if (free !== null) return free;
  return taken.length ? freestSpot(lo, hi, taken.map((t) => ({ x: t.x, half: t.w / 2 }))) : lo + rng() * (hi - lo);
}

/** Widest a full card is drawn (its max-width) and a compact card's width, px. */
export const cardWidth = (fullscreen: boolean): number => (fullscreen ? 320 : 240);
export const COMPACT_CARD_W = 180;
export type CardAlign = 'start' | 'center' | 'end';
/** Near a side wall a card hangs inward from its visitor so it stays in the tank. */
export const cardAlign = (xFrac: number): CardAlign => (xFrac < 0.25 ? 'start' : xFrac > 0.75 ? 'end' : 'center');
const CARD_INSET = 24;

function cardOffsets(align: CardAlign, cardW: number): Span {
  if (align === 'start') return [-CARD_INSET, cardW - CARD_INSET];
  if (align === 'end') return [CARD_INSET - cardW, CARD_INSET];
  return [-cardW / 2, cardW / 2];
}

/** The x span (px) a card of `cardW` covers when its visitor sits at `x`. */
export function cardSpan(x: number, width: number, cardW: number): Span {
  const [a, b] = cardOffsets(cardAlign(x / width), cardW);
  return [x + a, x + b];
}

// Centre spots in [lo, hi] clear of the body spans whose card overlaps none of `cards`, per alignment region.
function cardFreeSpans(width: number, lo: number, hi: number, body: Span[], cards: Span[], cardW: number): Span[] {
  const regions: [CardAlign, number, number][] = [['start', lo, width * 0.25], ['center', width * 0.25, width * 0.75], ['end', width * 0.75, hi]];
  return regions.flatMap(([align, a, b]) => {
    const s = Math.max(lo, a);
    const e = Math.min(hi, b);
    if (e <= s) return [];
    const [o0, o1] = cardOffsets(align, cardW);
    return freeSpans(s, e, [...body, ...cards.map(([ca, cb]): Span => [ca - o1, cb - o0])]);
  });
}

export interface VisitorSpot { x: number; compact: boolean }

/** Card spans a new `kind` card must clear: every chest and bottle card in the strip, same kind in fullscreen; whales none. */
export function restingCards(live: VisitorMoment[], kind: ReefEventKind, width: number, fullscreen: boolean): Span[] {
  return live.flatMap((v): Span[] => {
    const k = visitorKind(v.step);
    if (v.leaving || k === 'whale' || k === 'set' || (fullscreen && k !== kind)) return [];
    return [cardSpan(v.x * width, width, v.compact ? COMPACT_CARD_W : cardWidth(fullscreen))];
  });
}

/** Resting chests a resize or a rearrange left on a rock or decor piece, re-placed clear of it; the same list when none is. */
export function respotChests(
  list: VisitorMoment[], width: number, taken: { x: number; w: number }[], chestW: number, fullscreen: boolean,
  rng: () => number = Math.random,
): VisitorMoment[] {
  if (width <= 0) return list;
  const onTaken = (x: number) => taken.some((t) => Math.abs(x - t.x) < t.w / 2 + chestW / 2);
  let out = list;
  for (const v of list) {
    if (v.leaving || visitorKind(v.step) !== 'pr' || !onTaken(v.x * width)) continue;
    const others = out.filter((o) => o.key !== v.key && !o.leaving);
    const chests = others.filter((o) => visitorKind(o.step) === 'pr').map((o) => ({ x: o.x * width, w: chestW }));
    const s = placeChest(width, [...taken, ...chests], chestW, restingCards(others, 'pr', width, fullscreen), cardWidth(fullscreen), rng);
    const { compact: _was, ...rest } = v;
    const next: VisitorMoment = { ...rest, x: s.x / width, ...(s.compact ? { compact: true as const } : {}) };
    out = out.map((o) => (o.key === v.key ? next : o));
  }
  return out;
}

/** How far through its back-and-forth cruise a whale is, from the clock: it starts `x` in, like its CSS delay. */
export function whalePhase(elapsedSec: number, dur: number, x: number): number {
  return (((elapsedSec / dur + x) % 1) + 1) % 1;
}

/** Which way a leaving whale swims off: the first half of a cruise runs right (+1), the second back left (-1). */
export function whaleExit(phase: number): 1 | -1 {
  return ((phase % 1) + 1) % 1 < 0.5 ? 1 : -1;
}

const SOURCE_LABEL: Record<ReefVisitorError['source'], string> = { github: 'GitHub', jira: 'Jira' };

function shortAge(secs: number): string {
  if (secs < 60) return 'now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  return `${Math.floor(secs / 86400)}d`;
}

/** One tank chip line per failing visitor source (GitHub first), its age apart so it is not re-announced; `at` 0 (a corrupt stored row) has none. */
export function visitorErrorLines(
  errors: ReefVisitorError[] | undefined, nowSec: number,
): { source: ReefVisitorError['source']; text: string; age?: string; title: string }[] {
  return [...(errors ?? [])]
    .sort((a, b) => a.source.localeCompare(b.source))
    .map((e) => ({
      source: e.source,
      text: `${SOURCE_LABEL[e.source]} visitors failing`,
      ...(e.at > 0 ? { age: shortAge(Math.max(0, nowSec - e.at)) } : {}),
      title: e.message,
    }));
}

/** A chest spot with its full card clear of `cards` (other resting cards); if none fits, the body rule (pickChestX) and a compact card. */
export function placeChest(
  width: number, taken: { x: number; w: number }[], chestW: number, cards: Span[], cardW: number, rng: () => number = Math.random,
): VisitorSpot {
  const lo = chestW;
  const hi = width - chestW;
  const body = taken.map((t): Span => [t.x - t.w / 2 - chestW * 1.5, t.x + t.w / 2 + chestW * 1.5]);
  const x = hi >= lo ? pickInSpans(cardFreeSpans(width, lo, hi, body, cards, cardW), rng) : null;
  return x !== null ? { x, compact: false } : { x: pickChestX(width, taken, chestW, rng), compact: true };
}

/** A bottle spot with its full card clear of `cards`; if none fits, the body rule (pickBottleX) and a compact card. */
export function placeBottle(
  width: number, bobberXs: number[], others: number[], cards: Span[], cardW: number, rng: () => number = Math.random,
): VisitorSpot {
  const { lo, hi, near } = bottleRoom(width, bobberXs, others);
  const x = pickInSpans(cardFreeSpans(width, lo, hi, near.map((n): Span => [n.x - n.half, n.x + n.half]), cards, cardW), rng);
  return x !== null ? { x, compact: false } : { x: pickBottleX(width, bobberXs, others, rng), compact: true };
}

/** A bottle's centre y: just under the waterline, or below the session label pills (fullscreen) so it never covers one. */
export function bottleRestY(surfaceY: number, bottleH: number, pillBottom: number | null): number {
  const under = surfaceY + Math.round(bottleH * 0.3);
  return pillBottom === null ? under : Math.max(under, pillBottom + 6 + Math.round(bottleH / 2));
}

/** The made-up ?reefVisitors=demo visitors carry negative event ids; they stay out of telemetry. */
export function isDemoVisitor(step: VisitorStep): boolean {
  const events = step.kind === 'visitorBatch' ? step.events : [step.event];
  return events.length > 0 && events.every((e) => e.id < 0);
}

const BOBBER_CLEAR = 70;
const BOTTLE_CLEAR = 90;
const BOTTLE_EDGE = 40;

/** A bottle's resting x (px) just below the waterline: clear of the session bobbers (and their pills) and of other bottles. */
function bottleRoom(width: number, bobberXs: number[], others: number[]) {
  const lo = Math.min(BOTTLE_EDGE, width / 2);
  const hi = Math.max(width - BOTTLE_EDGE, width / 2);
  const near = [...bobberXs.map((x) => ({ x, half: BOBBER_CLEAR })), ...others.map((x) => ({ x, half: BOTTLE_CLEAR }))];
  return { lo, hi, near };
}

export function pickBottleX(width: number, bobberXs: number[], others: number[], rng: () => number = Math.random): number {
  const { lo, hi, near } = bottleRoom(width, bobberXs, others);
  const free = pickInSpans(freeSpans(lo, hi, near.map((n): Span => [n.x - n.half, n.x + n.half])), rng);
  if (free !== null) return free;
  return near.length ? freestSpot(lo, hi, near.map((n) => ({ x: n.x, half: 0 }))) : lo + rng() * (hi - lo);
}

/** The web page an event opens: its payload url, only http(s). */
export function eventLink(e: ReefEvent): string | null {
  const url = str(e, 'url');
  return url && /^https?:\/\//i.test(url) ? url : null;
}

/** A single PR or ticket visitor's link; whales have no page and batches link per line (eventLink). */
export function visitorLink(step: VisitorStep): string | null {
  if (step.kind === 'visitorBatch' || step.event.kind === 'whale' || step.event.kind === 'set') return null;
  return eventLink(step.event);
}

import { describe, expect, it } from 'vitest';
import type { ReefEvent } from './api';
import {
  COMPACT_CARD_W, VISITOR_CAPS, admitVisitor, bottleRestY, cardSpan, eventLink, isDemoVisitor, pickBottleX, pickChestX,
  placeBottle, placeChest, respotChests, restingCards, visitorErrorLines, visitorLabel, visitorLink, whaleExit, whalePhase,
  type VisitorMoment,
} from './tankVisitors';

function ev(id: number, kind: ReefEvent['kind'], payload: unknown, ref = `${kind}-${id}`): ReefEvent {
  return { id, kind, ref, payload, created_at: 1000 + id };
}

const one = (e: ReefEvent) => visitorLabel({ kind: 'visitor', event: e });

describe('visitorLabel', () => {
  it('labels a merged PR with its title, short repo and number', () => {
    const pr = ev(1, 'pr', { repo: 'my-app', number: 42, title: 'Add whales', url: 'https://x', mergedAt: 5 });
    expect(one(pr)).toEqual({ kind: 'pr', icon: '📦', head: 'PR merged', lines: [{ title: 'Add whales', detail: 'my-app #42' }] });
  });

  it('keeps only the repo name when the owner is included', () => {
    expect(one(ev(1, 'pr', { repo: 'acme/grace', number: 7, title: 'T' })).lines[0]?.detail).toBe('grace #7');
  });

  it('falls back to repo and number, then the ref, when the PR title is missing', () => {
    expect(one(ev(1, 'pr', { repo: 'grace', number: 7 })).lines).toEqual([{ title: 'grace #7' }]);
    expect(one(ev(1, 'pr', null, 'PR_abc')).lines).toEqual([{ title: 'PR_abc' }]);
    expect(one(ev(1, 'pr', { title: '   ', repo: '' }, 'PR_abc')).lines).toEqual([{ title: 'PR_abc' }]);
  });

  it('ignores a repo with an empty name after the owner', () => {
    expect(one(ev(1, 'pr', { repo: 'owner/', number: 7 }, 'PR_x')).lines).toEqual([{ title: 'PR_x' }]);
    expect(one(ev(1, 'pr', { repo: 'owner/', number: 7, title: 'T' })).lines).toEqual([{ title: 'T' }]);
  });

  it('labels a done ticket with its key and summary', () => {
    const t = ev(2, 'ticket', { key: 'NB-12', summary: 'Ship the reef', url: 'https://j', resolvedAt: 9 });
    expect(one(t)).toEqual({ kind: 'ticket', icon: '🍾', head: 'Ticket done', lines: [{ title: 'Ship the reef', detail: 'NB-12' }] });
  });

  it('uses the ref as the ticket key and title when fields are missing', () => {
    expect(one(ev(2, 'ticket', { summary: 'Ship it' }, 'NB-9')).lines).toEqual([{ title: 'Ship it', detail: 'NB-9' }]);
    expect(one(ev(2, 'ticket', { key: 'NB-9' }, 'NB-9')).lines).toEqual([{ title: 'NB-9' }]);
    expect(one(ev(2, 'ticket', 'garbage', 'NB-9')).lines).toEqual([{ title: 'NB-9' }]);
  });

  it('labels a whale with the session name and depth', () => {
    const w = ev(3, 'whale', { sessionId: 's1', label: 'my-app · reef tank', depthTokens: 128_000_000 });
    expect(one(w)).toEqual({ kind: 'whale', icon: '🐋', head: 'Deep session', lines: [{ title: 'my-app · reef tank', detail: '128M tokens deep' }] });
  });

  it('falls back to the ref for a whale without a label, and skips a bad depth', () => {
    expect(one(ev(3, 'whale', { depthTokens: 'lots' }, 'sess#4')).lines).toEqual([{ title: 'sess#4' }]);
  });

  it('labels a PR batch with a count and one line per PR, in order', () => {
    const label = visitorLabel({
      kind: 'visitorBatch',
      eventKind: 'pr',
      events: [ev(1, 'pr', { repo: 'a', number: 1, title: 'One' }), ev(2, 'pr', {}, 'PR_two')],
    });
    expect(label).toEqual({ kind: 'pr', icon: '📦', head: '2 PRs merged', lines: [{ title: 'One', detail: 'a #1' }, { title: 'PR_two' }] });
  });

  it('labels a ticket batch', () => {
    const label = visitorLabel({
      kind: 'visitorBatch',
      eventKind: 'ticket',
      events: [ev(1, 'ticket', { key: 'A-1', summary: 'x' }), ev(2, 'ticket', { key: 'A-2', summary: 'y' }), ev(3, 'ticket', {}), ev(4, 'ticket', {})],
    });
    expect(label.head).toBe('4 tickets done');
    expect(label.icon).toBe('🍾');
    expect(label.lines.map((l) => l.title)).toEqual(['x', 'y', 'ticket-3', 'ticket-4']);
  });
});

// Deterministic stand-in for Math.random: a small LCG.
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const chest = (key: number): VisitorMoment => ({ key, step: { kind: 'visitor', event: ev(key, 'pr', {}) }, x: 0.5 });
const bottle = (key: number): VisitorMoment => ({ key, step: { kind: 'visitor', event: ev(key, 'ticket', {}) }, x: 0.5 });
const whale = (key: number): VisitorMoment => ({ key, step: { kind: 'visitor', event: ev(key, 'whale', {}) }, x: 0.5 });

describe('admitVisitor', () => {
  it('caps chests at 12, bottles at 6 and whales at 3', () => {
    expect(VISITOR_CAPS).toEqual({ pr: 12, ticket: 6, whale: 3 });
  });

  it('admits under the cap without evicting anything', () => {
    const { keep, evict } = admitVisitor([chest(1), bottle(2)], chest(3));
    expect(keep.map((v) => v.key)).toEqual([1, 2, 3]);
    expect(evict).toEqual([]);
    expect(keep.some((v) => v.leaving)).toBe(false);
  });

  it('a 13th chest sends the oldest chest away, not the older bottle', () => {
    const list = [bottle(0), ...Array.from({ length: 12 }, (_, i) => chest(i + 1))];
    const { keep, evict } = admitVisitor(list, chest(13));
    expect(evict).toEqual([1]);
    expect(keep.find((v) => v.key === 1)?.leaving).toBe(true);
    expect(keep.find((v) => v.key === 0)?.leaving).toBeUndefined();
    expect(keep.at(-1)?.key).toBe(13);
  });

  it('counts a batch chest as a chest and ignores visitors already leaving', () => {
    const batch: VisitorMoment = { key: 1, step: { kind: 'visitorBatch', eventKind: 'pr', events: [] }, x: 0.5 };
    const list = [{ ...chest(0), leaving: true as const }, batch, ...Array.from({ length: 11 }, (_, i) => chest(i + 2))];
    expect(admitVisitor(list, chest(20)).evict).toEqual([1]);
  });

  it('evicts the oldest whale past 3 and the oldest bottle past 6', () => {
    expect(admitVisitor([whale(1), whale(2), whale(3)], whale(4)).evict).toEqual([1]);
    expect(admitVisitor(Array.from({ length: 6 }, (_, i) => bottle(i + 1)), bottle(7)).evict).toEqual([1]);
  });
});

describe('pickChestX', () => {
  const W = 1000;
  const CW = 44;
  const clearOf = (x: number, t: { x: number; w: number }) => Math.abs(x - t.x) - t.w / 2 - CW / 2 >= CW - 1e-9;

  it('lands inside the tank, clear of every taken range by a chest width', () => {
    const taken = [{ x: 200, w: 120 }, { x: 600, w: 80 }];
    const rng = seeded(7);
    for (let i = 0; i < 200; i++) {
      const x = pickChestX(W, taken, CW, rng);
      expect(x).toBeGreaterThanOrEqual(CW);
      expect(x).toBeLessThanOrEqual(W - CW);
      for (const t of taken) expect(clearOf(x, t)).toBe(true);
    }
  });

  it('is deterministic for a seeded rng', () => {
    const taken = [{ x: 500, w: 100 }];
    expect(pickChestX(W, taken, CW, seeded(3))).toBe(pickChestX(W, taken, CW, seeded(3)));
  });

  it('spreads across the free sand', () => {
    const rng = seeded(11);
    const xs = Array.from({ length: 100 }, () => pickChestX(W, [], CW, rng));
    expect(Math.min(...xs)).toBeLessThan(300);
    expect(Math.max(...xs)).toBeGreaterThan(700);
  });

  it('falls back to the freest spot when no spot is a full chest width clear', () => {
    // Both gaps (200-250, 650-770) are narrower than three chest widths; the wider one is centred at 710.
    const taken = [{ x: 100, w: 200 }, { x: 450, w: 400 }, { x: 880, w: 220 }];
    const x = pickChestX(W, taken, CW, seeded(1));
    expect(Math.abs(x - 710)).toBeLessThanOrEqual(CW / 4);
  });

  it('still returns a spot inside a tank narrower than a chest', () => {
    const x = pickChestX(30, [{ x: 15, w: 30 }], CW, seeded(1));
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThanOrEqual(30);
  });
});

describe('pickBottleX', () => {
  const BOBBER = 70;
  const BOTTLE = 90;
  const EDGE = 40;

  it('floats at least 70px from every bobber and 90px from every other bottle, inside the edge margins', () => {
    const layouts = [
      { width: 1000, bobbers: [300, 700], others: [500] },
      { width: 1600, bobbers: [100, 420, 980, 1500], others: [250, 1250] },
      { width: 600, bobbers: [150], others: [450] },
    ];
    for (const { width, bobbers, others } of layouts) {
      const rng = seeded(width);
      for (let i = 0; i < 300; i++) {
        const x = pickBottleX(width, bobbers, others, rng);
        for (const b of bobbers) expect(Math.abs(x - b)).toBeGreaterThanOrEqual(BOBBER);
        for (const o of others) expect(Math.abs(x - o)).toBeGreaterThanOrEqual(BOTTLE);
        expect(x).toBeGreaterThanOrEqual(EDGE);
        expect(x).toBeLessThanOrEqual(width - EDGE);
      }
    }
  });

  it('uses the free water, not just one gap', () => {
    const rng = seeded(3);
    const xs = Array.from({ length: 200 }, () => pickBottleX(1000, [500], [], rng));
    expect(xs.some((x) => x < 430)).toBe(true);
    expect(xs.some((x) => x > 570)).toBe(true);
  });

  it('is deterministic for a seeded rng, and different seeds land differently', () => {
    const run = (seed: number) => {
      const rng = seeded(seed);
      return Array.from({ length: 5 }, () => pickBottleX(1000, [300], [700], rng));
    };
    expect(run(9)).toEqual(run(9));
    expect(run(9)).not.toEqual(run(10));
  });

  it('when crowded, falls back to the spot farthest from every bobber, whatever the rng', () => {
    // 40..160 is all within 70px of a bobber; the farthest spot from its nearest one is midway between two.
    const a = pickBottleX(200, [50, 100, 150], [], seeded(2));
    expect(a).toBeCloseTo(75, 0);
    expect(pickBottleX(200, [50, 100, 150], [], seeded(77))).toBe(a);
    expect(pickBottleX(200, [50, 100, 150], [], () => 0.99)).toBe(a);
  });

  it('centres in a tank too narrow for the edge margins', () => {
    expect(pickBottleX(60, [], [], seeded(1))).toBe(30);
  });
});

describe('visitorLink', () => {
  it('links a PR or ticket to its payload url', () => {
    expect(visitorLink({ kind: 'visitor', event: ev(1, 'pr', { url: 'https://github.com/o/r/pull/1' }) })).toBe('https://github.com/o/r/pull/1');
    expect(visitorLink({ kind: 'visitor', event: ev(2, 'ticket', { url: 'https://x.atlassian.net/browse/NB-1' }) })).toBe('https://x.atlassian.net/browse/NB-1');
  });

  it('has no link for whales, batches, missing urls or non-web urls', () => {
    expect(visitorLink({ kind: 'visitor', event: ev(1, 'whale', { url: 'https://x' }) })).toBeNull();
    expect(visitorLink({ kind: 'visitorBatch', eventKind: 'pr', events: [ev(1, 'pr', { url: 'https://x' })] })).toBeNull();
    expect(visitorLink({ kind: 'visitor', event: ev(1, 'pr', {}) })).toBeNull();
    expect(visitorLink({ kind: 'visitor', event: ev(1, 'pr', { url: 'javascript:alert(1)' }) })).toBeNull();
  });

  it('links each batch line through eventLink', () => {
    expect(eventLink(ev(1, 'ticket', { url: 'http://j/NB-2' }))).toBe('http://j/NB-2');
    expect(eventLink(ev(1, 'ticket', null))).toBeNull();
  });
});

describe('placeChest / placeBottle (cards first)', () => {
  const overlap = (a: [number, number], b: [number, number]) => a[0] < b[1] && b[0] < a[1];

  it('two chests never get overlapping full cards when there is room', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const rng = seeded(seed);
      const first = placeChest(1200, [], 44, [], 240, rng);
      expect(first.compact).toBe(false);
      const second = placeChest(1200, [{ x: first.x, w: 44 }], 44, [cardSpan(first.x, 1200, 240)], 240, rng);
      expect(second.compact).toBe(false);
      expect(overlap(cardSpan(first.x, 1200, 240), cardSpan(second.x, 1200, 240))).toBe(false);
    }
  });

  it('keeps the card off rocks-and-decor-free sand but clear of other cards, and the body rule still holds', () => {
    const rng = seeded(4);
    const taken = [{ x: 600, w: 100 }];
    const cards: [number, number][] = [[100, 340]];
    for (let i = 0; i < 100; i++) {
      const p = placeChest(1200, taken, 44, cards, 240, rng);
      expect(p.compact).toBe(false);
      expect(overlap(cardSpan(p.x, 1200, 240), cards[0]!)).toBe(false);
      expect(Math.abs(p.x - 600) - 50 - 22).toBeGreaterThanOrEqual(44 - 1e-9);
    }
  });

  it('reports compact (and falls back to the body rule) when no full card fits', () => {
    const p = placeChest(1000, [{ x: 200, w: 60 }], 44, [[0, 1000]], 240, seeded(2));
    expect(p.compact).toBe(true);
    expect(Math.abs(p.x - 200) - 30 - 22).toBeGreaterThanOrEqual(44 - 1e-9);
  });

  it('places a bottle with its card clear of other cards, else compact', () => {
    const rng = seeded(8);
    const cards: [number, number][] = [[300, 540]];
    for (let i = 0; i < 100; i++) {
      const p = placeBottle(1200, [800], [], cards, 240, rng);
      expect(p.compact).toBe(false);
      expect(overlap(cardSpan(p.x, 1200, 240), cards[0]!)).toBe(false);
      expect(Math.abs(p.x - 800)).toBeGreaterThanOrEqual(70);
    }
    expect(placeBottle(1200, [], [], [[0, 1200]], 240, seeded(1)).compact).toBe(true);
  });

  it('a compact card is narrower than a full one', () => {
    expect(COMPACT_CARD_W).toBeLessThan(240);
  });

  it('hangs a card inward near the side walls', () => {
    expect(cardSpan(100, 1000, 240)).toEqual([76, 316]);
    expect(cardSpan(500, 1000, 240)).toEqual([380, 620]);
    expect(cardSpan(900, 1000, 240)).toEqual([684, 924]);
  });
});

describe('bottleRestY', () => {
  it('floats just under the waterline with no label pills', () => {
    expect(bottleRestY(14, 26, null)).toBe(14 + 8);
  });

  it('rests below the label pill band when pills are drawn', () => {
    const y = bottleRestY(80, 36, 130);
    expect(y - 36 / 2).toBeGreaterThanOrEqual(130);
  });

  it('keeps its waterline height when the pills already end above it', () => {
    expect(bottleRestY(200, 36, 130)).toBe(200 + 11);
  });
});

describe('isDemoVisitor', () => {
  it('flags the ?reefVisitors=demo visitors (negative event ids) only', () => {
    expect(isDemoVisitor({ kind: 'visitor', event: ev(-1, 'pr', {}) })).toBe(true);
    expect(isDemoVisitor({ kind: 'visitorBatch', eventKind: 'pr', events: [ev(-2, 'pr', {}), ev(-3, 'pr', {})] })).toBe(true);
    expect(isDemoVisitor({ kind: 'visitor', event: ev(4, 'pr', {}) })).toBe(false);
    expect(isDemoVisitor({ kind: 'visitorBatch', eventKind: 'pr', events: [] })).toBe(false);
  });
});

describe('restingCards', () => {
  const at = (v: VisitorMoment, x: number, compact = false): VisitorMoment => ({ ...v, x, ...(compact ? { compact: true as const } : {}) });

  it('a cruising whale never claims a card band, so it cannot push strip cards compact', () => {
    expect(restingCards([at(whale(1), 0.5)], 'pr', 1000, false)).toEqual([]);
    const cards = restingCards([at(whale(1), 0.5)], 'pr', 1000, false);
    expect(placeChest(1000, [], 44, cards, 240, seeded(3)).compact).toBe(false);
  });

  it('in the strip every chest and bottle card shares the band; fullscreen only the same kind', () => {
    const live = [at(chest(1), 0.5), at(bottle(2), 0.2, true)];
    expect(restingCards(live, 'pr', 1000, false)).toEqual([cardSpan(500, 1000, 240), cardSpan(200, 1000, COMPACT_CARD_W)]);
    expect(restingCards(live, 'pr', 1000, true)).toEqual([cardSpan(500, 1000, 320)]);
  });

  it('skips visitors already leaving', () => {
    expect(restingCards([{ ...at(chest(1), 0.5), leaving: true }], 'pr', 1000, false)).toEqual([]);
  });
});

describe('respotChests', () => {
  const W = 1000;
  const CW = 44;
  const at = (v: VisitorMoment, x: number): VisitorMoment => ({ ...v, x });

  it('returns the same list when no chest sits on a rock', () => {
    const list = [at(chest(1), 0.2), at(bottle(2), 0.6)];
    expect(respotChests(list, W, [{ x: 700, w: 120 }], CW, false, seeded(1))).toBe(list);
  });

  it('moves a chest the resize left on a rock clear of it, and leaves the rest alone', () => {
    const list = [at(chest(1), 0.7), at(chest(2), 0.2), at(whale(3), 0.7)];
    const taken = [{ x: 700, w: 120 }];
    for (let seed = 1; seed <= 30; seed++) {
      const out = respotChests(list, W, taken, CW, false, seeded(seed));
      const moved = out.find((v) => v.key === 1)!;
      expect(Math.abs(moved.x * W - 700)).toBeGreaterThanOrEqual(60 + CW / 2);
      expect(Math.abs(moved.x * W - 200)).toBeGreaterThanOrEqual(CW);
      expect(out.find((v) => v.key === 2)).toBe(list[1]);
      expect(out.find((v) => v.key === 3)).toBe(list[2]);
    }
  });

  it('falls back to the body rule and a compact card when no clear sand remains', () => {
    const list = [at(chest(1), 0.5)];
    const out = respotChests(list, 300, [{ x: 150, w: 300 }], CW, false, seeded(2));
    expect(out).not.toBe(list);
    expect(out[0]!.compact).toBe(true);
    expect(out[0]!.x * 300).toBeGreaterThanOrEqual(0);
    expect(out[0]!.x * 300).toBeLessThanOrEqual(300);
  });

  it('never moves a chest that is already leaving', () => {
    const list: VisitorMoment[] = [{ ...at(chest(1), 0.7), leaving: true }];
    expect(respotChests(list, W, [{ x: 700, w: 120 }], CW, false, seeded(1))).toBe(list);
  });
});

describe('whale exit', () => {
  it('swims off right during the first half of its cruise and left during the second', () => {
    expect(whaleExit(0.1)).toBe(1);
    expect(whaleExit(0.49)).toBe(1);
    expect(whaleExit(0.5)).toBe(-1);
    expect(whaleExit(0.9)).toBe(-1);
  });

  it('wraps a cruise phase past a lap or before zero', () => {
    expect(whaleExit(1.2)).toBe(1);
    expect(whaleExit(-0.2)).toBe(-1);
  });

  it('the clock phase starts x into the cruise, like the CSS delay', () => {
    expect(whalePhase(0, 40, 0.3)).toBeCloseTo(0.3);
    expect(whalePhase(20, 40, 0.3)).toBeCloseTo(0.8);
    expect(whalePhase(40, 40, 0.3)).toBeCloseTo(0.3);
  });
});

describe('visitorErrorLines', () => {
  const now = 1_000_000;

  it('is empty while every visitor fetch is healthy', () => {
    expect(visitorErrorLines([], now)).toEqual([]);
    expect(visitorErrorLines(undefined, now)).toEqual([]);
  });

  it('names the failing source, with how long ago it last failed kept apart from the announced text', () => {
    expect(visitorErrorLines([{ source: 'jira', message: 'HTTP 401', at: now - 2 * 3600 }], now)).toEqual([
      { source: 'jira', text: 'Jira visitors failing', age: '2h', title: 'HTTP 401' },
    ]);
    const age = (secs: number) => visitorErrorLines([{ source: 'github', message: 'boom', at: now - secs }], now)[0]?.age;
    expect(age(300)).toBe('5m');
    expect(age(20)).toBe('now');
    expect(age(3 * 86400)).toBe('3d');
  });

  it('rounds an age down, so it never claims a longer failure than there was', () => {
    const age = (secs: number) => visitorErrorLines([{ source: 'jira', message: 'x', at: now - secs }], now)[0]?.age;
    expect(age(59.5 * 60)).toBe('59m');
    expect(age(23.5 * 3600)).toBe('23h');
  });

  it('leaves the age off a corrupt stored row (at 0)', () => {
    const [line] = visitorErrorLines([{ source: 'github', message: 'corrupt stored visitor error', at: 0 }], now);
    expect(line?.text).toBe('GitHub visitors failing');
    expect(line?.age).toBeUndefined();
  });

  it('one line per source, GitHub first', () => {
    const lines = visitorErrorLines([{ source: 'jira', message: 'a', at: now }, { source: 'github', message: 'b', at: now }], now);
    expect(lines.map((l) => l.source)).toEqual(['github', 'jira']);
  });
});

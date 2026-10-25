import type { ReefEvent } from './api';
import type { VisitorStep } from './tankVisitors';

// Dev-only ?reefVisitors=demo fixtures: one of each visitor with made-up payloads.

function demoEvent(id: number, kind: ReefEvent['kind'], ref: string, payload: Record<string, unknown>): ReefEvent {
  return { id, kind, ref, payload, created_at: Math.floor(Date.now() / 1000) };
}

export function demoVisitorSteps(): VisitorStep[] {
  const pr = (id: number, n: number, title: string) =>
    demoEvent(id, 'pr', `demo-pr-${n}`, { repo: 'demo/reef', number: n, title, url: `https://example.com/demo/pull/${n}` });
  return [
    { kind: 'visitor', event: pr(-1, 101, 'Demo: chests stay on the sand until clicked') },
    { kind: 'visitorBatch', eventKind: 'pr', events: [pr(-2, 102, 'Demo batch one'), pr(-3, 103, 'Demo batch two'), pr(-4, 104, 'Demo batch three')] },
    { kind: 'visitor', event: demoEvent(-5, 'ticket', 'NB-42', { key: 'NB-42', summary: 'Demo: a bottle bobs until clicked', url: 'https://example.com/demo/browse/NB-42' }) },
    { kind: 'visitor', event: demoEvent(-6, 'whale', 'demo#1', { sessionId: 'demo', label: 'reef · demo whale', depthTokens: 128_000_000 }) },
  ];
}

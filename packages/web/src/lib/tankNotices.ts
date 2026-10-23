import type { ReefVisitorError } from '@gtr/shared';
import { visitorErrorLines } from './tankVisitors';

export interface TankNotice { key: string; text: string; title?: string; /** shown, never announced: it changes every minute */ age?: string }

/** The tank's failure chips: the release queue, the collection, the fish picks, then visitor fetches failing on the server. */
export function tankNotices(s: {
  queueError: string | null; queueHeld: boolean; collectionError: string | null; picksFailed: boolean;
  visitorErrors: ReefVisitorError[] | undefined; nowSec: number;
}): TankNotice[] {
  return [
    ...(s.queueError !== null ? [{ key: 'queue', text: 'release queue unavailable', title: s.queueError }] : []),
    ...(s.collectionError !== null ? [{ key: 'collection', text: 'collection unavailable', title: s.collectionError }] : []),
    ...(s.picksFailed ? [{ key: 'picks', text: 'fish picks unavailable' }] : []),
    // Visitor errors ride on pending, so an unknown queue's are stale.
    ...(s.queueHeld ? [] : visitorErrorLines(s.visitorErrors, s.nowSec)).map((l) => ({
      key: l.source, text: l.text, title: l.title, ...(l.age ? { age: l.age } : {}),
    })),
  ];
}

import { describe, expect, it } from 'vitest';
import { tankNotices } from './tankNotices';

describe('tankNotices', () => {
  const healthy = {
    queueError: null, queueHeld: false, collectionError: null, picksFailed: false, visitorErrors: undefined, nowSec: 10_000,
  };

  it('shows nothing when every source is healthy', () => {
    expect(tankNotices(healthy)).toEqual([]);
  });

  it('a failed collection shows a chip with its error', () => {
    expect(tankNotices({ ...healthy, collectionError: 'collection 500' })).toEqual([
      { key: 'collection', text: 'collection unavailable', title: 'collection 500' },
    ]);
  });

  it('orders the queue, collection, picks and visitor chips', () => {
    const keys = tankNotices({
      ...healthy, queueError: 'q', collectionError: 'c', picksFailed: true, queueHeld: false,
      visitorErrors: [{ source: 'jira', message: 'j', at: 9_000 }],
    }).map((n) => n.key);
    expect(keys).toEqual(['queue', 'collection', 'picks', 'jira']);
  });

  it('a visitor chip carries its age', () => {
    expect(tankNotices({ ...healthy, visitorErrors: [{ source: 'github', message: 'gh 502', at: 10_000 - 300 }] })).toEqual([
      { key: 'github', text: 'GitHub visitors failing', title: 'gh 502', age: '5m' },
    ]);
  });

  it('hides stale visitor chips while the queue is unknown', () => {
    const notices = tankNotices({
      ...healthy, queueError: 'q', queueHeld: true, visitorErrors: [{ source: 'github', message: 'gh 502', at: 9_000 }],
    });
    expect(notices.map((n) => n.key)).toEqual(['queue']);
  });
});

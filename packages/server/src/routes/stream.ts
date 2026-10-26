import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AppEnv } from '../app.ts';

// Server-sent events: thin {type, id} messages; clients refetch what changed.
// EventSource auto-reconnects; the 25s heartbeat keeps proxies from closing us.

export const stream = new Hono<AppEnv>().get('/', (c) => {
  const bus = c.get('bus');
  // Hono answers HEAD by running this handler and dropping the body uncancelled, which would leak the subscription.
  if (c.req.method === 'HEAD') return c.body(null, 200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });

  return streamSSE(c, async (sse) => {
    let alive = true;
    const unsubscribe = bus.subscribe((message) => {
      void sse.writeSSE({ event: 'change', data: JSON.stringify(message) });
    });
    sse.onAbort(() => {
      alive = false;
      unsubscribe();
    });
    await sse.writeSSE({ event: 'hello', data: '{}' });
    while (alive) {
      await new Promise((r) => setTimeout(r, 25_000));
      await sse.writeSSE({ event: 'ping', data: '{}' });
    }
  });
});

import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { AppEnv } from '../app.ts';
import { Bus } from '../services/bus.ts';
import { stream } from './stream.ts';

function app(bus: Bus) {
  const app = new Hono<AppEnv>();
  app.use(async (c, next) => {
    c.set('bus', bus);
    await next();
  });
  return app.route('/stream', stream);
}

const tick = () => new Promise((r) => setTimeout(r, 10));

describe('event stream', () => {
  it('answers HEAD with stream headers and never subscribes', async () => {
    const bus = new Bus();
    for (let i = 0; i < 5; i++) {
      const res = await app(bus).request('/stream', { method: 'HEAD' });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
    }
    await tick();
    expect(bus.size).toBe(0);
  });

  it('delivers hello and bus changes, and unsubscribes when the client goes away', async () => {
    const bus = new Bus();
    const res = await app(bus).request('/stream');
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const next = async () => decoder.decode((await reader.read()).value);

    expect(await next()).toContain('event: hello');
    expect(bus.size).toBe(1);
    bus.emit('reef', 'r1');
    const change = await next();
    expect(change).toContain('event: change');
    expect(change).toContain('"type":"reef"');

    await reader.cancel();
    await tick();
    expect(bus.size).toBe(0);
  });
});

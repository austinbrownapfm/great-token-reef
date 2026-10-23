// Minimal pub/sub for SSE: services emit, /api/events/stream fans out to
// connected browsers, which invalidate their query caches. Payload stays thin.

export type BusEvent = 'reef';

export interface BusMessage {
  type: BusEvent;
  id?: string;
}

type Listener = (message: BusMessage) => void;

export class Bus {
  private listeners = new Set<Listener>();

  emit(type: BusEvent, id?: string): void {
    for (const listener of this.listeners) {
      try {
        listener({ type, id });
      } catch (err) {
        // A dead SSE connection must never break an emitter.
        console.warn(`[server] bus listener failed on '${type}'${id ? ` (${id})` : ''}: ${(err as Error).message}`);
      }
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get size(): number {
    return this.listeners.size;
  }
}

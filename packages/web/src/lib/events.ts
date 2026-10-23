import type { QueryClient } from '@tanstack/react-query';

// SSE → query invalidation: the server sends thin {type} change events;
// we refetch whatever that touches, and reopen the stream if the browser gives up.

const INVALIDATIONS: Record<string, string[]> = {
  reef: ['reef'],
};

const RETRY_MS = 3000;

export function connectEventStream(queryClient: QueryClient): void {
  let everOpened = false;
  const open = () => {
    const source = new EventSource('/api/events/stream');
    source.addEventListener('open', () => {
      // Events emitted while the stream was down are lost, so catch up once.
      if (everOpened) {
        console.log('[events] event stream reconnected, refetching all queries');
        void queryClient.invalidateQueries();
      }
      everOpened = true;
    });
    source.addEventListener('error', () => {
      // An error response during reconnect makes the browser give up for good.
      if (source.readyState !== EventSource.CLOSED) return;
      console.warn(`[events] event stream closed, reopening in ${RETRY_MS / 1000}s`);
      source.close();
      setTimeout(open, RETRY_MS);
    });
    source.addEventListener('change', (event) => {
      try {
        const { type } = JSON.parse((event as MessageEvent).data as string) as { type: string };
        for (const key of INVALIDATIONS[type] ?? []) {
          void queryClient.invalidateQueries({ queryKey: [key] });
        }
      } catch {
        // Malformed event — the next poll/refetch still catches up.
      }
    });
  };
  open();
}

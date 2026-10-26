import type { UiEventBody } from '@gtr/shared';

/** Fire-and-forget UI usage event. Never throws. */
export function uiEvent(name: string, detail?: string): void {
  void fetch('/api/events/ui', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, detail } satisfies UiEventBody),
  }).catch(() => undefined);
}

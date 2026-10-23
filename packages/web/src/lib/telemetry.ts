/** Fire-and-forget UI usage event (rewrite-plan 1.6). Never throws. */
export function uiEvent(name: string, detail?: string): void {
  void fetch('/api/events/ui', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, detail }),
  }).catch(() => undefined);
}

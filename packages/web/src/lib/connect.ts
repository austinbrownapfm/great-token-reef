import type { ConnectStatus } from '@gtr/shared';

export type CardState = 'not-connected' | 'connected' | 'error';

export function cardState(s: ConnectStatus['github' | 'jira' | 'claude']): CardState {
  if ('error' in s && s.error) return 'error';
  if ('detected' in s) return s.detected ? 'connected' : 'not-connected';
  return s.connected ? 'connected' : 'not-connected';
}

export interface ResettableMutation<V> {
  reset(): void;
  mutate(vars: V, options?: { onSuccess?: () => void }): void;
}

/** Clears the card's other mutations' stale errors, then runs this one; on success it drops its own variables (tokens). */
export function runCardMutation<V>(active: ResettableMutation<V>, group: { reset(): void }[], vars: V): void {
  for (const m of group) if (m !== active) m.reset();
  active.mutate(vars, { onSuccess: () => active.reset() });
}

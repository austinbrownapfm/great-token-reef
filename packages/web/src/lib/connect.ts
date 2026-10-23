import type { ConnectStatus } from '@gtr/shared';

export type CardState = 'not-connected' | 'connected' | 'error';

export function cardState(s: ConnectStatus['github' | 'jira' | 'claude']): CardState {
  if ('error' in s && s.error) return 'error';
  if ('detected' in s) return s.detected ? 'connected' : 'not-connected';
  return s.connected ? 'connected' : 'not-connected';
}

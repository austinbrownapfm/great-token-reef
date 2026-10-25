import type { ReefAgent } from './api';

// Codex only shows up once it has logs to report.
export function codexVisible(status: { files: number } | undefined): boolean {
  return (status?.files ?? 0) > 0;
}

export function displayAgent(agent: ReefAgent, codexShown: boolean): ReefAgent {
  return agent === 'codex' && !codexShown ? 'all' : agent;
}

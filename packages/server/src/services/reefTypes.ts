export type ReefAgent = 'claude' | 'codex';
export type ReefAgentFilter = ReefAgent | 'all';

export interface CodexUsageRow {
  requestId: string;
  ts: number;
  sessionId: string;
  project: string;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  reasoningOutput: number;
  cacheWriteInput: number;
  cost: number | null;
}

export interface CodexSessionRow {
  sessionId: string;
  nativeId: string;
  parentSessionId: string | null;
  project: string;
  ts: number;
  label: string;
  modelProvider: string | null;
  source: string;
}

export interface CodexLimitWindow {
  usedPercent: number;
  windowMinutes: number;
  resetsAt: number | null;
}

export interface CodexLimitSnapshot {
  observedAt: number;
  source: string;
  limitId: string;
  primary: CodexLimitWindow | null;
  secondary: CodexLimitWindow | null;
  unlimited: boolean;
  plan: string | null;
}

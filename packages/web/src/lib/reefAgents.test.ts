import { describe, expect, it } from 'vitest';
import { codexVisible, displayAgent } from './reefAgents';

describe('codexVisible', () => {
  it('hides while loading or without logs', () => {
    expect(codexVisible(undefined)).toBe(false);
    expect(codexVisible({ files: 0 })).toBe(false);
  });
  it('shows once logs exist', () => {
    expect(codexVisible({ files: 3 })).toBe(true);
  });
});

describe('displayAgent', () => {
  it('falls back to all when codex is hidden', () => {
    expect(displayAgent('codex', false)).toBe('all');
    expect(displayAgent('codex', true)).toBe('codex');
    expect(displayAgent('claude', false)).toBe('claude');
  });
});

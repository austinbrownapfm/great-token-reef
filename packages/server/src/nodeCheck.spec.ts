import { describe, expect, it } from 'vitest';
import { assertNodeVersion } from './nodeCheck.ts';

describe('assertNodeVersion', () => {
  it('rejects Node 22 with a message naming Node 24', () => {
    expect(() => assertNodeVersion('22.11.0')).toThrow(/Node 24/);
  });
  it('accepts Node 24', () => {
    expect(() => assertNodeVersion('24.0.0')).not.toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import { parsePort } from './portCheck.ts';

describe('parsePort', () => {
  it('defaults to 3033 and accepts 1-65535', () => {
    expect(parsePort(undefined)).toBe(3033);
    expect(parsePort('1')).toBe(1);
    expect(parsePort('65535')).toBe(65535);
  });

  it.each(['0', '65536', '-1', 'abc', '', '30.5', ' 80', '1e3'])('rejects %j with the one-line message', (raw) => {
    expect(() => parsePort(raw)).toThrow(`GTR_PORT must be a port number (1-65535), got "${raw}"`);
  });
});

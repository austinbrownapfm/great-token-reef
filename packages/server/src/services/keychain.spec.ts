import { afterEach, describe, expect, it, vi } from 'vitest';
import { keychainDelete, keychainGet, keychainSet, type KeychainExec } from './keychain.ts';

afterEach(() => vi.restoreAllMocks());

const failing = (status: number): KeychainExec => () => {
  throw Object.assign(new Error('Command failed: security'), { status });
};

describe('keychainSet', () => {
  it('sends the secret on stdin, escaped, and never in the arguments', () => {
    const exec = vi.fn<KeychainExec>(() => '');
    keychainSet('github-token', 'p"a\\ss', exec);
    const [file, args, options] = exec.mock.calls[0]!;
    expect(file).toBe('security');
    expect(args).toEqual(['-i']);
    expect(JSON.stringify(args)).not.toContain('a\\ss');
    expect(options.input).toBe('add-generic-password -U -s great-token-reef -a github-token -w "p\\"a\\\\ss"\n');
  });

  it('rejects secrets that would break the command line', () => {
    const exec = vi.fn<KeychainExec>(() => '');
    expect(() => keychainSet('github-token', 'a\nb', exec)).toThrow('single non-empty line');
    expect(() => keychainSet('github-token', '', exec)).toThrow();
    expect(exec).not.toHaveBeenCalled();
  });

  it('rejects non-printable-ASCII secrets and over-long escaped lines', () => {
    const exec = vi.fn<KeychainExec>(() => '');
    expect(() => keychainSet('github-token', 'has space', exec)).toThrow('printable ASCII');
    expect(() => keychainSet('github-token', 'tök', exec)).toThrow('printable ASCII');
    expect(() => keychainSet('github-token', 'a\tb', exec)).toThrow();
    expect(() => keychainSet('github-token', 'x'.repeat(1100), exec)).toThrow('too long');
    expect(() => keychainSet('github-token', '"'.repeat(600), exec)).toThrow('too long');
    expect(exec).not.toHaveBeenCalled();
    expect(() => keychainSet('github-token', 'x'.repeat(500), exec)).not.toThrow();
  });

  it('throws a readable error without the secret and logs it without the secret', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => keychainSet('jira-api-token', 'sekrit', failing(51))).toThrow(/Keychain.*exit 51/);
    expect(JSON.stringify(error.mock.calls)).not.toContain('sekrit');
  });
});

describe('keychainGet', () => {
  it('returns the stored secret without the trailing newline', () => {
    const exec = vi.fn<KeychainExec>(() => 'tok\n');
    expect(keychainGet('github-token', exec)).toBe('tok');
    expect(exec.mock.calls[0]![1]).toEqual(['find-generic-password', '-s', 'great-token-reef', '-a', 'github-token', '-w']);
  });

  it('returns null and warns once when the item is missing or access is denied', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(keychainGet('github-token', failing(44))).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('[connect]');
  });
});

describe('keychainDelete', () => {
  it('treats a missing item as already deleted', () => {
    expect(() => keychainDelete('github-token', failing(44))).not.toThrow();
  });

  it('throws on any other failure', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => keychainDelete('github-token', failing(51))).toThrow(/exit 51/);
  });
});

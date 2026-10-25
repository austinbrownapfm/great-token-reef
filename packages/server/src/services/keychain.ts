import { execFileSync } from 'node:child_process';

const SERVICE = 'great-token-reef';

export type KeychainAccount = 'github-token' | 'jira-api-token';

export type KeychainExec = (
  file: string,
  args: string[],
  options: { encoding: 'utf8'; timeout: number; input?: string },
) => string | Buffer;

const defaultExec: KeychainExec = (file, args, options) =>
  execFileSync(file, args, { ...options, stdio: ['pipe', 'pipe', 'pipe'] });

const ITEM_NOT_FOUND = 44;
const MAX_SECRET_LINE_BYTES = 1024;
const OPTIONS = { encoding: 'utf8', timeout: 10_000 } as const;

const exitStatus = (err: unknown): number | null => {
  const status = (err as { status?: unknown }).status;
  return typeof status === 'number' ? status : null;
};

const describe = (err: unknown) => `exit ${exitStatus(err) ?? 'unknown'}`;

// null only when the item does not exist; any other failure throws.
export function keychainGet(account: KeychainAccount, exec: KeychainExec = defaultExec): string | null {
  try {
    const out = exec('security', ['find-generic-password', '-s', SERVICE, '-a', account, '-w'], OPTIONS);
    return String(out).replace(/\r?\n$/, '');
  } catch (err) {
    if (exitStatus(err) === ITEM_NOT_FOUND) return null;
    console.warn(`[connect] keychain read failed for ${account} (${describe(err)})`);
    throw new Error(`Could not read ${account} from the macOS Keychain (${describe(err)}). Check that Keychain access is allowed.`);
  }
}

// Secret goes on stdin of `security -i` so it never shows in a process argument list.
export function keychainSet(account: KeychainAccount, secret: string, exec: KeychainExec = defaultExec): void {
  if (secret === '' || /[\r\n\0]/.test(secret)) throw new Error('secret must be a single non-empty line');
  if (!/^[\x21-\x7e]+$/.test(secret)) throw new Error('secret must be printable ASCII with no spaces');
  const quoted = secret.replace(/[\\"]/g, '\\$&');
  const input = `add-generic-password -U -s ${SERVICE} -a ${account} -w "${quoted}"\n`;
  if (Buffer.byteLength(input) > MAX_SECRET_LINE_BYTES) throw new Error('secret is too long');
  try {
    exec('security', ['-i'], { ...OPTIONS, input });
  } catch (err) {
    console.error(`[connect] keychain write failed for ${account} (${describe(err)})`);
    throw new Error(`Could not save to the macOS Keychain (${describe(err)}). Check that Keychain access is allowed.`);
  }
}

export function keychainDelete(account: KeychainAccount, exec: KeychainExec = defaultExec): void {
  try {
    exec('security', ['delete-generic-password', '-s', SERVICE, '-a', account], OPTIONS);
  } catch (err) {
    if (exitStatus(err) === ITEM_NOT_FOUND) return;
    console.error(`[connect] keychain delete failed for ${account} (${describe(err)})`);
    throw new Error(`Could not remove the item from the macOS Keychain (${describe(err)}).`);
  }
}

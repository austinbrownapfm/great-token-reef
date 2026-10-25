import { assertNodeVersion } from './nodeCheck.ts';
import { parsePort } from './portCheck.ts';

try {
  assertNodeVersion();
  parsePort(process.env.GTR_PORT);
} catch (err) {
  console.error(`[server] ${(err as Error).message}`);
  process.exit(1);
}

// Dynamic so node:sqlite is never loaded before the version check passes.
await import('./main.ts');

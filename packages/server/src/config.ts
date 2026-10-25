import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePort } from './portCheck.ts';

const home = homedir();
const dev = process.env.GTR_DEV === '1';
const dataDir = process.env.GTR_DATA_DIR ?? join(home, '.great-token-reef');

export const config = {
  port: parsePort(process.env.GTR_PORT),
  host: '127.0.0.1' as const,
  dataDir,
  dbPath: join(dataDir, 'reef.db'),
  ccProjectsDir: process.env.GTR_CC_PROJECTS_DIR ?? join(home, '.claude', 'projects'),
  codexSessionsDir:
    process.env.GTR_CODEX_SESSIONS_DIR ??
    join(process.env.CODEX_HOME ?? join(home, '.codex'), 'sessions'),
  dev,
  openBrowser: !dev && process.env.GTR_NO_OPEN !== '1',
  webRoot: fileURLToPath(new URL('../../web', import.meta.url)),
};

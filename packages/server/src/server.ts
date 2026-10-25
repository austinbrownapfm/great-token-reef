import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createReadStream, realpathSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { getRequestListener } from '@hono/node-server';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

export interface StartServerOptions {
  app: { fetch: (request: Request) => Response | Promise<Response> };
  dev: boolean;
  webRoot: string;
  port: number;
  host: '127.0.0.1';
  log?: (message: string) => void;
  exit?: (code: number) => void;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Resolves a request path to a real file inside `dist`, or null. Never leaves `dist`. */
function resolveStatic(distReal: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const candidate = resolve(distReal, '.' + (decoded.startsWith('/') ? decoded : `/${decoded}`));
  if (candidate !== distReal && !candidate.startsWith(distReal + sep)) return null;
  if (!isFile(candidate)) return null;
  // Real path check so a symlink inside dist cannot point outside it.
  const real = realpathSync(candidate);
  return real.startsWith(distReal + sep) ? real : null;
}

function serveFile(req: IncomingMessage, res: ServerResponse, file: string, log: (m: string) => void): void {
  const fail = (err: Error): void => {
    log(`[server] static ${file}: ${err.message}`);
    if (res.headersSent) res.destroy();
    else res.writeHead(500, { 'content-type': 'text/plain' }).end('error reading file');
  };
  let size: number;
  try {
    size = statSync(file).size;
  } catch (err) {
    return fail(err as Error);
  }
  const headers = {
    'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': size,
  };
  if (req.method === 'HEAD') {
    res.writeHead(200, headers).end();
    return;
  }
  const stream = createReadStream(file);
  stream.on('error', fail);
  // Headers wait for a successful open so a vanished or unreadable file can still become a 500.
  stream.once('open', () => {
    res.writeHead(200, headers);
    stream.pipe(res);
  });
  res.on('close', () => stream.destroy());
}

function staticHandler(webRoot: string, log: (m: string) => void) {
  const dist = resolve(webRoot, 'dist');
  return (req: IncomingMessage, res: ServerResponse): void => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' }).end();
      return;
    }
    let distReal: string;
    try {
      distReal = realpathSync(dist);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('web app not built');
      return;
    }
    const pathname = (req.url ?? '/').split('?')[0]!.split('#')[0]!;
    const file = resolveStatic(distReal, pathname) ?? resolveStatic(distReal, '/index.html');
    if (!file) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    serveFile(req, res, file, log);
  };
}

export async function startServer(opts: StartServerOptions): Promise<Server> {
  const log = opts.log ?? console.log;
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  const api = getRequestListener(opts.app.fetch);

  let web: (req: IncomingMessage, res: ServerResponse) => void;
  const server = createServer((req, res) => {
    // A forged Host is a DNS-rebinding page talking to us; only our own origins get an answer.
    const { port } = server.address() as AddressInfo;
    if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) {
      res.writeHead(403, { 'content-type': 'text/plain' }).end('forbidden host');
      return;
    }
    if ((req.url ?? '').startsWith('/api/')) return void api(req, res);
    web(req, res);
  });

  if (opts.dev) {
    const { createServer: createVite } = await import('vite');
    const vite = await createVite({
      root: opts.webRoot,
      server: { middlewareMode: true, hmr: { server } },
      appType: 'spa',
    });
    web = (req, res) =>
      vite.middlewares(req, res, () => {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      });
    server.on('close', () => void vite.close());
  } else {
    web = staticHandler(opts.webRoot, log);
  }

  return new Promise<Server>((resolvePromise, reject) => {
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        log(
          `[server] port ${opts.port} is already in use — is The Great Token Reef already running? Set GTR_PORT to use another port.`,
        );
        exit(1);
      }
      reject(err);
    });
    server.listen(opts.port, opts.host, () => resolvePromise(server));
  });
}

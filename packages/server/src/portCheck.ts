/** Port from GTR_PORT (default 3033); throws a one-line message for anything but an integer 1-65535. */
export function parsePort(raw: string | undefined): number {
  if (raw === undefined) return 3033;
  const port = Number(raw);
  if (!/^\d+$/.test(raw) || port < 1 || port > 65535) {
    throw new Error(`GTR_PORT must be a port number (1-65535), got "${raw}"`);
  }
  return port;
}

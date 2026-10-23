export function assertNodeVersion(version: string = process.versions.node, min = 24): void {
  const major = Number(version.split('.')[0]);
  if (!Number.isFinite(major) || major < min) {
    throw new Error(`The Great Token Reef needs Node ${min} or newer; this is Node ${version}.`);
  }
}

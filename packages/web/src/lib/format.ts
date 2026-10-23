// The one place date/duration formatting lives (the old app defined
// formatDate 11 times — see rewrite-analysis.md).

const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const DATE_YEAR = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const TIME = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });

/** unix seconds → "Aug 14" (adds the year when not the current one). */
export function formatDate(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return d.getFullYear() === new Date().getFullYear() ? DATE.format(d) : DATE_YEAR.format(d);
}

/** unix seconds → "Aug 14, 9:41 AM". */
export function formatDateTime(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return `${formatDate(unixSeconds)}, ${TIME.format(d)}`;
}

/** seconds → "1h 24m" / "18m" / "45s". */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** unix seconds → "2h ago" / "3d ago" / falls back to the date. */
export function timeAgo(unixSeconds: number): string {
  const secs = Date.now() / 1000 - unixSeconds;
  if (secs < 90) return 'just now';
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  if (secs < 86400 * 7) return `${Math.round(secs / 86400)}d ago`;
  return formatDate(unixSeconds);
}

const COMPACT = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

/** 22_400_000 → "22.4M" */
export function compactNumber(n: number): string {
  return COMPACT.format(n);
}

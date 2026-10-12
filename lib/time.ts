export function timeAgo(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "unknown";
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) {
    const h = Math.floor(s / 3600);
    return h === 1 ? "1 hour ago" : `${h} hours ago`;
  }
  const days = Math.floor(s / 86400);
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return new Date(t).toISOString().slice(0, 10);
}

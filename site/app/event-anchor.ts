export function eventAnchor(id: string): string {
  return `event-${String(id)}`;
}

export function eventHref(id: string): string {
  return `#${encodeURIComponent(eventAnchor(id))}`;
}

export function eventIdFromHash(hash: string): string | null {
  const raw = hash.replace(/^#/, "");
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch { return null; }
  return decoded.startsWith("event-") ? decoded.slice("event-".length) || null : null;
}

// Kind of night, from display-safe fields only. Shared by the advisory
// pipeline, the published row and the feedback policy, so all three agree.
export function classifyEventType(event) {
  const title = String(event?.title ?? '').toLowerCase();
  // A watched destination running more than one day is a festival even when
  // its title never says so ("CRSSD Spring 2027").
  if (title.includes('festival') || String(event?.type ?? '').includes('festival') || (event?.destination?.days?.length ?? 0) > 1 || (event?.performers?.length ?? 0) >= 6) return 'festival';
  if (title.includes('dj set') || title.includes('open to close')) return 'dj set';
  return 'concert';
}

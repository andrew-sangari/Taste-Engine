import { normalizeArtistName } from './ranking.js';

const SOURCE_PRIORITY = { seatgeek: 3, ticketmaster: 2, framework: 1, insomniac: 1 };

export function deduplicateCandidates(candidates, diagnostics = null) {
  const merged = [];
  if (diagnostics) {
    diagnostics.inputCount = candidates.length;
    diagnostics.mergedCount = 0;
    diagnostics.venueAliasUse = 0;
  }
  for (const candidate of candidates) {
    const match = merged.find((existing) => sameOccurrence(existing, candidate));
    if (!match) {
      merged.push({
        ...candidate,
        sourceOccurrences: sourceOccurrencesFor(candidate)
      });
      continue;
    }
    if (diagnostics) {
      diagnostics.mergedCount += 1;
      if (normalizeArtistName(match.venue?.name) !== normalizeArtistName(candidate.venue?.name)) {
        diagnostics.venueAliasUse += 1;
      }
    }
    mergeInto(match, candidate);
  }
  if (diagnostics) {
    diagnostics.canonicalCount = merged.length;
    diagnostics.sourceOccurrenceCount = merged.reduce((sum, candidate) => sum + (candidate.sourceOccurrences?.length ?? 0), 0);
  }
  return merged;
}

export function sameOccurrence(left, right) {
  if (occurrenceClass(left.type) !== occurrenceClass(right.type) || localDate(left.startLocal) !== localDate(right.startLocal)) return false;
  const leftPerformers = new Set(left.performers.map((performer) => normalizeArtistName(performer.name)).filter(Boolean));
  const performerOverlap = right.performers.some((performer) => leftPerformers.has(normalizeArtistName(performer.name)));
  const titleLeft = canonicalEventTitle(left.title);
  const titleRight = canonicalEventTitle(right.title);
  const titleMatch = titleLeft === titleRight || (titleLeft.length > 8 && titleRight.length > 8 && (titleLeft.includes(titleRight) || titleRight.includes(titleLeft)));
  if (!performerOverlap && !titleMatch) return false;
  const venueMatch = sameVenue(left.venue, right.venue);
  const sameCity = normalizeArtistName(left.venue.city) && normalizeArtistName(left.venue.city) === normalizeArtistName(right.venue.city);
  const sameCityFestival = sameCity && titleMatch && titleLeft.includes('festival');
  if (!venueMatch && !(sameCity && performerOverlap) && !sameCityFestival) return false;
  const timeDelta = Math.abs(new Date(left.startLocal).getTime() - new Date(right.startLocal).getTime());
  return Number.isNaN(timeDelta) || timeDelta <= 4 * 60 * 60 * 1000;
}

function occurrenceClass(type) {
  const normalized = normalizeArtistName(type);
  if (normalized.includes('concert') || normalized.includes('music') || normalized.includes('festival')) return 'music';
  return normalized;
}

export function canonicalEventTitle(value) {
  return normalizeArtistName(value)
    .replace(/\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b.*$/g, '')
    .replace(/\bwith\b.*$/g, '')
    .replace(/\bpresents?\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sameVenue(left, right) {
  if (Number.isFinite(left.lat) && Number.isFinite(left.lon) && Number.isFinite(right.lat) && Number.isFinite(right.lon)) {
    return distanceMiles(left.lat, left.lon, right.lat, right.lon) <= 1.5;
  }
  const leftName = normalizeArtistName(left.name);
  const rightName = normalizeArtistName(right.name);
  return Boolean(leftName && rightName && (leftName === rightName || leftName.includes(rightName) || rightName.includes(leftName)));
}

function mergeInto(target, incoming) {
  target.sourceOccurrences.push(...sourceOccurrencesFor(incoming));
  const performerKeys = new Set(target.performers.map((performer) => normalizeArtistName(performer.name)));
  for (const performer of incoming.performers) {
    if (!performerKeys.has(normalizeArtistName(performer.name))) target.performers.push(performer);
  }
  if ((SOURCE_PRIORITY[incoming.source] ?? 0) > (SOURCE_PRIORITY[target.source] ?? 0)) {
    for (const field of ['id', 'source', 'sourceEventId', 'sourceUrl', 'title', 'startLocal', 'startUtc', 'timeTbd', 'dateTbd', 'status', 'venue']) {
      target[field] = incoming[field];
    }
  }
  if (target.ticketObservation.lowestPriceUsd == null) target.ticketObservation.lowestPriceUsd = incoming.ticketObservation.lowestPriceUsd;
}

function sourceOccurrencesFor(candidate) {
  const existing = Array.isArray(candidate.sourceOccurrences) && candidate.sourceOccurrences.length
    ? candidate.sourceOccurrences
    : [{ source: candidate.source, sourceEventId: candidate.sourceEventId, sourceUrl: candidate.sourceUrl }];
  return existing.map((occurrence) => ({
    ...occurrence,
    title: occurrence.title ?? candidate.title,
    startLocal: occurrence.startLocal ?? candidate.startLocal,
    venue: occurrence.venue ?? candidate.venue,
    performerNames: occurrence.performerNames ?? (candidate.performers ?? []).map((performer) => performer.name)
  }));
}

function localDate(value) {
  return String(value ?? '').slice(0, 10);
}

function distanceMiles(lat1, lon1, lat2, lon2) {
  const radians = Math.PI / 180;
  const dLat = (lat2 - lat1) * radians;
  const dLon = (lon2 - lon1) * radians;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

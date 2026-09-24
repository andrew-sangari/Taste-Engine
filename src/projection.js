import { classifyEventType } from './eventEnhancement.js';
import { buildSemanticEventInsight } from './nightlife/cardInsight.js';
import { resolveMusicVisual, resolveSportsVisual } from './visuals.js';

/**
 * The published event row. Shared by the local export and the hosted refresh
 * (through the deterministic engine bundle) so the two cannot publish different
 * contracts.
 *
 * The boundary is deliberate. Four kinds of data exist for an event and only
 * the last is published:
 * 1. internal source evidence and provider occurrences (`eventEvidence`,
 *    `sourceOccurrences`) — private, written to `data/nightlife/` for evaluation;
 * 2. model-eligible input — built from (1) at inference time, never stored here;
 * 3. profile-scoped personal-relevance matches — composed locally into (4);
 * 4. the display-safe `semanticInsight`: at most three claims, each with its
 *    status, basis and source citations.
 * Publishing (1) or its provenance summary would let a display row stand in for
 * model input and bypass the field-level permissions, so neither is copied.
 */
export function toDisplayEvent(candidate, localEnhancement = null) {
  const occurrences = Array.isArray(candidate?.sourceOccurrences) ? candidate.sourceOccurrences : [];
  const sourceLinks = [...new Map(occurrences
    .filter((occurrence) => occurrence?.sourceUrl)
    .map((occurrence) => [
      `${occurrence.source}|${occurrence.sourceUrl}`,
      { source: occurrence.source, url: occurrence.sourceUrl }
    ])).values()];
  const { playlistAffinity: _playlistAffinity, topItemsAffinity: _topItemsAffinity, corroborationBonus: _corroborationBonus, ...safeRanking } = candidate?.ranking ?? {};
  return {
    id: candidate.id,
    title: candidate.title,
    sourceUrl: candidate.sourceUrl,
    sources: [...new Set(occurrences.map((occurrence) => occurrence.source))],
    sourceLinks,
    eventType: classifyEventType(candidate),
    startLocal: candidate.startLocal,
    timeTbd: candidate.timeTbd === true,
    venue: candidate.venue,
    performers: (candidate.performers ?? []).map((performer) => ({ name: performer?.name, primary: performer?.primary === true })),
    ticketObservation: candidate.ticketObservation,
    matchedArtists: (candidate.matchedArtists ?? []).map(({ spotifyArtistId, name, seedStrength, origin, matchMethod, primary }) => ({ spotifyArtistId, name, seedStrength, origin, matchMethod, primary })),
    lineupDisplay: sanitizeLineupDisplay(candidate.lineupDisplay),
    visual: candidate.visual ?? resolveMusicVisual(candidate),
    ranking: safeRanking,
    // Optional and advisory only. Enrichment composes it at refresh time; a
    // caller that ran no enrichment gets the deterministic composition. It
    // never changes ranking or eligibility.
    semanticInsight: 'semanticInsight' in candidate
      ? candidate.semanticInsight ?? null
      : buildSemanticEventInsight(candidate),
    localEnhancement
  };
}

function sanitizeLineupDisplay(value) {
  if (!value) return null;
  return {
    displayTitle: value.displayTitle || null,
    displayShape: value.displayShape || 'general-show',
    orderedArtists: (value.orderedArtists ?? []).map(({ lineupEntryId, displayName, relation, billingGroupIndex, b2bWithNext }) => ({ lineupEntryId, displayName, relation, billingGroupIndex, b2bWithNext })),
    totalArtists: Number(value.totalArtists ?? 0),
    directCount: Number(value.directCount ?? 0),
    adjacentCount: Number(value.adjacentCount ?? 0),
    ages: value.ages || null,
    sourceUrl: value.sourceUrl || null
  };
}

export function toDisplaySportsGame(game, localEnhancement = null) {
  const sourceLinks = [...new Map([
    ...(game.sourceOccurrences ?? []).filter((occurrence) => occurrence?.sourceUrl).map((occurrence) => ({ source: occurrence.source, url: occurrence.sourceUrl })),
    ...(game.ticketObservations ?? []).filter((observation) => observation?.url).map((observation) => ({ source: observation.source, url: observation.url }))
  ].map((link) => [`${link.source}|${link.url}`, link])).values()];
  return {
    id: game.id,
    source: 'mlb',
    sourceUrl: game.sourceUrl,
    startLocal: game.startLocal,
    timeTbd: game.timeTbd === true,
    venue: game.venue,
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
    series: game.series,
    sportsContext: game.sportsContext,
    tags: game.tags,
    ticketObservations: game.ticketObservations,
    sourceLinks,
    ranking: game.ranking,
    visual: game.visual ?? resolveSportsVisual(game),
    localEnhancement
  };
}

export function enhancementFor(value) {
  return value && Object.keys(value).length ? value : null;
}

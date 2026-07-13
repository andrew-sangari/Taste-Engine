import { classifyEventType } from './eventEnhancement.js';
import { resolveMusicVisual, resolveSportsVisual } from './visuals.js';

export function toDisplayEvent(candidate, localEnhancement = null) {
  const sourceLinks = [...new Map((candidate.sourceOccurrences ?? [])
    .filter((occurrence) => occurrence.sourceUrl)
    .map((occurrence) => [
      `${occurrence.source}|${occurrence.sourceUrl}`,
      { source: occurrence.source, url: occurrence.sourceUrl }
    ])).values()];
  const { playlistAffinity: _playlistAffinity, topItemsAffinity: _topItemsAffinity, corroborationBonus: _corroborationBonus, ...safeRanking } = candidate.ranking;
  return {
    id: candidate.id,
    title: candidate.title,
    sourceUrl: candidate.sourceUrl,
    sources: [...new Set((candidate.sourceOccurrences ?? []).map((occurrence) => occurrence.source))],
    sourceLinks,
    eventType: classifyEventType(candidate),
    startLocal: candidate.startLocal,
    timeTbd: candidate.timeTbd,
    venue: candidate.venue,
    performers: candidate.performers.map(({ name, primary }) => ({ name, primary })),
    ticketObservation: candidate.ticketObservation,
    matchedArtists: (candidate.matchedArtists ?? []).map(({ spotifyArtistId, name, seedStrength, origin, matchMethod, primary }) => ({ spotifyArtistId, name, seedStrength, origin, matchMethod, primary })),
    lineupDisplay: sanitizeLineupDisplay(candidate.lineupDisplay),
    visual: candidate.visual ?? resolveMusicVisual(candidate),
    ranking: safeRanking,
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
    ...(game.sourceOccurrences ?? []).filter((occurrence) => occurrence.sourceUrl).map((occurrence) => ({ source: occurrence.source, url: occurrence.sourceUrl })),
    ...(game.ticketObservations ?? []).filter((observation) => observation.url).map((observation) => ({ source: observation.source, url: observation.url }))
  ].map((link) => [`${link.source}|${link.url}`, link])).values()];
  return {
    id: game.id,
    source: 'mlb',
    sourceUrl: game.sourceUrl,
    startLocal: game.startLocal,
    timeTbd: game.timeTbd,
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

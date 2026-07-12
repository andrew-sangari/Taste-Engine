import { normalizeArtistName } from './ranking.js';
import { resolveMusicVisual, resolveSportsVisual } from './visuals.js';

export function buildOverview(events = [], sports = []) {
  return selectRepresentatives(buildCandidates(events, sports)).slice(0, 5);
}

export function buildOverviewBuckets(events = [], sports = [], {
  now = new Date(),
  currentDays = 14,
  planAheadLimit = 3,
  planAheadMinScore = 55,
  horizonDays = null
} = {}) {
  const candidates = buildCandidates(events, sports);
  const currentPool = candidates.filter((candidate) => {
    const days = daysFrom(candidate.startLocal, now);
    return days != null && days >= 0 && days <= currentDays;
  });
  const currentRepresentatives = selectRepresentativeCandidates(currentPool).slice(0, 5);
  const current = currentRepresentatives.map((candidate) => ({ ...toOverviewDisplay(candidate), bucket: 'current' }));
  const currentIds = new Set(current.map((candidate) => candidate.id));
  const currentGroups = new Set(currentRepresentatives.map((candidate) => candidate.overviewGroupKey));
  const planAhead = selectRepresentatives(candidates.filter((candidate) => {
    const days = daysFrom(candidate.startLocal, now);
    return !currentIds.has(candidate.id)
      && !currentGroups.has(candidate.overviewGroupKey)
      && days != null
      && days > currentDays
      && (horizonDays == null || days <= horizonDays)
      && candidate.score >= planAheadMinScore
      && candidate.call !== 'skip';
  })).slice(0, planAheadLimit).map((candidate) => ({ ...candidate, bucket: 'plan-ahead' }));
  return { current, planAhead };
}

function buildCandidates(events = [], sports = []) {
  return [...events.map((event) => ({
    vertical: 'music',
    id: event.id,
    title: event.title,
    sourceUrl: event.sourceUrl,
    startLocal: event.startLocal,
    venue: event.venue,
    score: event.ranking.utility,
    interestScore: event.ranking.artistFit,
    hassleScore: event.ranking.hassleScore,
    urgency: event.ranking.urgency,
    confidence: event.ranking.confidence,
    reason: event.ranking.whyYou,
    call: event.ranking.call ?? event.call ?? callLabel(event.ranking.utility),
    localEnhancement: event.localEnhancement,
    sources: event.sources,
    eventType: event.eventType,
    visual: event.visual ?? resolveMusicVisual(event),
    overviewGroupKey: overviewMusicGroupKey(event)
  })), ...sports.map((game) => ({
    vertical: 'sports',
    id: game.id,
    title: friendlySportsTitle(game),
    sourceUrl: game.sourceUrl,
    startLocal: game.startLocal,
    venue: game.venue,
    score: game.ranking.utility,
    interestScore: game.ranking.interestScore,
    hassleScore: game.ranking.hassleScore,
    urgency: game.ranking.urgency,
    confidence: game.ranking.confidence,
    reason: game.ranking.whyYou,
    call: game.ranking.call ?? game.call ?? callLabel(game.ranking.utility),
    localEnhancement: game.localEnhancement,
    sources: [...new Set((game.ticketObservations ?? []).map((observation) => observation.source))],
    eventType: 'baseball',
    visual: game.visual ?? resolveSportsVisual(game),
    overviewGroupKey: `sports:${game.series?.id ?? normalizeArtistName(game.awayTeam?.name ?? game.id)}`
  }))].sort(overviewComparator);
}

function selectRepresentatives(candidates) {
  return selectRepresentativeCandidates(candidates).map(toOverviewDisplay);
}

function selectRepresentativeCandidates(candidates) {
  const seenGroups = new Set();
  const selected = [];
  for (const candidate of candidates) {
    if (seenGroups.has(candidate.overviewGroupKey)) continue;
    seenGroups.add(candidate.overviewGroupKey);
    selected.push(candidate);
  }
  return selected;
}

function toOverviewDisplay(candidate) {
  const { overviewGroupKey: _overviewGroupKey, localEnhancement: _localEnhancement, sources: _sources, ...display } = candidate;
  return display;
}

function overviewMusicGroupKey(event) {
  const primary = event.matchedArtists?.find((artist) => artist.primary) ?? event.matchedArtists?.[0];
  if (primary?.name) return `music:${normalizeArtistName(primary.name)}`;
  if (event.eventType === 'festival') return `music-festival:${normalizeArtistName(event.title)}`;
  return `music:${normalizeArtistName(event.title)}`;
}

function friendlySportsTitle(game) {
  const opponent = friendlyTeamName(game.awayTeam);
  return `Dodgers vs. ${opponent}`;
}

function friendlyTeamName(team = {}) {
  const name = String(team.name ?? team.shortName ?? 'Opponent');
  const known = ['Diamondbacks', 'Padres', 'Giants', 'Yankees', 'Mets', 'Cubs', 'Cardinals', 'Astros', 'Red Sox', 'Braves', 'Phillies', 'Brewers', 'Marlins', 'Nationals', 'Reds', 'Pirates', 'Rockies', 'Tigers', 'Twins', 'White Sox', 'Guardians', 'Rays', 'Blue Jays', 'Orioles', 'Royals', 'Angels', 'Athletics', 'Mariners', 'Rangers'];
  const match = known.find((label) => name.toLocaleLowerCase().includes(label.toLocaleLowerCase()));
  if (match) return match;
  return String(team.shortName ?? name).replace(/^Arizona$/i, 'Diamondbacks').replace(/^Los Angeles\s+/i, '').trim();
}

function overviewComparator(left, right) {
  const scoreDelta = right.score - left.score;
  if (Math.abs(scoreDelta) <= 5 && left.vertical !== right.vertical) return left.vertical === 'music' ? -1 : 1;
  return scoreDelta || String(left.startLocal).localeCompare(String(right.startLocal));
}

function callLabel(score) {
  if (score >= 75) return 'Strong fit';
  if (score >= 55) return 'Selective';
  if (score >= 40) return 'Wildcard';
  return 'Watch';
}

function daysFrom(value, now) {
  if (!value) return null;
  const date = new Date(value);
  const reference = new Date(now);
  if (Number.isNaN(date.getTime()) || Number.isNaN(reference.getTime())) return null;
  return Math.ceil((date.getTime() - reference.getTime()) / 86_400_000);
}

// Explicit hosted allowlist for the deterministic bundle. The generated
// companion is rebuilt before every Sites build so Worker ranking cannot drift
// from the root deterministic modules.
export {
  UNORDERED_URGENCIES,
  URGENCY_PRIORITY,
  calculateHassle,
  normalizeArtistName,
  playlistAffinityFor,
  rankAffinity,
  rankCandidates,
  topItemsAffinityFor
} from "../../src/ranking.js";
export { canonicalEventTitle, deduplicateCandidates, sameOccurrence } from "../../src/candidates.js";
export { EDMTRAIN_API_BASE_URL, buildEdmtrainUrl, enrichEventsWithEdmtrain, fetchEdmtrainEvents, normalizeEdmtrainEvent } from "../../src/edmtrain.js";
export { fetchDodgersHomeGames, fetchMlbPitcherStats, fetchMlbStandings, applyPitcherStats, normalizeMlbGame, normalizePitcher, normalizeStandings, normalizeTeam } from "../../src/mlb.js";
export { enrichSportsGames, fetchSeatGeekSportsEvents, fetchTicketmasterSportsEvents, joinSportsTickets, normalizeSeatGeekSportsEvent, normalizeTicketmasterSportsEvent, scoreSportsGame, sportsTicketUrgency, ticketMatchesGame } from "../../src/sports.js";
export { eventWithinRadius, fetchSeatGeekEvents, fetchSeatGeekEventsForPerformers, fetchSeatGeekWeekendEvents, normalizeSeatGeekEvent, resolveSeatGeekPerformers, searchSeatGeekPerformers, selectSeatGeekPerformer, splitDateWindows, spotifyIdFromLinks } from "../../src/seatgeek.js";
export { fetchTicketmasterEvents, fetchTicketmasterEventsForArtists, normalizeTicketmasterEvent, ticketmasterEventMatchesArtist } from "../../src/ticketmaster.js";
export { fetchFrameworkArtists, fetchFrameworkEvents, frameworkPerformers, normalizeFrameworkEvent, parseFrameworkArtists } from "../../src/framework.js";
export { fetchInsomniacEvents, INSOMNIAC_ADAPTER_VERIFIED, normalizeInsomniacEvent, parseInsomniacEvents } from "../../src/insomniac.js";
export { enrichMovieMetadata, fetchUpcomingMovies, normalizeTmdbMovie, resolveTmdbAuth } from "../../src/tmdb.js";
export { selectMovieCandidates } from "../../src/movieSelection.js";
export { DEFAULT_FOCAL_POINT, isAllowedTmdbImage, normalizeFocalPoint, normalizeVisual, resolveMovieVisual, resolveMusicVisual, resolveSportsVisual } from "../../src/visuals.js";
export { buildOverview, buildOverviewBuckets } from "../../src/overview.js";
export { buildExpandedArtistSnapshot, topRecurringTags } from "../../src/tasteExpansion.js";
export { buildSemanticCandidateInput, buildSemanticRequest } from "../../src/nightlife/semanticInput.js";
export { buildSemanticEventInsight } from "../../src/nightlife/cardInsight.js";
export { toDisplayEvent, toDisplaySportsGame } from "../../src/projection.js";
export { enrichSemanticEventCards, semanticSourceHealth } from "../../src/nightlife/cardEnrichment.js";
export {
  EVENT_EVIDENCE_SCHEMA_VERSION,
  buildEventEvidence,
  createEvidenceFact,
  createEventEvidence,
  serializeEventEvidenceForDisplay,
  serializeEventEvidenceForModel,
  summarizeEvidenceCoverage,
} from "../../src/eventEvidence.js";
export { createDecisionInferenceProvider } from "../../src/nightlife/inference.js";
export { createAssessmentCache } from "../../src/nightlife/assessmentCache.js";
export { describeNightlifeConfig, nightlifeInferenceConfigured, readNightlifeConfig } from "../../src/nightlife/config.js";

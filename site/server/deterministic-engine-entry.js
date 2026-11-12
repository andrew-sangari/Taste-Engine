// Explicit hosted allowlist for the deterministic bundle. The generated
// companion is rebuilt before every Sites build so Worker ranking cannot drift
// from the root deterministic modules.
export {
  PROMOTER_SOURCES,
  UNORDERED_URGENCIES,
  URGENCY_PRIORITY,
  NOISY_TAGS,
  buildSceneProfile,
  callLabel,
  sceneFitFor,
  promoterAffinityFor,
  selectPublishedConcerts,
  calculateHassle,
  normalizeArtistName,
  playlistAffinityFor,
  rankAffinity,
  rankCandidates,
  topItemsAffinityFor
} from "../../src/ranking.js";
export { addPromoterEvidence, applyArtistTags, knownArtistNames } from "../../src/discovery.js";
export { artistTagKey, resolveArtistTags } from "../../src/artistTags.js";
export { FEEDBACK_POLICY, applyFeedbackOverlay, deriveFeedbackSignals, describeLearning, feedbackKeysFor } from "../../src/feedbackPolicy.js";
export { SOURCE_DEADLINE_MS, withDeadline } from "../../src/deadline.js";
export { buildFeedbackReview } from "../../src/feedbackReview.js";
export { applyEngagements, engagementSourceHealth, normalizeEngagements } from "../../src/movieEngagements.js";
export { RAMS_TEAM_ID, SOFI_STADIUM, applyNflStandings, fetchNflStandings, fetchRamsHomeGames, nflSeasonsForWindow, normalizeNflGame, normalizeNflStandings } from "../../src/nfl.js";
export { sportsLeagueConfig, sportsLeagueOf } from "../../src/sports.js";
export { parsePromoterTitle } from "../../src/eventTitle.js";
export { canonicalEventTitle, deduplicateCandidates, sameOccurrence } from "../../src/candidates.js";
export { EDMTRAIN_API_BASE_URL, buildEdmtrainUrl, enrichEventsWithEdmtrain, fetchEdmtrainEvents, normalizeEdmtrainEvent } from "../../src/edmtrain.js";
export { fetchDodgersHomeGames, fetchMlbPitcherStats, fetchMlbStandings, applyPitcherStats, normalizeMlbGame, normalizePitcher, normalizeStandings, normalizeTeam } from "../../src/mlb.js";
export { enrichSportsGames, fetchSeatGeekSportsEvents, fetchTicketmasterSportsEvents, joinSportsTickets, normalizeSeatGeekSportsEvent, normalizeTicketmasterSportsEvent, scoreSportsGame, sportsTicketUrgency, ticketMatchesGame } from "../../src/sports.js";
export { eventWithinRadius, fetchSeatGeekEvents, fetchSeatGeekEventsForPerformers, fetchSeatGeekWeekendEvents, normalizeSeatGeekEvent, resolveSeatGeekPerformers, searchSeatGeekPerformers, selectSeatGeekPerformer, splitDateWindows, spotifyIdFromLinks } from "../../src/seatgeek.js";
export { fetchTicketmasterEvents, fetchTicketmasterEventsForArtists, normalizeTicketmasterEvent, ticketmasterEventMatchesArtist } from "../../src/ticketmaster.js";
export { fetchFrameworkArtists, fetchFrameworkEvents, frameworkPerformers, normalizeFrameworkEvent, parseFrameworkArtists } from "../../src/framework.js";
export { fetchInsomniacEvents, INSOMNIAC_ADAPTER_VERIFIED, normalizeInsomniacEvent, parseInsomniacEvents } from "../../src/insomniac.js";
export { DEFAULT_DESTINATION_WATCHLIST, fetchDestinationEvents, resolveDestinationWatchlist } from "../../src/destinationEvents.js";
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

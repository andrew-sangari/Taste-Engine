/**
 * Local personal-relevance comparison.
 *
 * Jev characterizes the event from event-level evidence only; it never sees who
 * the event is for. This module is where that characterization meets the
 * user's existing taste signals, and it runs entirely on our side. Nothing here
 * is serialized into a model request, and nothing here is written into the
 * event-level assessment cache, so a characterization stays reusable across
 * profiles while every match stays scoped to the profile that produced it.
 *
 * The comparisons are deliberately few and explicit. Each one names the event
 * attribute it needs, the preference signal it needs, and what the resulting
 * claim is allowed to say. If either half is missing the comparison produces
 * nothing: an interesting event characteristic is not a preference, and a
 * discovery path (similar, tag, promoter) is not proof the user has or has not
 * experienced a format before.
 *
 * Signals used, and only these:
 * - direct artists: `matchedArtists` whose origin is `source` or `top-items`,
 *   i.e. an exact match to an artist in the user's selected listening. The
 *   ranking already exposes this match on the card; it is reused, not rescored.
 * - taste-profile tags: the public `tasteProfile.topTags` block, the Last.fm
 *   taxonomy the profile already publishes.
 *
 * There is no established format, venue, or schedule preference anywhere in the
 * profile, so no comparison claims one. A "may not fit" claim would need a
 * documented negative preference, which the profile also does not hold.
 */

export const PERSONAL_RELEVANCE_VERSION = 1;

const DIRECT_ORIGINS = new Set(['source', 'top-items']);

// Characterizations that are a real experiential distinction. A standard live
// performance is what a concert listing already implies, so it adds nothing.
const DISTINCT_EXPERIENCES = new Set(['dance_floor', 'festival_multi_stage', 'seated_listening']);

// Only a Choice answer the model was reasonably sure of may carry a claim.
const USABLE_CERTAINTY = new Set(['high', 'moderate']);

// A characterization must rest on descriptive facts the model actually
// received. A start time or a venue name alone is never enough.
const DESCRIPTIVE_MODEL_FACTS = ['classification', 'format', 'namedLineup'];

/**
 * The preference signals available for one candidate, reduced to what a claim
 * may cite. Artist names here are the same names the card already publishes in
 * `matchedArtists`; no playlist, rank, affinity or Spotify identifier is read.
 */
export function preferenceSignalsFor(candidate, preferences = {}) {
  const directArtists = [];
  // Headliners first, so a claim names the act the listing is actually for.
  const matched = [...(candidate?.matchedArtists ?? [])]
    .sort((left, right) => Number(Boolean(right?.primary)) - Number(Boolean(left?.primary)));
  for (const artist of matched) {
    const name = String(artist?.name ?? '').trim();
    if (!name || !DIRECT_ORIGINS.has(artist.origin)) continue;
    if (!directArtists.includes(name)) directArtists.push(name);
  }
  const topTags = [...new Set((preferences?.topTags ?? [])
    .map((tag) => normalizeTag(tag))
    .filter(Boolean))];
  return { directArtists, topTags };
}

/**
 * The event-side attribute a comparison may use: either documented by a source
 * or characterized by Jev from facts it was actually sent.
 *
 * @param {object} facts display-safe facts from `serializeEventEvidenceForDisplay`
 * @param {object} modelFacts model-transmittable facts for the same candidate
 * @param {object|null} assessment validated Jev assessment, if any
 */
export function eventExperienceFor({ facts = {}, modelFacts = {}, assessment = null } = {}) {
  const classifications = listValues(facts.classification?.value);
  if (classifications.some((value) => /\bfestival\b/i.test(value))) {
    return {
      experience: 'festival_multi_stage',
      basis: 'documented-attribute',
      facts: [facts.classification, facts.namedLineup].filter(Boolean)
    };
  }
  const format = textValue(facts.format?.value);
  const documented = format ? formatExperience(format) : null;
  if (documented) return { experience: documented, basis: 'documented-attribute', facts: [facts.format] };

  const characterized = assessment?.experienceCharacter;
  if (!DISTINCT_EXPERIENCES.has(characterized)) return null;
  if (!USABLE_CERTAINTY.has(assessment?.certainty?.experienceCharacter)) return null;
  const grounding = DESCRIPTIVE_MODEL_FACTS.filter((field) => modelFacts[field] != null && facts[field]);
  if (!grounding.length) return null;
  return {
    experience: characterized,
    basis: 'model-characterization',
    characterization: 'experienceCharacter',
    facts: [...grounding, 'startTime'].map((field) => facts[field]).filter(Boolean)
  };
}

/**
 * Compare one candidate's event evidence against the user's preference signals.
 * Returns zero or more claims, strongest first. An empty list is the normal
 * outcome and means the card says nothing personal.
 */
export function assessPersonalRelevance({ candidate, facts = {}, modelFacts = {}, assessment = null, preferences = {} } = {}) {
  const signals = preferenceSignalsFor(candidate, preferences);
  const claims = [];

  const experience = eventExperienceFor({ facts, modelFacts, assessment });
  const artist = signals.directArtists[0];
  if (artist && experience) {
    const text = familiarArtistText(artist, experience.experience, listValues(facts.namedLineup?.value).length);
    if (text) {
      claims.push({
        comparison: 'familiar-artist-in-format',
        text,
        // A calculated match is only as certain as its weaker half. The
        // artist match is exact; the event half may be a model inference.
        status: experience.basis === 'documented-attribute' ? 'verified' : 'inferred',
        basis: 'calculated-match',
        eventBasis: experience.basis,
        ...(experience.characterization ? { characterization: experience.characterization } : {}),
        preference: { signal: 'direct-artist', label: `${artist} is in your selected listening` },
        facts: experience.facts
      });
    }
  }

  // A tag match only matters when no direct artist already explains the fit;
  // otherwise it restates what the card's artist match says.
  if (!artist && signals.topTags.length && facts.classification) {
    const genre = listValues(facts.classification.value)
      .find((value) => classificationTokens(value).some((token) => signals.topTags.includes(token)));
    if (genre) {
      claims.push({
        comparison: 'taste-tag-genre',
        text: `Published as ${genre}, one of the recurring tags in your taste profile.`,
        status: 'verified',
        basis: 'calculated-match',
        eventBasis: 'documented-attribute',
        preference: { signal: 'taste-tag', label: 'Recurring taste-profile tag' },
        facts: [facts.classification]
      });
    }
  }

  return claims;
}

function familiarArtistText(artist, experience, lineupCount) {
  if (experience === 'festival_multi_stage') {
    return lineupCount >= 3
      ? `${artist}, already in your listening, is one of ${lineupCount} named acts on a festival bill.`
      : `${artist}, already in your listening, plays this as part of a festival.`;
  }
  if (experience === 'dance_floor') return `The listing points to a dance-floor set from ${artist}, who is already in your listening.`;
  if (experience === 'seated_listening') return `The listing describes a seated show from ${artist}, who is already in your listening.`;
  return null;
}

function formatExperience(format) {
  if (/\bseated\b|\blistening (?:room|session)\b/i.test(format)) return 'seated_listening';
  if (/\bdj set\b|\bextended set\b|\bopen to close\b|\ball night long\b|\bb2b\b/i.test(format)) return 'dance_floor';
  if (/\bfestival\b/i.test(format)) return 'festival_multi_stage';
  return null;
}

function classificationTokens(value) {
  const whole = normalizeTag(value);
  return [...new Set([whole, ...String(value).split(/[/&,]/).map(normalizeTag)].filter(Boolean))];
}

function normalizeTag(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function listValues(value) {
  if (value == null) return [];
  return (Array.isArray(value) ? value : [value]).map((item) => String(item).trim()).filter(Boolean);
}

function textValue(value) {
  if (value == null) return null;
  if (Array.isArray(value)) return value.join(' · ');
  if (typeof value === 'object') return String(value.local ?? value.value ?? '').trim() || null;
  return String(value).trim() || null;
}

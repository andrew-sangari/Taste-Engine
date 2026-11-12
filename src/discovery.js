import { normalizeArtistName } from './ranking.js';

// Followed promoters widen the candidate pool; they are not preference
// evidence. A roster or calendar artist enters the snapshot with no seed
// strength of its own, so its fit must be earned from evidence about the
// artist or the bill (see promoterAffinityFor in ranking.js) instead of the
// old flat share of the strongest seed that scored every discovery the same.
//
// Shared by the local export and the hosted refresh through the engine bundle.
export function addPromoterEvidence(snapshot, promoterEvents = [], rosterArtists = []) {
  const artists = (snapshot?.artists ?? []).map((artist) => ({ ...artist }));
  const byKey = new Map(artists.map((artist) => [normalizeArtistName(artist.name), artist]));
  const add = (name, promoter, sourceUrl, type) => {
    const key = normalizeArtistName(name);
    if (!key) return;
    const evidence = { type, promoter, sourceUrl: sourceUrl ?? null };
    const existing = byKey.get(key);
    if (existing) {
      // Watchlist membership is recorded on every artist, including ones the
      // taste profile already knows, so a card can say both things truthfully.
      existing.discoveryEvidence = [...(existing.discoveryEvidence ?? [])];
      if (!existing.discoveryEvidence.some((item) => item.type === type && item.promoter === promoter)) {
        existing.discoveryEvidence.push(evidence);
      }
      return;
    }
    const artist = {
      spotifyArtistId: null,
      name: String(name).trim(),
      seedStrength: 0,
      evidence: [],
      origin: 'promoter',
      discoveryEvidence: [evidence]
    };
    byKey.set(key, artist);
    artists.push(artist);
  };
  for (const artist of rosterArtists) add(artist?.name, 'Framework', artist?.sourceUrl, 'framework-roster');
  for (const event of promoterEvents) {
    const promoter = event?.source === 'insomniac' ? 'Insomniac' : 'Framework';
    for (const performer of event?.performers ?? []) add(performer?.name, promoter, event?.sourceUrl, 'promoter-event');
  }
  return { ...snapshot, artists, artistCount: artists.length };
}

// Attach resolved genre tags to discovered artists that have none, so their
// fit can be judged against the scenes the profile is built from. `tags` is a
// Map keyed the way artistTags.js keys it.
export function applyArtistTags(snapshot, tags, keyFor = normalizeArtistName) {
  if (!tags?.size) return snapshot;
  return {
    ...snapshot,
    artists: (snapshot.artists ?? []).map((artist) => {
      if (artist.origin !== 'promoter' || artist.genres?.length) return artist;
      const found = tags.get(keyFor(artist.name));
      return found?.length ? { ...artist, genres: found.slice(0, 12) } : artist;
    })
  };
}

// Names the title parser may use for exact-match decisions.
export function knownArtistNames(snapshot, rosterArtists = []) {
  return [
    ...(snapshot?.artists ?? []).flatMap((artist) => [artist?.name, ...(artist?.aliases ?? [])]),
    ...rosterArtists.map((artist) => artist?.name)
  ].filter(Boolean);
}

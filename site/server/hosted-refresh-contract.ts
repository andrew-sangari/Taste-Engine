export type DirectArtist = {
  spotifyArtistId: string;
  name: string;
  genres: string[];
  playlistDiversity: number;
  weightedTrackCount: number;
  trackCount: number;
  sampleTracks: string[];
  evidence: Array<{ playlistId: string; playlistName: string; weight: number; trackCount: number }>;
  origin?: "source" | "top-items";
  discoveryEvidence?: Array<{ type: "spotify-top-items" }>;
  topEvidence?: {
    shortTermRank: number | null;
    mediumTermRank: number | null;
    longTermRank: number | null;
  };
};

export type HostedPlaylistEvidence = {
  playlistId: string;
  playlistName: string;
  weight: number;
  artists: Array<{
    id: string;
    name: string;
    genres: string[];
    trackCount: number;
    sampleTracks: string[];
  }>;
};

export type HostedTopArtistEvidence = {
  artistId: string;
  artistName: string;
  shortTermRank: number | null;
  mediumTermRank: number | null;
  longTermRank: number | null;
};

export function buildHostedArtistSeed(evidence: HostedPlaylistEvidence[]): DirectArtist[] {
  const artists = new Map<string, DirectArtist>();
  for (const playlist of evidence) {
    for (const artist of playlist.artists) {
      const current = artists.get(artist.id) ?? {
        spotifyArtistId: artist.id,
        name: artist.name,
        genres: [],
        playlistDiversity: 0,
        weightedTrackCount: 0,
        trackCount: 0,
        sampleTracks: [],
        evidence: [],
        origin: "source",
      };
      current.playlistDiversity += playlist.weight;
      current.weightedTrackCount += artist.trackCount * playlist.weight;
      current.trackCount += artist.trackCount;
      current.genres = [...new Set([...current.genres, ...artist.genres])].sort();
      current.sampleTracks = [...new Set([...current.sampleTracks, ...artist.sampleTracks])].slice(0, 6);
      current.evidence.push({
        playlistId: playlist.playlistId,
        playlistName: playlist.playlistName,
        weight: playlist.weight,
        trackCount: artist.trackCount,
      });
      artists.set(artist.id, current);
    }
  }
  return [...artists.values()].sort((left, right) =>
    seedStrength(right) - seedStrength(left) || left.name.localeCompare(right.name)
  );
}

export function mergeHostedTopArtists(
  artists: DirectArtist[],
  topArtists: HostedTopArtistEvidence[],
): void {
  const byId = new Map(artists.map((artist) => [artist.spotifyArtistId, artist]));
  for (const top of topArtists) {
    const artist = byId.get(top.artistId) ?? {
      spotifyArtistId: top.artistId,
      name: top.artistName,
      genres: [],
      playlistDiversity: 0,
      weightedTrackCount: 0,
      trackCount: 0,
      sampleTracks: [],
      evidence: [],
      origin: "top-items" as const,
      discoveryEvidence: [{ type: "spotify-top-items" as const }],
    };
    artist.topEvidence = {
      shortTermRank: top.shortTermRank,
      mediumTermRank: top.mediumTermRank,
      longTermRank: top.longTermRank,
    };
    if (!byId.has(top.artistId)) {
      byId.set(top.artistId, artist);
      artists.push(artist);
    }
  }
  artists.sort((left, right) =>
    seedStrength(right) - seedStrength(left) || left.name.localeCompare(right.name)
  );
}

export function seedStrength(artist: DirectArtist): number {
  return 3 * artist.playlistDiversity + Math.log1p(artist.weightedTrackCount);
}

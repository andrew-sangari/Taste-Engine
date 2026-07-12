import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { loadBriefConfig } from '../src/briefConfig.js';
import { loadEnv } from '../src/env.js';
import { buildExpandedArtistSnapshot } from '../src/tasteExpansion.js';

loadEnv();
loadEnv(resolve('../Playlist Sync/.env'));

const config = await loadBriefConfig(resolve('config/brief.json'));
const source = JSON.parse(await readFile(resolve('data/taste/artists.json'), 'utf8'));
let expanded;
try {
  expanded = process.env.LASTFM_API_KEY
    ? await buildExpandedArtistSnapshot(source, config, { apiKey: process.env.LASTFM_API_KEY })
    : sourceOnlySnapshot(source, 'LASTFM_API_KEY is not configured.');
} catch (error) {
  expanded = sourceOnlySnapshot(source, `Last.fm unavailable: ${error.message}`);
}
const output = resolve('data/taste/expanded-artists.json');
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(expanded, null, 2)}\n`);
console.log(`Expanded ${expanded.sourceArtistCount} source artists to ${expanded.artistCount} candidates using Last.fm (${expanded.warnings.length} warning(s)).`);

function sourceOnlySnapshot(snapshot, warning) {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: 'playlist-sync',
    sourceGeneratedAt: snapshot.generatedAt,
    playlistCount: snapshot.playlistCount,
    sourceArtistCount: snapshot.sourceArtistCount ?? snapshot.artistCount,
    topArtistCount: snapshot.topArtistCount ?? 0,
    artistCount: snapshot.artistCount,
    topTags: [],
    warnings: [warning],
    topItems: snapshot.topItems ?? null,
    artists: (snapshot.artists ?? []).map((artist) => ({
      ...artist,
      origin: artist.origin === 'top-items' ? 'top-items' : 'source',
      discoveryEvidence: [...(artist.discoveryEvidence ?? [])]
    }))
  };
}

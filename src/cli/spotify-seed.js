import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { loadSpotifySeedConfig } from '../config.js';
import { loadEnv } from '../env.js';
import { buildArtistSnapshot, fetchSpotifyPlaylistEvidence, fetchSpotifyTopArtistEvidence } from '../spotifyTaste.js';

loadEnv();

const options = parseArgs(process.argv.slice(2));
const configPath = resolve(options.config ?? 'config/spotify-playlists.json');
const outputPath = resolve(options.output ?? 'data/taste/artists.json');

try {
  const config = await loadSpotifySeedConfig(configPath);
  const evidence = await fetchSpotifyPlaylistEvidence(config);
  const topArtists = await fetchSpotifyTopArtistEvidence(config);
  const snapshot = buildArtistSnapshot({ ...evidence, topArtists });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`Wrote ${snapshot.artistCount} artists from ${snapshot.playlistCount} playlists to ${outputPath}`);
  if (snapshot.warnings.length > 0) {
    console.log(`${snapshot.warnings.length} source warning(s) were preserved in the snapshot.`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--config' || argument === '--output') {
      const value = args[index + 1];
      if (!value) throw new Error(`${argument} requires a value`);
      options[argument.slice(2)] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

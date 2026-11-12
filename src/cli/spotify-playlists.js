// Lists the signed-in user's playlists with ids, for config/spotify-playlists.json.
import { loadEnv } from '../env.js';
import { listSpotifyPlaylists } from '../spotifyClient.js';

loadEnv();

try {
  const args = process.argv.slice(2);
  let limit = 200;
  if (args.length) {
    if (args[0] !== '--limit' || args.length !== 2 || !(Number.isInteger(Number(args[1])) && Number(args[1]) > 0)) {
      throw new Error('Usage: npm run spotify:playlists [-- --limit <count>]');
    }
    limit = Number(args[1]);
  }
  const playlists = await listSpotifyPlaylists(limit);
  for (const playlist of playlists) {
    const tracks = Number.isFinite(Number(playlist.tracks)) ? `${playlist.tracks} tracks` : 'track count unknown';
    console.log(`${playlist.id}\t${playlist.name}\t(${playlist.owner ?? 'unknown owner'}, ${tracks})`);
  }
  console.log(`${playlists.length} playlist(s). Add an entry { "id", "name", "enabled": true, "weight": 1 } to config/spotify-playlists.json, then run \`npm run taste:seed\`.`);
} catch (error) {
  console.error(Number(error?.statusCode) === 401 && !/spotify:connect/.test(error.message)
    ? `Spotify is not connected. Run \`npm run spotify:connect\` first. ${error.message}`
    : error.message);
  process.exitCode = 1;
}

// Deletes the local Spotify token and every Spotify-derived local snapshot.
import { basename } from 'node:path';
import { disconnectSpotify } from '../spotifyClient.js';

const args = process.argv.slice(2);
const confirmIndex = args.indexOf('--confirm');

if (args.length !== 2 || confirmIndex !== 0 || args[1] !== 'DISCONNECT') {
  console.error('This deletes the Spotify token, the artist seed, expanded artists, performer matches, the Top Artists cache and the artist tag cache.');
  console.error('Run: npm run spotify:disconnect -- --confirm DISCONNECT');
  process.exitCode = 1;
} else {
  const result = disconnectSpotify();
  console.log(`Spotify disconnected. Token ${result.tokenRemoved ? 'deleted' : 'was not present'}.`);
  const names = [...new Set(result.removed.map((path) => basename(path)))];
  console.log(names.length ? `Deleted Spotify-derived snapshots: ${names.join(', ')}.` : 'No Spotify-derived snapshots were present.');
  console.log('The accepted projection is unchanged; run `npm run spotify:connect` and `npm run taste:seed` to rebuild the seed.');
}

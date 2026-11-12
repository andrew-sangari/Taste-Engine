// One-time migration: copy an existing Playlist Sync Spotify sign-in into
// Taste Engine's token store so the owner need not re-authorize.
// Prints only success and the granted scopes; never token values.
import { resolve } from 'node:path';
import { importPlaylistSyncToken, SPOTIFY_SCOPES } from '../spotifyClient.js';

try {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--from' || !args[1]) {
    throw new Error('Usage: npm run spotify:import -- --from "<path to Playlist Sync data/tokens.json>"');
  }
  const status = importPlaylistSyncToken(resolve(args[1]));
  console.log(`Spotify sign-in imported. Granted scopes: ${status.grantedScopes.join(', ') || 'none reported'}.`);
  if (status.missingScopes.length) {
    console.log(`Missing scopes: ${status.missingScopes.join(', ')}. Run \`npm run spotify:connect\` to grant them.`);
  }
  if (status.grantedScopes.some((scope) => !SPOTIFY_SCOPES.includes(scope))) {
    console.log('The imported grant carries scopes Taste Engine never uses. `npm run spotify:connect` replaces it with a read-only grant.');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

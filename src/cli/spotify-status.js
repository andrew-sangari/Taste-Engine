// Reports the local Spotify sign-in and Top Artists cache freshness.
// Never prints token values.
import { loadEnv } from '../env.js';
import { getSpotifyAuthStatus, SPOTIFY_SCOPES } from '../spotifyClient.js';
import { readTopArtistsWindowHealth } from '../topArtists.js';

loadEnv();

const status = getSpotifyAuthStatus();
const windows = readTopArtistsWindowHealth();

console.log(`Spotify client id: ${process.env.SPOTIFY_CLIENT_ID ? 'configured' : 'missing (set SPOTIFY_CLIENT_ID in .env)'}`);
console.log(`Connected: ${status.connected ? 'yes' : 'no (run `npm run spotify:connect`)'}`);
console.log(`Required scopes: ${SPOTIFY_SCOPES.join(', ')}`);
console.log(`Granted scopes: ${status.grantedScopes.join(', ') || 'none'}`);
console.log(`Missing scopes: ${status.missingScopes.join(', ') || 'none'}`);
console.log(`Access token expires: ${status.tokenExpiresAt ?? 'n/a'} (refreshed automatically)`);
console.log(`Token last updated: ${status.tokenUpdatedAt ?? 'n/a'}`);
console.log('Top Artists cache:');
for (const [key, window] of Object.entries(windows)) {
  const detail = window.status === 'unavailable'
    ? 'no cached window'
    : `${window.status === 'expired' ? 'expired' : 'valid'}; fetched ${window.fetchedAt ?? 'unknown'}, expires ${window.expiresAt}`;
  console.log(`  ${key}: ${detail}`);
}

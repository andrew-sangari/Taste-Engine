// Signs Taste Engine in to Spotify with PKCE over a short-lived loopback
// server. Requests read-only scopes and stores the token locally.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../env.js';
import { createAuthorizationRequest, createTokenStore, exchangeAuthorizationCode, spotifyRedirectUri } from '../spotifyClient.js';

const CONNECT_TIMEOUT_MS = 5 * 60 * 1000;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export async function runSpotifyConnect({
  clientId = process.env.SPOTIFY_CLIENT_ID,
  redirectUri = spotifyRedirectUri(),
  tokenStore = createTokenStore(),
  fetchImpl = fetch,
  open = true,
  openUrl = openInBrowser,
  timeoutMs = CONNECT_TIMEOUT_MS,
  log = console.log
} = {}) {
  if (!clientId) throw new Error('Set SPOTIFY_CLIENT_ID in .env first.');
  const redirect = new URL(redirectUri);
  if (redirect.protocol !== 'http:' || !LOOPBACK_HOSTS.has(redirect.hostname)) {
    throw new Error('SPOTIFY_REDIRECT_URI must be an http loopback address (127.0.0.1, localhost or [::1]) for the local sign-in.');
  }
  const port = Number(redirect.port || 80);
  const host = redirect.hostname.replace(/^\[|\]$/g, '');
  const request = createAuthorizationRequest({ clientId, redirectUri });

  return new Promise((resolvePromise, reject) => {
    let settled = false;
    const server = createServer((req, res) => {
      const url = new URL(req.url, redirectUri);
      if (req.method !== 'GET' || url.pathname !== redirect.pathname) {
        return page(res, 404, 'Not found.');
      }
      const error = url.searchParams.get('error');
      if (error) {
        page(res, 400, 'Spotify authorization was not granted. You can close this tab.');
        return finish(new Error(`Spotify authorization failed: ${error}. Run \`npm run spotify:connect\` again and approve the request.`));
      }
      if (url.searchParams.get('state') !== request.state) {
        // A stray or replayed callback does not end the sign-in in progress.
        return page(res, 400, 'This callback does not belong to the current sign-in. Use the link printed by the latest `npm run spotify:connect`.');
      }
      const code = url.searchParams.get('code');
      if (!code) return page(res, 400, 'Spotify callback did not include a code.');
      exchangeAuthorizationCode({ code, verifier: request.verifier, clientId, redirectUri, fetchImpl, tokenStore })
        .then((status) => {
          page(res, 200, 'Taste Engine is connected to Spotify. You can close this tab.');
          finish(null, status);
        })
        .catch((exchangeError) => {
          page(res, 502, 'Spotify sign-in could not be completed. Check the terminal and try again.');
          finish(exchangeError);
        });
    });

    const timer = setTimeout(() => {
      finish(new Error(`No Spotify authorization arrived within ${Math.round(timeoutMs / 60000)} minutes. Run \`npm run spotify:connect\` again and approve the request in the browser. The redirect URI ${redirectUri} must be registered for this Spotify app.`));
    }, timeoutMs);

    function finish(error, status) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      server.closeAllConnections?.();
      if (error) reject(error);
      else resolvePromise(status);
    }

    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        return finish(new Error(`Something else is listening on ${port} — stop Playlist Sync (or whatever holds the port) and run \`npm run spotify:connect\` again.`));
      }
      finish(new Error(`Could not start the local sign-in server on ${host}:${port} (${error.code ?? error.message}).`));
    });

    server.listen(port, host, () => {
      log('Open this link to connect Spotify (read-only playlist and Top Artists access):');
      log(request.url);
      log(`Waiting for the callback on ${redirectUri} ...`);
      if (open) openUrl(request.url);
    });
  });
}

function page(res, statusCode, message) {
  res.writeHead(statusCode, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', connection: 'close' });
  res.end(`<!doctype html><meta charset="utf-8"><title>Taste Engine</title><p style="font: 16px system-ui; margin: 3rem">${escapeHtml(message)}</p>`);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

function openInBrowser(url) {
  if (process.platform !== 'darwin') return;
  try {
    const child = spawn('open', [url], { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // The link is printed above; opening it is a convenience only.
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  loadEnv();
  const args = process.argv.slice(2);
  const unknown = args.filter((argument) => argument !== '--no-open');
  if (unknown.length) {
    console.error(`Unknown argument: ${unknown[0]}`);
    process.exitCode = 1;
  } else {
    try {
      const status = await runSpotifyConnect({ open: !args.includes('--no-open') });
      console.log(`Spotify connected. Granted scopes: ${status.grantedScopes.join(', ') || 'none reported'}.`);
      if (status.missingScopes.length) console.log(`Missing scopes: ${status.missingScopes.join(', ')}.`);
      console.log('Next: `npm run spotify:playlists` to list playlist ids, then `npm run taste:seed`.');
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}

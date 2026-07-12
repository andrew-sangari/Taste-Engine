import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const startedAt = Date.now();

try {
  const spotifyStartedAt = Date.now();
  await run(process.execPath, ['src/cli/spotify-seed.js']);
  await run(process.execPath, ['scripts/expand-taste.js']);
  printTiming('Spotify/Last.fm', Date.now() - spotifyStartedAt);

  await run(process.execPath, ['scripts/export-site-data.js']);

  const siteStartedAt = Date.now();
  await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: resolve(root, 'site') });
  printTiming('Next build', Date.now() - siteStartedAt);
  printTiming('Total', Date.now() - startedAt);
} catch (error) {
  console.error(`\nSite build stopped: ${error.message}`);
  process.exitCode = 1;
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? root,
      env: process.env,
      stdio: 'inherit'
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) return resolvePromise();
      reject(new Error(`${command} ${args.join(' ')} exited with ${signal ? `signal ${signal}` : `code ${code}`}`));
    });
  });
}

function printTiming(label, elapsedMs) {
  console.log(`${label.padEnd(21)} ${formatSeconds(elapsedMs)}`);
}

function formatSeconds(elapsedMs) {
  return `${(elapsedMs / 1000).toFixed(1)}s`;
}

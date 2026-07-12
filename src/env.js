import { existsSync, readFileSync } from 'node:fs';

export function loadEnv(file = '.env', target = process.env) {
  if (!existsSync(file)) return target;

  for (const [key, value] of parseEnv(readFileSync(file, 'utf8'))) {
    if (!(key in target)) target[key] = value;
  }
  return target;
}

export function parseEnv(content) {
  const entries = [];
  for (const line of String(content).split(/\r?\n/)) {
    let trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('export ')) trimmed = trimmed.slice(7).trim();

    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    entries.push([key, value.replaceAll('\\n', '\n')]);
  }
  return entries;
}

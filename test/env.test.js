import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadEnv, parseEnv } from '../src/env.js';

test('parses comments, export syntax, quotes, and embedded equals signs', () => {
  assert.deepEqual(parseEnv(`
# comment
PLAIN=value
export QUOTED="two words"
TOKEN=abc=123
`), [
    ['PLAIN', 'value'],
    ['QUOTED', 'two words'],
    ['TOKEN', 'abc=123']
  ]);
});

test('loads an env file without overwriting existing environment values', () => {
  const directory = mkdtempSync(join(tmpdir(), 'taste-engine-env-'));
  const path = join(directory, '.env');
  writeFileSync(path, 'EXISTING=file\nNEW_VALUE=loaded\n');
  const target = { EXISTING: 'shell' };

  loadEnv(path, target);

  assert.deepEqual(target, { EXISTING: 'shell', NEW_VALUE: 'loaded' });
});

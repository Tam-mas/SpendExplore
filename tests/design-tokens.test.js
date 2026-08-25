import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../web/style.css', import.meta.url), 'utf8');

test('no external font or asset host is referenced', () => {
  // The privacy guarantee outranks every aesthetic preference here.
  assert.doesNotMatch(css, /@import/);
  assert.doesNotMatch(css, /https?:\/\//);
  assert.doesNotMatch(css, /url\((?!['"]?data:)/);
});

test('the type and space scales are defined as tokens', () => {
  for (const token of ['--step--1', '--step-0', '--step-1', '--step-2', '--step-3', '--step-4']) {
    assert.match(css, new RegExp(`${token}\\s*:`), `missing type token ${token}`);
  }
  for (const token of ['--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6']) {
    assert.match(css, new RegExp(`${token}\\s*:`), `missing space token ${token}`);
  }
});

test('a monospace figure stack is defined and used for numbers', () => {
  assert.match(css, /--font-mono\s*:/);
  assert.match(css, /font-variant-numeric:\s*tabular-nums/);
});

test('every colour token defined in light mode is redefined in dark mode', () => {
  const darkBlock = css.slice(css.indexOf('prefers-color-scheme: dark'));
  const colourTokens = [...css.matchAll(/(--(?:bg|fg|muted|line|accent|warn|bar|surface-raised|viz-[a-z-]+))\s*:/g)]
    .map((m) => m[1]);
  const missing = [...new Set(colourTokens)].filter((token) => !darkBlock.includes(`${token}:`));
  assert.deepEqual(missing, [], `colour tokens with no dark-mode definition: ${missing.join(', ')}`);
});

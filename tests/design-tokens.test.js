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

/**
 * Extract the body of every `@media (prefers-color-scheme: dark) { ... }`
 * block by brace-matching, rather than slicing from the first match to EOF.
 *
 * Slicing to EOF was the bug: it swept the LIGHT chart `:root` block (which
 * sits further down style.css, after the first dark block) into what the
 * test treated as "dark," so a token missing from the real dark block could
 * still pass by matching its own light-mode declaration. Verified by
 * mutation — see the report for the delete/confirm-fail/restore steps.
 */
function extractDarkBlocks(source) {
  const blocks = [];
  const marker = '@media (prefers-color-scheme: dark)';
  let searchFrom = 0;
  for (;;) {
    const markerIndex = source.indexOf(marker, searchFrom);
    if (markerIndex === -1) break;
    const openBrace = source.indexOf('{', markerIndex);
    let depth = 1;
    let i = openBrace + 1;
    while (depth > 0 && i < source.length) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') depth--;
      i++;
    }
    blocks.push(source.slice(openBrace + 1, i - 1));
    searchFrom = i;
  }
  return blocks;
}

test('every colour token defined in light mode is redefined in dark mode', () => {
  const darkContent = extractDarkBlocks(css).join('\n');
  const colourTokens = [...css.matchAll(/(--(?:bg|fg|muted|line|accent|warn|bar|surface-raised|viz-[a-z-]+))\s*:/g)]
    .map((m) => m[1]);
  const missing = [...new Set(colourTokens)].filter((token) => !darkContent.includes(`${token}:`));
  assert.deepEqual(missing, [], `colour tokens with no dark-mode definition: ${missing.join(', ')}`);
});

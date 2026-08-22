import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../lib/csv-parse.js';

test('parses plain rows', () => {
  assert.deepEqual(parseCsv('a,b,c\n1,2,3'), [['a','b','c'], ['1','2','3']]);
});

test('preserves commas inside quoted fields', () => {
  const row = parseCsv('22/08/2026,"COLES, COBURG","-10.00"')[0];
  assert.deepEqual(row, ['22/08/2026', 'COLES, COBURG', '-10.00']);
});

test('handles escaped double quotes', () => {
  assert.deepEqual(parseCsv('"DAN MURPHY""S"')[0], ['DAN MURPHY"S']);
});

test('handles CRLF line endings', () => {
  assert.deepEqual(parseCsv('a,b\r\nc,d'), [['a','b'], ['c','d']]);
});

test('ignores a trailing newline', () => {
  assert.equal(parseCsv('a,b\n').length, 1);
});

test('keeps empty fields', () => {
  assert.deepEqual(parseCsv('a,,c')[0], ['a', '', 'c']);
});

test('returns empty array for empty input', () => {
  assert.deepEqual(parseCsv('   '), []);
});

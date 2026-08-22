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

test('treats a bare quote mid-field as a literal character', () => {
  assert.deepEqual(parseCsv('a"b,c')[0], ['a"b', 'c']);
});

test('strips a leading UTF-8 BOM', () => {
  assert.deepEqual(parseCsv('﻿Date,Amount')[0], ['Date', 'Amount']);
});

test('drops a fully blank line between rows', () => {
  assert.deepEqual(parseCsv('a,b\n\nc,d'), [['a', 'b'], ['c', 'd']]);
});

test('drops a whitespace-only line between rows', () => {
  assert.deepEqual(parseCsv('a,b\n   \nc,d'), [['a', 'b'], ['c', 'd']]);
});

test('keeps a line of only empty fields as a real row', () => {
  assert.deepEqual(parseCsv('a,b\n,\nc,d')[1], ['', '']);
});

test('keeps a quoted empty field as a real row', () => {
  assert.deepEqual(parseCsv('a,b\n""\nc,d')[1], ['']);
});

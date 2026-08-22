import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseCsvWithLines } from '../lib/csv-parse.js';

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

test('parseCsvWithLines reports sequential physical line numbers for plain rows', () => {
  const records = parseCsvWithLines('a,b\nc,d\ne,f');
  assert.deepEqual(records.map((r) => r.line), [1, 2, 3]);
});

test('parseCsvWithLines advances the line number across a dropped blank line', () => {
  const records = parseCsvWithLines('a,b\n\nc,d');
  // Physical line 2 is blank and dropped; "c,d" genuinely starts on line 3.
  assert.deepEqual(records.map((r) => r.line), [1, 3]);
});

test('parseCsvWithLines reports the STARTING line of a record with an embedded newline, and the next record\'s true line after it', () => {
  const records = parseCsvWithLines('a,b\n"line1\nline2",c\nd,e');
  assert.equal(records.length, 3);
  assert.equal(records[0].line, 1);          // a,b
  assert.equal(records[1].line, 2);          // "line1\nline2",c -- starts on line 2
  assert.equal(records[1].fields[0], 'line1\nline2');
  assert.equal(records[2].line, 4);          // d,e is on physical line 4, not 3
});

test('parseCsv is a plain fields-only projection of parseCsvWithLines', () => {
  const text = 'a,b\n\nc,d';
  assert.deepEqual(parseCsv(text), parseCsvWithLines(text).map((r) => r.fields));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sniffFormat, parseDate, parseAmount } from '../lib/format-sniff.js';
import { parseCsv } from '../lib/csv-parse.js';

const SAMPLE = parseCsv([
  '22/08/2026,"MYKI PAYMENTS MELBOURNE  AUS Card xx8765","Everyday Account","Auto & transport","-10.00"',
  '18/08/2026,"COLES 0592 COBURG VI AUS Card xx4321","Everyday Account","Groceries & household","-64.15"',
  '11/08/2026,"CITY DIAGNOSTICS GREENWICH  AUS","Everyday Account","Uncategorised","-286.48"'
].join('\n'));

test('detects the 5-column CommBank layout', () => {
  const f = sniffFormat(SAMPLE);
  assert.equal(f.hasHeader, false);
  assert.deepEqual(f.mapping, { date: 0, description: 1, account: 2, category: 3, amount: 4 });
  assert.equal(f.dateFormat, 'DD/MM/YYYY');
  assert.equal(f.spendSign, 'negative');
});

test('detects the 4-column Date,Amount,Description,Balance layout', () => {
  const rows = parseCsv([
    '22/08/2026,"-10.00","MYKI PAYMENTS MELBOURNE","1234.00"',
    '18/08/2026,"-64.15","COLES 0592 COBURG","1298.15"'
  ].join('\n'));
  const f = sniffFormat(rows);
  assert.equal(f.mapping.date, 0);
  assert.equal(f.mapping.amount, 1);
  assert.equal(f.mapping.description, 2);
  assert.equal(f.mapping.account, null);
  assert.equal(f.mapping.category, null);
});

test('detects a header row and does not treat it as data', () => {
  const rows = parseCsv('Date,Description,Amount\n22/08/2026,"COLES","-10.00"');
  const f = sniffFormat(rows);
  assert.equal(f.hasHeader, true);
  assert.equal(f.mapping.date, 0);
  assert.equal(f.mapping.amount, 2);
});

test('detects positive-spend convention', () => {
  const rows = parseCsv('22/08/2026,"COLES","10.00"\n18/08/2026,"ALDI","64.15"\n17/08/2026,"MYKI","7.35"');
  assert.equal(sniffFormat(rows).spendSign, 'positive');
});

test('flags ambiguous day/month order as low confidence', () => {
  const rows = parseCsv('05/08/2026,"COLES","-10.00"\n03/07/2026,"ALDI","-64.15"');
  const f = sniffFormat(rows);
  assert.equal(f.dateFormat, 'DD/MM/YYYY');
  assert.equal(f.dateFormatConfidence, 'low');
});

test('resolves day/month order when a day exceeds 12', () => {
  const rows = parseCsv('22/08/2026,"COLES","-10.00"\n03/07/2026,"ALDI","-64.15"');
  const f = sniffFormat(rows);
  assert.equal(f.dateFormat, 'DD/MM/YYYY');
  assert.equal(f.dateFormatConfidence, 'high');
});

test('detects ISO dates', () => {
  const rows = parseCsv('2026-08-22,"COLES","-10.00"');
  assert.equal(sniffFormat(rows).dateFormat, 'YYYY-MM-DD');
});

test('parseDate converts to ISO', () => {
  assert.equal(parseDate('22/08/2026', 'DD/MM/YYYY'), '2026-08-22');
  assert.equal(parseDate('2026-08-22', 'YYYY-MM-DD'), '2026-08-22');
  assert.equal(parseDate('08/22/2026', 'MM/DD/YYYY'), '2026-08-22');
});

test('parseDate rejects impossible dates', () => {
  assert.equal(parseDate('32/08/2026', 'DD/MM/YYYY'), null);
  assert.equal(parseDate('not a date', 'DD/MM/YYYY'), null);
});

test('parseAmount strips currency symbols and separators', () => {
  assert.equal(parseAmount('-64.15'), -64.15);
  assert.equal(parseAmount('$1,404.01'), 1404.01);
  assert.equal(parseAmount('(25.11)'), -25.11);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('abc'), null);
});

test('parseAmount accepts a bare leading decimal point', () => {
  assert.equal(parseAmount('.50'), 0.5);
});

test('parseAmount rejects a string too long to be a real amount, without hanging', () => {
  const start = performance.now();
  assert.equal(parseAmount('1'.repeat(40)), null);
  assert.equal(parseAmount('9'.repeat(100000) + 'x'), null);
  assert.ok(performance.now() - start < 200, 'parseAmount should reject an oversized string near-instantly, not backtrack over it');
});

// --- Fix wave: review findings ---

test('picks the transaction column over the balance column on a credit-card layout (positive charges, negative running balance)', () => {
  const rows = parseCsv([
    '22/08/2026,"COLES",50.00,-200.00',
    '18/08/2026,"ALDI",30.00,-250.00',
    '11/08/2026,"MYKI",7.35,-280.00'
  ].join('\n'));
  const f = sniffFormat(rows);
  assert.equal(f.mapping.amount, 2);
});

test('picks the transaction column over the balance column on an overdrawn account (both columns negative, balance nearer zero)', () => {
  const rows = parseCsv([
    '22/08/2026,"COLES",-8.00,-3.00',
    '18/08/2026,"ALDI",-14.00,-11.00'
  ].join('\n'));
  const f = sniffFormat(rows);
  assert.equal(f.mapping.amount, 2);
});

test('detects a header row when the date is not in column 0', () => {
  const rows = parseCsv([
    'Bank Account,Date,Narrative,Amount,Balance',
    'Everyday,22/08/2026,"COLES","-10.00","1234.00"',
    'Everyday,18/08/2026,"ALDI","-64.15","1244.00"',
    'Everyday,11/08/2026,"MYKI","-7.35","1308.15"'
  ].join('\n'));
  const f = sniffFormat(rows);
  assert.equal(f.hasHeader, true);
  assert.equal(f.mapping.date, 1);
  assert.equal(f.mapping.amount, 3);
});

test('throws when the file is a single header-shaped row with no data', () => {
  const rows = parseCsv('Date,Description,Amount');
  assert.throws(() => sniffFormat(rows), /header but no data rows/);
});

test('picks the merchant column as description even when the account name is longer', () => {
  const rows = parseCsv([
    '22/08/2026,"ALDI 3","Joint Everyday Transaction Account"',
    '18/08/2026,"COLES 5","Joint Everyday Transaction Account"',
    '11/08/2026,"MYKI","Joint Everyday Transaction Account"'
  ].join('\n'));
  const f = sniffFormat(rows);
  assert.equal(f.mapping.description, 1);
});

test('does not label a bank category column as account when it is the only leftover text column', () => {
  const rows = parseCsv('Date,Description,Category,Amount\n22/08/2026,"COLES","Groceries","-10.00"\n18/08/2026,"ALDI","Groceries","-64.15"');
  const f = sniffFormat(rows);
  assert.equal(f.mapping.account, null);
});

test('flags a self-contradictory date column (mixed DD/MM and MM/DD rows) as low confidence', () => {
  const rows = parseCsv('22/08/2026,"COLES","-10.00"\n08/22/2026,"ALDI","-64.15"');
  const f = sniffFormat(rows);
  assert.equal(f.dateFormatConfidence, 'low');
});

test('parseAmount rejects European decimal-comma and space-grouped forms instead of misparsing them', () => {
  assert.equal(parseAmount('1.404,01'), null);
  assert.equal(parseAmount('1 404,01'), null);
  assert.equal(parseAmount('$1,404.01'), 1404.01);
});

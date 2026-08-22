import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ingest } from '../lib/ingest.js';

const RULES = [
  { match: 'contains', value: 'coles',       categoryId: 'groceries' },
  { match: 'contains', value: 'myki',        categoryId: 'public-transport' },
  { match: 'contains', value: 'diagnostics', categoryId: 'doctors' },
  { match: 'contains', value: 'transfer to', categoryId: 'transfers' }
];

const loadFixture = () =>
  readFile(new URL('./fixtures/sample-commbank.csv', import.meta.url), 'utf8');

const run = async (overrides = {}) => ingest({
  text: await loadFixture(),
  accountId: 'spending',
  importId: 'imp_test_001',
  rules: RULES,
  existingIds: new Set(),
  existingMerchants: new Set(),
  ...overrides
});

test('reads every row and builds a transaction for each', async () => {
  const r = await run();
  assert.equal(r.summary.rowsRead, 6);
  assert.equal(r.transactions.length, 6);
  assert.equal(r.malformed.length, 0);
});

test('normalises dates to ISO and keeps the raw description', async () => {
  const t = (await run()).transactions[0];
  assert.equal(t.date, '2026-08-22');
  assert.match(t.rawDescription, /^MYKI PAYMENTS MELBOURNE/);
  assert.equal(t.merchant, 'Myki Payments');
  assert.equal(t.cardSuffix, '8765');
  assert.equal(t.accountId, 'spending');
  assert.equal(t.importId, 'imp_test_001');
  assert.equal(t.excluded, false);
  assert.equal(t.note, null);
});

test('spend is stored as a negative number', async () => {
  const r = await run();
  assert.ok(r.transactions.every((t) => t.amount < 0));
  assert.equal(r.summary.totalSpend, -514.52);
  assert.equal(r.summary.totalIncome, 0);
});

test('ignores the bank supplied category column', async () => {
  const r = await run();
  const virtus = r.transactions.find((t) => t.merchant.startsWith('City Diagnostics'));
  // The bank called this "Uncategorised"; our rules call it doctors.
  assert.equal(virtus.categoryId, 'doctors');
  assert.equal(virtus.categorySource, 'rule');
});

test('unmatched merchants are flagged for review', async () => {
  const r = await run();
  const rong = r.transactions.find((t) => t.merchant === 'Sunshine Deli');
  assert.equal(rong.categoryId, 'uncategorised');
  assert.equal(rong.categorySource, 'unknown');
  assert.equal(r.summary.needsReview, 1);
  assert.equal(r.summary.autoCategorised, 5);
});

test('reports the date range', async () => {
  const r = await run();
  assert.equal(r.summary.dateFrom, '2026-08-11');
  assert.equal(r.summary.dateTo, '2026-08-22');
});

test('re-importing the same file adds nothing', async () => {
  const first = await run();
  const second = await run({ existingIds: new Set(first.transactions.map((t) => t.id)) });
  assert.equal(second.transactions.length, 0);
  assert.equal(second.summary.added, 0);
  assert.equal(second.summary.duplicates, 6);
});

test('the two same-day Coles rows both survive', async () => {
  const r = await run();
  const coles = r.transactions.filter((t) => t.merchant === 'Coles');
  assert.equal(coles.length, 2);
  assert.equal(new Set(coles.map((t) => t.id)).size, 2);
});

test('malformed rows are skipped with a reason, not fatal', async () => {
  const text = await loadFixture() + '\nnot-a-date,"BROKEN ROW","acct","cat","abc"\n';
  const r = await ingest({
    text, accountId: 'spending', importId: 'imp_test_002', rules: RULES,
    existingIds: new Set(), existingMerchants: new Set()
  });
  assert.equal(r.transactions.length, 6);
  assert.equal(r.malformed.length, 1);
  assert.match(r.malformed[0].reason, /date|amount/i);
  assert.equal(r.malformed[0].line, 7);
});

test('a positive-spend file is normalised to negative', async () => {
  const text = '22/08/2026,"COLES 0592 COBURG","64.15"\n21/08/2026,"MYKI PAYMENTS","10.00"';
  const r = await ingest({
    text, accountId: 'card', importId: 'imp_test_003', rules: RULES,
    existingIds: new Set(), existingMerchants: new Set()
  });
  assert.equal(r.format.spendSign, 'positive');
  assert.ok(r.transactions.every((t) => t.amount < 0));
  assert.equal(r.summary.totalSpend, -74.15);
});

test('a mapping override wins over sniffing', async () => {
  const text = '22/08/2026,"COLES 0592 COBURG","acct","cat","-64.15"';
  const r = await ingest({
    text, accountId: 'spending', importId: 'imp_test_004', rules: RULES,
    existingIds: new Set(), existingMerchants: new Set(),
    mappingOverride: {
      mapping: { date: 0, description: 1, account: 2, category: 3, amount: 4 },
      dateFormat: 'DD/MM/YYYY', spendSign: 'negative', hasHeader: false
    }
  });
  assert.equal(r.transactions[0].merchant, 'Coles');
});

// --- Additional tests beyond the brief ---

test('preview and commit equivalence: calling ingest() twice with identical arguments returns deeply equal results', async () => {
  const args = {
    text: await loadFixture(),
    accountId: 'spending',
    importId: 'imp_test_005',
    rules: RULES,
    existingIds: new Set(),
    existingMerchants: new Set()
  };
  const preview = ingest(args);
  const commit = ingest(args);
  assert.deepEqual(preview, commit);
});

test('a file where every row is malformed returns no transactions but a populated malformed list, without throwing', async () => {
  const text = 'not-a-date,"BROKEN ONE","acct","cat","abc"\nalso-bad,"BROKEN TWO","acct","cat","xyz"\n';
  assert.doesNotThrow(() => {
    const r = ingest({
      text, accountId: 'spending', importId: 'imp_test_006', rules: RULES,
      existingIds: new Set(), existingMerchants: new Set()
    });
    assert.equal(r.transactions.length, 0);
    assert.equal(r.malformed.length, 2);
  });
});

test('rawDescription is byte-identical to the source CSV field, including surrounding whitespace', async () => {
  const text = '22/08/2026," COLES 0592 COBURG  ","acct","cat","-64.15"';
  const r = ingest({
    text, accountId: 'spending', importId: 'imp_test_007', rules: RULES,
    existingIds: new Set(), existingMerchants: new Set()
  });
  assert.equal(r.transactions[0].rawDescription, ' COLES 0592 COBURG  ');
});

test('a refund for a merchant with prior spend in the SAME file nets to that category instead of becoming income', async () => {
  const text =
    '18/08/2026,"COLES 0592 COBURG VI AUS Card xx4321","acct","cat","-64.15"\n' +
    '19/08/2026,"COLES 0592 COBURG VI AUS Card xx4321","acct","cat","20.00"\n';
  const r = ingest({
    text, accountId: 'spending', importId: 'imp_test_008', rules: RULES,
    existingIds: new Set(), existingMerchants: new Set()
  });
  const refund = r.transactions.find((t) => t.amount > 0);
  assert.equal(refund.categoryId, 'groceries');
  assert.equal(refund.categorySource, 'rule');
});

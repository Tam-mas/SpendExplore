import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderRecurring } from '../web/recurring-view.js';

const t = (over) => ({
  id: 'x', date: '2026-08-15', amount: -16.99, rawDescription: 'R', merchant: 'Netflix',
  accountId: 'a', cardSuffix: null, categoryId: 'subscriptions', categorySource: 'rule',
  excluded: false, importId: 'i', note: null, ...over
});

const series = (merchant, amount, months) => months.map((m, i) =>
  t({ id: `${merchant}${i}`, merchant, amount, date: `${m}-15` }));

const snapshotOf = (transactions, recurring = []) => ({
  transactions, recurring, accounts: [],
  categories: {
    groups: [{ id: 'lifestyle', label: 'Lifestyle' }],
    categories: [{ id: 'subscriptions', label: 'Subscriptions', groupId: 'lifestyle' }]
  }
});

const TODAY = { today: '2026-08-24' };

test('an empty ledger explains itself instead of rendering an empty table', () => {
  const html = renderRecurring(snapshotOf([]), TODAY);
  assert.match(html, /Nothing recurring/);
  assert.equal(html.includes('<table'), false);
});

test('the header states the total commitment in both monthly and annual terms', () => {
  const html = renderRecurring(snapshotOf([
    ...series('Netflix', -16.99, ['2026-06', '2026-07', '2026-08']),
    ...series('Spotify', -13.99, ['2026-06', '2026-07', '2026-08'])
  ]), TODAY);
  assert.match(html, /\$30\.98/);
  assert.match(html, /\$371\.76/);
  assert.match(html, /2 active/);
});

test('each row shows cadence, current price, annual cost and next expected date', () => {
  const html = renderRecurring(snapshotOf(series('Netflix', -16.99, ['2026-06', '2026-07', '2026-08'])), TODAY);
  assert.match(html, /Netflix/);
  assert.match(html, /Monthly/);
  assert.match(html, /\$16\.99/);
  assert.match(html, /\$203\.88/);
  assert.match(html, /2026-09-14/);
});

test('a price change is called out with both prices', () => {
  const html = renderRecurring(snapshotOf([
    t({ id: 'n1', amount: -16.99, date: '2026-05-15' }),
    t({ id: 'n2', amount: -16.99, date: '2026-06-15' }),
    t({ id: 'n3', amount: -18.99, date: '2026-07-15' }),
    t({ id: 'n4', amount: -18.99, date: '2026-08-15' })
  ]), TODAY);
  assert.match(html, /recurring-price-change/);
  assert.match(html, /\$16\.99/);
  assert.match(html, /\$18\.99/);
});

test('a dormant series is separated out and labelled with how long it has been quiet', () => {
  const html = renderRecurring(snapshotOf([
    ...series('Netflix', -16.99, ['2026-06', '2026-07', '2026-08']),
    ...series('OldGym', -60, ['2026-01', '2026-02', '2026-03'])
  ]), TODAY);
  assert.match(html, /Gone quiet/);
  assert.match(html, /OldGym/);
});

test('a variable bill shows its range rather than a single fixed price', () => {
  const html = renderRecurring(snapshotOf([
    t({ id: 'e1', merchant: 'AGL', amount: -180, date: '2025-11-01' }),
    t({ id: 'e2', merchant: 'AGL', amount: -260, date: '2026-02-01' }),
    t({ id: 'e3', merchant: 'AGL', amount: -195, date: '2026-05-01' }),
    t({ id: 'e4', merchant: 'AGL', amount: -240, date: '2026-08-01' })
  ]), TODAY);
  assert.match(html, /\$180\.00\s*–\s*\$260\.00/);
});

test('a merchant name from a bank CSV is escaped, never injected as markup', () => {
  const html = renderRecurring(snapshotOf(
    series('<img src=x onerror=alert(1)>', -9.99, ['2026-06', '2026-07', '2026-08'])
  ), TODAY);
  assert.equal(html.includes('<img src=x'), false);
  assert.match(html, /&lt;img src=x/);
});

test('an ignored merchant does not appear and does not count', () => {
  const html = renderRecurring(
    snapshotOf(series('Netflix', -16.99, ['2026-06', '2026-07', '2026-08']),
      [{ merchant: 'Netflix', decision: 'ignored' }]),
    TODAY
  );
  assert.match(html, /Nothing recurring/);
});

test('every row carries the merchant key needed to drill down and to override', () => {
  const html = renderRecurring(snapshotOf(series('Netflix', -16.99, ['2026-06', '2026-07', '2026-08'])), TODAY);
  assert.match(html, /data-recurring-merchant="Netflix"/);
  assert.match(html, /data-recurring-action="ignore"/);
});

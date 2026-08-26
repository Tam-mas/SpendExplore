import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSettings, cardSuffixesForAccount } from '../web/settings-view.js';

const t = (over) => ({
  id: 'x', date: '2026-08-10', amount: -10, rawDescription: 'R', merchant: 'M',
  accountId: 'default', cardSuffix: null, categoryId: 'groceries', categorySource: 'rule',
  excluded: false, importId: 'i', note: null, ...over
});

const SNAPSHOT = {
  accounts: [
    { id: 'default', label: 'default', cardOwners: { '5611': 'Alex' } },
    { id: 'CC', label: 'CC' }
  ],
  categories: { groups: [], categories: [] },
  transactions: [
    t({ id: 'a', accountId: 'default', cardSuffix: '5611' }),
    t({ id: 'b', accountId: 'default', cardSuffix: '5603' }),
    t({ id: 'c', accountId: 'default', cardSuffix: '5611' }), // duplicate suffix — must not repeat
    t({ id: 'd', accountId: 'default', cardSuffix: null }),   // no-card row — must not become a suffix
    t({ id: 'e', accountId: 'CC', cardSuffix: null })
  ]
};

test('cardSuffixesForAccount returns every distinct suffix seen for that account, sorted, no duplicates', () => {
  assert.deepEqual(cardSuffixesForAccount(SNAPSHOT, 'default'), ['5603', '5611']);
});

test('cardSuffixesForAccount ignores transactions with no card suffix', () => {
  assert.deepEqual(cardSuffixesForAccount(SNAPSHOT, 'CC'), []);
});

test('cardSuffixesForAccount ignores another account\'s suffixes entirely', () => {
  const suffixes = cardSuffixesForAccount(SNAPSHOT, 'default');
  assert.equal(suffixes.includes('9999'), false);
});

test('cardSuffixesForAccount returns an empty array for an unknown account id', () => {
  assert.deepEqual(cardSuffixesForAccount(SNAPSHOT, 'nope'), []);
});

test('renders one section per account, with its current label as the input value', () => {
  const html = renderSettings(SNAPSHOT);
  assert.match(html, /data-account-id="default"/);
  assert.match(html, /data-account-id="CC"/);
  assert.match(html, /value="default"/);
  assert.match(html, /value="CC"/);
});

test('a card suffix row pre-fills the existing owner name, and an unmapped suffix is blank', () => {
  const html = renderSettings(SNAPSHOT);
  assert.match(html, /data-card-suffix="5611"[^>]*value="Alex"/s);
  assert.match(html, /data-card-suffix="5603"[^>]*value=""/s);
});

test('an account with no observed card suffixes explains itself instead of showing an empty table', () => {
  const html = renderSettings(SNAPSHOT);
  const ccSection = html.slice(html.indexOf('data-account-id="CC"'));
  assert.match(ccSection, /no card numbers/i);
});

test('a label containing markup is escaped, not injected', () => {
  const hostile = {
    ...SNAPSHOT,
    accounts: [{ id: 'x', label: '<img src=x onerror=alert(1)>' }]
  };
  const html = renderSettings(hostile);
  assert.equal(html.includes('<img src=x'), false);
  assert.match(html, /&lt;img src=x/);
});

test('a card-owner name containing markup is escaped, not injected', () => {
  const hostile = {
    ...SNAPSHOT,
    accounts: [{ id: 'default', label: 'default', cardOwners: { '5611': '<script>alert(1)</script>' } }]
  };
  const html = renderSettings(hostile);
  assert.equal(html.includes('<script>alert'), false);
});

test('every save button and input carries the account id needed to submit it', () => {
  const html = renderSettings(SNAPSHOT);
  assert.match(html, /data-settings-action="save"[^>]*data-account-id="default"/);
});

test('the theme control reflects the current preference passed in state', () => {
  const html = renderSettings(SNAPSHOT, { theme: 'dark' });
  assert.match(html, /value="dark"\s+checked|checked[^>]*value="dark"/);
});

test('the theme control defaults to system when no state is given', () => {
  const html = renderSettings(SNAPSHOT);
  assert.match(html, /value="system"\s+checked|checked[^>]*value="system"/);
});

test('an empty account list explains itself rather than rendering nothing', () => {
  const html = renderSettings({ ...SNAPSHOT, accounts: [] });
  assert.match(html, /no accounts/i);
});

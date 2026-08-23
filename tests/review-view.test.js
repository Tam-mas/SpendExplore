import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderReview } from '../web/review-view.js';

const SNAPSHOT = {
  categories: {
    groups: [{ id: 'food-drink', label: 'Food & Drink' }, { id: 'other', label: 'Other' }],
    categories: [
      { id: 'coffee', label: 'Coffee', groupId: 'food-drink' },
      { id: 'takeaway', label: 'Takeaway', groupId: 'food-drink' },
      { id: 'uncategorised', label: 'Uncategorised', groupId: 'other' },
      { id: 'income', label: 'Income', groupId: 'other' }
    ]
  },
  transactions: [
    { id: 'u1', date: '2026-08-05', amount: -16.77, merchant: 'Good Heavens', rawDescription: 'GOOD HEAVENS MELBOURNE AU', categoryId: 'uncategorised', categorySource: 'unknown', excluded: false },
    { id: 'u2', date: '2026-08-14', amount: -37.61, merchant: 'Good Heavens', rawDescription: 'GOOD HEAVENS MELBOURNE AU', categoryId: 'uncategorised', categorySource: 'unknown', excluded: false },
    { id: 'u3', date: '2026-08-06', amount: -59.99, merchant: 'Arctel', rawDescription: 'ARCTEL PTY LTD', categoryId: 'uncategorised', categorySource: 'unknown', excluded: false }
  ]
};

const state = { index: 0 };

test('shows progress through the queue', () => {
  const html = renderReview(SNAPSHOT, state);
  assert.match(html, /1\s*(of|\/)\s*2/i);
});

test('leads with the biggest decision', () => {
  assert.match(renderReview(SNAPSHOT, state), /Arctel/);
});

test('shows the transaction count, total and date span for the group', () => {
  const html = renderReview(SNAPSHOT, { index: 1 });
  assert.match(html, /Good Heavens/);
  assert.match(html, /\b2 transactions\b/);
  assert.match(html, /-\$54\.38/);
  assert.match(html, /2026-08-05/);
});

test('shows the raw bank description so the user can tell what it was', () => {
  assert.match(renderReview(SNAPSHOT, { index: 1 }), /GOOD HEAVENS MELBOURNE AU/);
});

test('offers numbered category shortcuts', () => {
  const html = renderReview(SNAPSHOT, state);
  assert.match(html, /data-assign="coffee"/);
  assert.match(html, /data-key="1"/);
});

test('never offers income or uncategorised as a shortcut', () => {
  const html = renderReview(SNAPSHOT, state);
  assert.doesNotMatch(html, /data-assign="income"/);
  assert.doesNotMatch(html, /data-assign="uncategorised"/);
});

test('offers search, new category, exclude and skip', () => {
  const html = renderReview(SNAPSHOT, state);
  for (const action of ['search', 'new-category', 'exclude', 'skip']) {
    assert.match(html, new RegExp(`data-review-action="${action}"`), action);
  }
});

test('offers the Claude copy and paste controls', () => {
  const html = renderReview(SNAPSHOT, state);
  assert.match(html, /data-review-action="copy-prompt"/);
  assert.match(html, /data-review-action="apply-paste"/);
});

test('an empty queue shows a done state, not a broken card', () => {
  const clean = { ...SNAPSHOT, transactions: [] };
  const html = renderReview(clean, state);
  assert.match(html, /nothing to review|all caught up/i);
  assert.doesNotMatch(html, /data-assign=/);
});

test('an index past the end shows the done state rather than crashing', () => {
  assert.match(renderReview(SNAPSHOT, { index: 99 }), /nothing to review|all caught up/i);
});

test('escapes merchant names and raw descriptions', () => {
  const nasty = {
    ...SNAPSHOT,
    transactions: [{ ...SNAPSHOT.transactions[0], merchant: '<img src=x>', rawDescription: '<script>x</script>' }]
  };
  const html = renderReview(nasty, state);
  assert.doesNotMatch(html, /<img src=x>/);
  assert.doesNotMatch(html, /<script>x<\/script>/);
  assert.match(html, /&lt;img/);
});

test('shows paste errors when present', () => {
  const html = renderReview(SNAPSHOT, { index: 0, pasteError: 'Could not find a JSON array' });
  assert.match(html, /Could not find a JSON array/);
});

test('references no external host', () => {
  assert.doesNotMatch(renderReview(SNAPSHOT, state), /https?:\/\/(?!127\.0\.0\.1|localhost)/);
});

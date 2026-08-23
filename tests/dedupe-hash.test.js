import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transactionId, assignOccurrenceIndexes } from '../lib/dedupe-hash.js';

const base = {
  accountId: 'spending',
  date: '2026-08-18',
  amount: -64.15,
  rawDescription: 'COLES 0592 COBURG VI AUS Card xx4321',
  occurrenceIndex: 0
};

test('is deterministic', () => {
  assert.equal(transactionId(base), transactionId({ ...base }));
});

test('is 16 hex characters', () => {
  assert.match(transactionId(base), /^[0-9a-f]{16}$/);
});

test('differs when any component differs', () => {
  const id = transactionId(base);
  assert.notEqual(id, transactionId({ ...base, amount: -64.16 }));
  assert.notEqual(id, transactionId({ ...base, date: '2026-08-19' }));
  assert.notEqual(id, transactionId({ ...base, accountId: 'card' }));
  assert.notEqual(id, transactionId({ ...base, rawDescription: 'ALDI' }));
  assert.notEqual(id, transactionId({ ...base, occurrenceIndex: 1 }));
});

test('two identical same-day rows get distinct ids', () => {
  const rows = assignOccurrenceIndexes([
    { accountId: 'spending', date: '2026-08-13', amount: -10, rawDescription: 'MYKI PAYMENTS' },
    { accountId: 'spending', date: '2026-08-13', amount: -10, rawDescription: 'MYKI PAYMENTS' }
  ]);
  assert.deepEqual(rows.map((r) => r.occurrenceIndex), [0, 1]);
  assert.notEqual(transactionId(rows[0]), transactionId(rows[1]));
});

test('re-importing the same file produces identical ids', () => {
  const file = [
    { accountId: 'spending', date: '2026-08-18', amount: -64.15, rawDescription: 'COLES 0592' },
    { accountId: 'spending', date: '2026-08-18', amount: -31.50, rawDescription: 'COLES 0592' },
    { accountId: 'spending', date: '2026-08-18', amount: -64.15, rawDescription: 'COLES 0592' }
  ];
  const first = assignOccurrenceIndexes(file).map(transactionId);
  const second = assignOccurrenceIndexes(file).map(transactionId);
  assert.deepEqual(first, second);
  assert.equal(new Set(first).size, 3);
});

test('distinct rows on the same day all get index 0', () => {
  const rows = assignOccurrenceIndexes([
    { accountId: 'spending', date: '2026-08-18', amount: -64.15, rawDescription: 'COLES' },
    { accountId: 'spending', date: '2026-08-18', amount: -31.50, rawDescription: 'COLES' }
  ]);
  assert.deepEqual(rows.map((r) => r.occurrenceIndex), [0, 0]);
});

// --- Additional tests beyond the mandated set ---

test('amount formatting is stable across equivalent numeric representations', () => {
  // -64.15 and -64.150 are the same JS number (trailing zero has no runtime
  // representation), and .toFixed(2) must collapse a rounding-prone float
  // sum like 0.1 + 0.2 to the same string as its "clean" equivalent.
  const a = transactionId({ ...base, amount: -64.15 });
  const b = transactionId({ ...base, amount: -64.150 });
  assert.equal(a, b);

  const c = transactionId({ ...base, amount: 0.1 + 0.2 }); // 0.30000000000000004
  const d = transactionId({ ...base, amount: 0.3 });
  assert.equal(c, d);
});

test('negative zero and positive zero produce the same id', () => {
  const a = transactionId({ ...base, amount: -0 });
  const b = transactionId({ ...base, amount: 0 });
  assert.equal(a, b);
});

test('assignOccurrenceIndexes does not mutate its input array or rows', () => {
  const original = [
    { accountId: 'spending', date: '2026-08-13', amount: -10, rawDescription: 'MYKI PAYMENTS' },
    { accountId: 'spending', date: '2026-08-13', amount: -10, rawDescription: 'MYKI PAYMENTS' }
  ];
  const snapshot = original.map((row) => ({ ...row }));

  const result = assignOccurrenceIndexes(original);

  assert.deepEqual(original, snapshot, 'input array rows must be unchanged');
  assert.equal('occurrenceIndex' in original[0], false, 'original rows must not gain occurrenceIndex');
  assert.notEqual(result, original, 'result must be a new array, not the same reference');
  assert.notEqual(result[0], original[0], 'result rows must be new objects, not mutated originals');
});

test('a three-way duplicate group gets indexes 0, 1, 2', () => {
  const rows = assignOccurrenceIndexes([
    { accountId: 'spending', date: '2026-08-13', amount: -10, rawDescription: 'MYKI PAYMENTS' },
    { accountId: 'spending', date: '2026-08-13', amount: -10, rawDescription: 'MYKI PAYMENTS' },
    { accountId: 'spending', date: '2026-08-13', amount: -10, rawDescription: 'MYKI PAYMENTS' }
  ]);
  assert.deepEqual(rows.map((r) => r.occurrenceIndex), [0, 1, 2]);
  const ids = rows.map(transactionId);
  assert.equal(new Set(ids).size, 3);
});

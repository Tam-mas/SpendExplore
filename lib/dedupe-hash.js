import { createHash } from 'node:crypto';

// Separator between joined key fields. Chosen to be unlikely to appear in
// any field on its own, but collisions are not a correctness requirement
// here — the fields are also fixed in count and order, so even an
// adversarial description containing this character cannot make two
// genuinely different rows collide, since the surrounding accountId/date/
// amount/occurrenceIndex fields still differ. `␟` (Unit Separator
// symbol) is used purely to keep debug output of the joined key readable.
const FIELD_SEP = '␟';

const normaliseAmount = (amount) => {
  // `.toFixed(2)` on JS's own float value collapses every same-value
  // representation (-64.15 vs -64.150 are already the same float; a
  // rounding artifact like 0.1 + 0.2 === 0.30000000000000004 rounds to
  // the same string as 0.3) and also normalises -0 to '0.00' rather than
  // '-0.00', so a negative-zero amount hashes identically to a positive
  // zero amount.
  const fixed = Number(amount).toFixed(2);
  return fixed === '-0.00' ? '0.00' : fixed;
};

const groupKey = (row) =>
  [row.accountId, row.date, normaliseAmount(row.amount), row.rawDescription].join(FIELD_SEP);

/**
 * Stable id for a transaction. Identical input always yields the same id, so
 * re-importing an overlapping statement adds nothing to the ledger.
 */
export function transactionId({ accountId, date, amount, rawDescription, occurrenceIndex }) {
  const key = [accountId, date, normaliseAmount(amount), rawDescription, occurrenceIndex].join(
    FIELD_SEP
  );
  return createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 16);
}

/**
 * Number each row by its position within its own duplicate group in this
 * file — NOT a collision-avoidance counter against the existing ledger.
 * This is what makes re-import idempotent: the same file, parsed the same
 * way, always assigns the same occurrenceIndex to each row, so the same
 * file always produces the same set of ids. Genuinely repeated
 * transactions (e.g. two identical same-day Myki top-ups) get distinct
 * indexes (0, 1, ...) within their duplicate group and so survive as
 * separate transactions, while a second import of the same file reproduces
 * the same indexes and is therefore recognised as a full duplicate.
 *
 * Does not mutate `rows` or any row in it — returns a new array of new
 * row objects.
 */
export function assignOccurrenceIndexes(rows) {
  const counts = new Map();
  return rows.map((row) => {
    const key = groupKey(row);
    const index = counts.get(key) ?? 0;
    counts.set(key, index + 1);
    return { ...row, occurrenceIndex: index };
  });
}

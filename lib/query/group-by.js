import { personFor } from './filter.js';

export const SLICES = Object.freeze([
  'category', 'group', 'merchant', 'person', 'card', 'account',
  'weekday', 'week', 'month', 'amountBand'
]);

/** Slices whose keys are chronological — the only ones a line chart may use. */
export const TIME_SLICES = Object.freeze(['week', 'month']);

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Upper bound (exclusive) of each band, on the ABSOLUTE amount.
const AMOUNT_BANDS = [
  { max: 10, label: 'Under $10' },
  { max: 25, label: '$10–$25' },
  { max: 50, label: '$25–$50' },
  { max: 100, label: '$50–$100' },
  { max: 200, label: '$100–$200' },
  { max: Infinity, label: '$200+' }
];

/** UTC-safe date parts. Dates are ISO strings, so parse them, never `new Date(str)` locally. */
const parts = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
};

/** ISO weekday index 0=Mon … 6=Sun, computed from the calendar without local time. */
function weekdayIndex(iso) {
  const { y, m, d } = parts(iso);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun
  return (day + 6) % 7;
}

/** Monday of the week containing `iso`, as an ISO date — a sortable week key. */
function weekStart(iso) {
  const { y, m, d } = parts(iso);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - weekdayIndex(iso));
  return dt.toISOString().slice(0, 10);
}

function bandFor(amount) {
  const magnitude = Math.abs(amount);
  const index = AMOUNT_BANDS.findIndex((b) => magnitude < b.max);
  return index === -1 ? AMOUNT_BANDS.length - 1 : index;
}

/** { key, label, sort } for one transaction under one slice. */
function keyFor(txn, sliceBy, ctx) {
  switch (sliceBy) {
    case 'category':
      return { key: txn.categoryId, label: ctx.categoryLabels.get(txn.categoryId) ?? txn.categoryId };
    case 'group': {
      const groupId = ctx.categoryToGroup.get(txn.categoryId) ?? 'other';
      return { key: groupId, label: ctx.groupLabels.get(groupId) ?? groupId };
    }
    case 'merchant':
      return { key: txn.merchant, label: txn.merchant };
    case 'person': {
      const person = personFor(txn, ctx);
      return { key: person, label: person };
    }
    // Unlike 'person', this is the RAW card number — it never folds through
    // cardOwners. Two real cards stay two buckets even when neither has been
    // mapped to a person yet, which is the common case: mapping is a Settings
    // screen that doesn't exist (see server/store.js), so 'person' collapses
    // everything to Joint on a fresh install while 'card' still shows the
    // real split the statement carries.
    case 'card': {
      const suffix = txn.cardSuffix;
      return suffix ? { key: suffix, label: `•• ${suffix}` } : { key: 'none', label: 'No card number' };
    }
    case 'account':
      return { key: txn.accountId, label: ctx.accountLabels.get(txn.accountId) ?? txn.accountId };
    case 'month': {
      const { y, m } = parts(txn.date);
      const key = `${y}-${String(m).padStart(2, '0')}`;
      return { key, label: `${MONTH_NAMES[m - 1]} ${y}`, sort: key };
    }
    case 'week': {
      const key = weekStart(txn.date);
      return { key, label: `w/c ${key}`, sort: key };
    }
    case 'weekday': {
      const index = weekdayIndex(txn.date);
      return { key: WEEKDAY_NAMES[index], label: WEEKDAY_NAMES[index], sort: index };
    }
    case 'amountBand': {
      const index = bandFor(txn.amount);
      return { key: AMOUNT_BANDS[index].label, label: AMOUNT_BANDS[index].label, sort: index };
    }
    default:
      throw new Error(`Unsupported slice: ${sliceBy}`);
  }
}

/**
 * Bucket transactions by one dimension.
 *
 * Slices with an inherent order (time, weekday, amount band) come back in
 * that order so a chart drawn straight from this array is correct. Every
 * other slice is returned unordered and is sorted by the caller.
 */
export function groupBy(transactions, sliceBy, ctx) {
  if (!SLICES.includes(sliceBy)) throw new Error(`Unsupported slice: ${sliceBy}`);

  const buckets = new Map();
  for (const txn of transactions) {
    const { key, label, sort } = keyFor(txn, sliceBy, ctx);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { key, label, sort, rows: [] };
      buckets.set(key, bucket);
    }
    bucket.rows.push(txn);
  }

  const out = [...buckets.values()];
  if (out.some((b) => b.sort !== undefined)) {
    out.sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0));
  }
  return out.map(({ key, label, rows }) => ({ key, label, rows }));
}

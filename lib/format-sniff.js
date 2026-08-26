/**
 * Infer a bank CSV's column layout, date format and sign convention from its
 * parsed rows. Produces a proposal for the import preview to show the user —
 * it is never applied silently, since a wrong guess (especially `spendSign`)
 * would invert every chart without anything looking obviously broken.
 *
 * Non-goals (explicit, not bugs):
 * - Two-digit years (`22/08/26`) are not recognised as dates.
 * - Separate Debit/Credit split columns are not supported — only a single
 *   signed amount column.
 */

const DATE_PATTERNS = [
  { format: 'YYYY-MM-DD', re: /^\s*(\d{4})-(\d{2})-(\d{2})\s*$/, order: ['y', 'm', 'd'] },
  { format: 'DD/MM/YYYY', re: /^\s*(\d{1,2})[/-](\d{1,2})[/-](\d{4})\s*$/, order: ['d', 'm', 'y'] },
  { format: 'DD Mon YYYY', re: /^\s*(\d{1,2})\s+([a-zA-Z]{3})\s+(\d{4})\s*$/, order: ['d', 'm', 'y'] }
];

const MONTH_ABBR = {
  'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6,
  'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12
};

/** Parse a date string into an ISO `YYYY-MM-DD` string, or null if invalid. */
export function parseDate(value, dateFormat) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  let y, m, d;

  if (dateFormat === 'YYYY-MM-DD') {
    const match = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!match) return null;
    [, y, m, d] = match;
  } else if (dateFormat === 'DD Mon YYYY') {
    const match = trimmed.match(/^(\d{1,2})\s+([a-zA-Z]{3})\s+(\d{4})$/);
    if (!match) return null;
    [, d, , y] = match;
    const monthAbbrLower = match[2].toLowerCase();
    m = MONTH_ABBR[monthAbbrLower];
    if (m === undefined) return null;
  } else {
    const match = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (!match) return null;
    if (dateFormat === 'MM/DD/YYYY') [, m, d, y] = match;
    else [, d, m, y] = match;
  }

  const year = Number(y), month = Number(m), day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Parse a money string into a number, or null if it is not numeric. */
export function parseAmount(value) {
  if (typeof value !== 'string') return null;
  let s = value.trim();
  if (s === '') return null;
  // No real bank amount (even with currency symbol, thousands separators and
  // parens) comes close to this length. Rejecting it up front avoids feeding
  // an attacker-or-accident-sized string into the regexes below, several of
  // which backtrack quadratically on a long run of digits that ultimately
  // fails to match.
  if (s.length > 32) return null;

  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1).trim(); }

  s = s.replace(/\$/g, '').trim(); // currency symbol carries no sign information

  if (s.startsWith('-')) { negative = true; s = s.slice(1).trim(); }
  else if (s.startsWith('+')) { s = s.slice(1).trim(); }

  // Reject ambiguous separator combinations instead of silently
  // misinterpreting them. European decimal-comma ("1.404,01"), space-grouped
  // thousands with a decimal comma ("1 404,01"), and uneven grouping are all
  // unsupported — the only comma usage accepted is strict US-style thousands
  // grouping (1-3 leading digits, then groups of exactly three) in front of
  // an optional `.` decimal, e.g. "1,404" or "1,404.01".
  if (s.includes(',')) {
    if (!/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return null;
    s = s.replace(/,/g, '');
  }

  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

function looksLikeDate(value) {
  return DATE_PATTERNS.some((p) => p.re.test(value ?? ''));
}

function looksLikeAmount(value) {
  return parseAmount(value ?? '') !== null;
}

function detectDateFormat(values) {
  if (values.some((v) => /^\s*\d{4}-\d{2}-\d{2}\s*$/.test(v))) {
    return { dateFormat: 'YYYY-MM-DD', dateFormatConfidence: 'high' };
  }
  if (values.some((v) => /^\s*\d{1,2}\s+[a-zA-Z]{3}\s+\d{4}\s*$/.test(v))) {
    return { dateFormat: 'DD Mon YYYY', dateFormatConfidence: 'high' };
  }
  let firstOver12 = false;
  let secondOver12 = false;
  for (const v of values) {
    const m = String(v).trim().match(/^(\d{1,2})[/-](\d{1,2})[/-]\d{4}$/);
    if (!m) continue;
    if (Number(m[1]) > 12) firstOver12 = true;
    if (Number(m[2]) > 12) secondOver12 = true;
  }
  if (firstOver12 && secondOver12) {
    // Different rows disagree about which position is the day (one row has
    // a first-position value over 12, another has a second-position value
    // over 12). The column is not DD/MM under any single reading — this is
    // typically what a bank CSV round-tripped through Excel looks like.
    // Still return a default so callers always get a format, but flag it.
    return { dateFormat: 'DD/MM/YYYY', dateFormatConfidence: 'low' };
  }
  if (secondOver12 && !firstOver12) return { dateFormat: 'MM/DD/YYYY', dateFormatConfidence: 'high' };
  if (firstOver12) return { dateFormat: 'DD/MM/YYYY', dateFormatConfidence: 'high' };
  // No day above 12 anywhere: unresolvable from the data. Default to the
  // Australian convention and tell the user it is a guess.
  return { dateFormat: 'DD/MM/YYYY', dateFormatConfidence: 'low' };
}

const BALANCE_MATCH_TOLERANCE = 0.01;

/**
 * Among two or more numeric candidate columns, look for a pair where one
 * column (`balance`) is a running balance derived from the other
 * (`amount`): consecutive sample rows should satisfy
 * `balance[n] - balance[n+1] ≈ ±amount[n]`, within a one-cent tolerance.
 * The `±` absorbs both newest-first and oldest-first row ordering. Returns
 * the best-fitting `{ amount, balance, ratio }` when some pair fits a clear
 * majority of consecutive rows, otherwise null.
 */
function findBalancePair(sample, numericCols) {
  let best = null;
  for (const a of numericCols) {
    for (const b of numericCols) {
      if (a === b) continue;
      const amounts = sample.map((r) => parseAmount(r[a] ?? ''));
      const balances = sample.map((r) => parseAmount(r[b] ?? ''));
      let matches = 0;
      let total = 0;
      for (let n = 0; n < sample.length - 1; n++) {
        if (amounts[n] === null || balances[n] === null || balances[n + 1] === null) continue;
        total++;
        const diff = balances[n] - balances[n + 1];
        if (Math.abs(diff - amounts[n]) <= BALANCE_MATCH_TOLERANCE
          || Math.abs(diff + amounts[n]) <= BALANCE_MATCH_TOLERANCE) {
          matches++;
        }
      }
      if (total === 0) continue;
      const ratio = matches / total;
      if (ratio > 0.5 && (!best || ratio > best.ratio)) {
        best = { amount: a, balance: b, ratio };
      }
    }
  }
  return best;
}

/**
 * Inspect parsed CSV rows and infer the column layout, date format and
 * sign convention. The result is a proposal shown to the user for
 * confirmation before any import — never applied silently.
 */
export function sniffFormat(rows) {
  if (!rows.length) throw new Error('Cannot sniff format of an empty file');

  const rowHasDate = (row) => row.some((v) => looksLikeDate(v));
  const rowHasAmount = (row) => row.some((v) => looksLikeAmount(v));
  const looksLikeHeaderRow = (row) => !rowHasDate(row) && !rowHasAmount(row);

  if (rows.length === 1 && looksLikeHeaderRow(rows[0])) {
    throw new Error('File contains a header but no data rows');
  }

  // A header row rarely has a date-like or amount-like cell anywhere in it;
  // a data row (checked via row 1) almost always has both. Checking every
  // column, not just column 0, matters for layouts where the date isn't the
  // first column (e.g. a leading account-name column).
  const hasHeader = looksLikeHeaderRow(rows[0]) && rows.length > 1
    && rowHasDate(rows[1]) && rowHasAmount(rows[1]);
  const data = hasHeader ? rows.slice(1) : rows;

  const sample = data.slice(0, 50);
  const width = Math.max(...sample.map((r) => r.length));

  const columnIs = (idx, predicate) => {
    const values = sample.map((r) => r[idx] ?? '').filter((v) => v !== '');
    if (!values.length) return false;
    return values.filter(predicate).length / values.length >= 0.8;
  };

  const mapping = { date: null, description: null, account: null, category: null, amount: null };

  for (let i = 0; i < width; i++) {
    if (mapping.date === null && columnIs(i, looksLikeDate)) { mapping.date = i; break; }
  }

  const numericCols = [];
  for (let i = 0; i < width; i++) {
    if (i === mapping.date) continue;
    if (columnIs(i, looksLikeAmount)) numericCols.push(i);
  }
  if (numericCols.length === 1) {
    mapping.amount = numericCols[0];
  } else if (numericCols.length > 1) {
    // Prefer the transaction/running-balance relationship: it identifies the
    // amount column directly from how the numbers move against each other,
    // rather than guessing from sign or magnitude alone (a credit-card
    // layout can have positive charges against a negative running balance,
    // and an overdrawn account can have both columns negative with the
    // balance nearer zero — sign share and magnitude alone get both wrong).
    const balancePair = findBalancePair(sample, numericCols);
    if (balancePair) {
      mapping.amount = balancePair.amount;
    } else {
      // No consecutive-row relationship fits: fall back to scoring columns
      // on how balance-like they look. Balance columns are (near-)always
      // positive and larger in magnitude than individual transactions.
      const scored = numericCols.map((i) => {
        const vals = sample.map((r) => parseAmount(r[i] ?? '')).filter((v) => v !== null);
        const negShare = vals.filter((v) => v < 0).length / (vals.length || 1);
        const meanAbs = vals.reduce((a, v) => a + Math.abs(v), 0) / (vals.length || 1);
        return { i, negShare, meanAbs };
      });
      scored.sort((a, b) => (b.negShare - a.negShare) || (a.meanAbs - b.meanAbs));
      mapping.amount = scored[0].i;
    }
  }

  const textCols = [];
  for (let i = 0; i < width; i++) {
    if (i === mapping.date || i === mapping.amount) continue;
    if (!columnIs(i, looksLikeAmount)) textCols.push(i);
  }
  // The description is the highest-cardinality text column — merchant text
  // is close to unique per row — with average text length as a tie-break
  // (an account name repeated on every row can tie on cardinality with a
  // short, low-variety description; the longer text wins the tie).
  const textStats = textCols.map((i) => {
    const vals = sample.map((r) => (r[i] ?? '').trim());
    const avgLen = vals.reduce((a, v) => a + v.length, 0) / (vals.length || 1);
    return { i, avgLen, distinct: new Set(vals).size };
  });
  textStats.sort((a, b) => (b.distinct - a.distinct) || (b.avgLen - a.avgLen));
  if (textStats[0]) mapping.description = textStats[0].i;

  // Among the remaining text columns, the account name is identified by
  // genuinely low cardinality relative to the sample (a handful of account
  // names repeated across many rows) — not merely "lower than the other
  // leftover column", which mislabels a bank's own category column as the
  // account when it happens to repeat less often than the description. With
  // only one leftover column there is nothing to compare it against, so it
  // is left unmapped rather than guessed.
  const rest = textStats.slice(1).sort((a, b) => a.distinct - b.distinct);
  if (rest.length >= 2) {
    const genuinelyLow = rest[0].distinct <= sample.length * 0.5;
    if (genuinelyLow) {
      mapping.account = rest[0].i;
      mapping.category = rest[1].i;
    }
  }

  const amounts = mapping.amount === null ? []
    : sample.map((r) => parseAmount(r[mapping.amount] ?? '')).filter((v) => v !== null);
  const negatives = amounts.filter((v) => v < 0).length;
  const spendSign = negatives >= amounts.length / 2 ? 'negative' : 'positive';

  const dateValues = mapping.date === null ? [] : sample.map((r) => r[mapping.date] ?? '');
  const { dateFormat, dateFormatConfidence } = detectDateFormat(dateValues);

  return { hasHeader, mapping, dateFormat, dateFormatConfidence, spendSign };
}

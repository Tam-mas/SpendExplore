const DATE_PATTERNS = [
  { format: 'YYYY-MM-DD', re: /^\s*(\d{4})-(\d{2})-(\d{2})\s*$/, order: ['y', 'm', 'd'] },
  { format: 'DD/MM/YYYY', re: /^\s*(\d{1,2})[/-](\d{1,2})[/-](\d{4})\s*$/, order: ['d', 'm', 'y'] }
];

/** Parse a date string into an ISO `YYYY-MM-DD` string, or null if invalid. */
export function parseDate(value, dateFormat) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  let y, m, d;

  if (dateFormat === 'YYYY-MM-DD') {
    const match = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!match) return null;
    [, y, m, d] = match;
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
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  s = s.replace(/[$\s,]/g, '');
  if (s.startsWith('-')) { negative = true; s = s.slice(1); }
  else if (s.startsWith('+')) s = s.slice(1);
  if (!/^\d*\.?\d+$/.test(s)) return null;
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
  let firstOver12 = false;
  let secondOver12 = false;
  for (const v of values) {
    const m = String(v).trim().match(/^(\d{1,2})[/-](\d{1,2})[/-]\d{4}$/);
    if (!m) continue;
    if (Number(m[1]) > 12) firstOver12 = true;
    if (Number(m[2]) > 12) secondOver12 = true;
  }
  if (secondOver12 && !firstOver12) return { dateFormat: 'MM/DD/YYYY', dateFormatConfidence: 'high' };
  if (firstOver12) return { dateFormat: 'DD/MM/YYYY', dateFormatConfidence: 'high' };
  // No day above 12 anywhere: unresolvable from the data. Default to the
  // Australian convention and tell the user it is a guess.
  return { dateFormat: 'DD/MM/YYYY', dateFormatConfidence: 'low' };
}

/**
 * Inspect parsed CSV rows and infer the column layout, date format and
 * sign convention. The result is a proposal shown to the user for
 * confirmation before any import — never applied silently.
 */
export function sniffFormat(rows) {
  if (!rows.length) throw new Error('Cannot sniff format of an empty file');

  const hasHeader = !looksLikeDate(rows[0][0]) && rows.length > 1 && looksLikeDate(rows[1][0]);
  const data = hasHeader ? rows.slice(1) : rows;
  if (!data.length) throw new Error('File contains a header but no data rows');

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
  // The amount is the LAST numeric column that is not the date. In the
  // 4-column layout the final column is the running balance, so prefer an
  // earlier numeric column when a later one is monotonic-looking balance data.
  const numericCols = [];
  for (let i = 0; i < width; i++) {
    if (i === mapping.date) continue;
    if (columnIs(i, looksLikeAmount)) numericCols.push(i);
  }
  if (numericCols.length === 1) mapping.amount = numericCols[0];
  else if (numericCols.length > 1) {
    // Balance columns are (near-)always positive and larger in magnitude.
    const scored = numericCols.map((i) => {
      const vals = sample.map((r) => parseAmount(r[i] ?? '')).filter((v) => v !== null);
      const negShare = vals.filter((v) => v < 0).length / (vals.length || 1);
      const meanAbs = vals.reduce((a, v) => a + Math.abs(v), 0) / (vals.length || 1);
      return { i, negShare, meanAbs };
    });
    scored.sort((a, b) => (b.negShare - a.negShare) || (a.meanAbs - b.meanAbs));
    mapping.amount = scored[0].i;
  }

  const textCols = [];
  for (let i = 0; i < width; i++) {
    if (i === mapping.date || i === mapping.amount) continue;
    if (!columnIs(i, looksLikeAmount)) textCols.push(i);
  }
  // Longest average text is the description; a low-cardinality column is the
  // account name; a remaining column is the bank's own category (ignored).
  const textStats = textCols.map((i) => {
    const vals = sample.map((r) => (r[i] ?? '').trim());
    const avgLen = vals.reduce((a, v) => a + v.length, 0) / (vals.length || 1);
    return { i, avgLen, distinct: new Set(vals).size };
  });
  textStats.sort((a, b) => b.avgLen - a.avgLen);
  if (textStats[0]) mapping.description = textStats[0].i;
  const rest = textStats.slice(1).sort((a, b) => a.distinct - b.distinct);
  if (rest[0]) mapping.account = rest[0].i;
  if (rest[1]) mapping.category = rest[1].i;

  const amounts = mapping.amount === null ? []
    : sample.map((r) => parseAmount(r[mapping.amount] ?? '')).filter((v) => v !== null);
  const negatives = amounts.filter((v) => v < 0).length;
  const spendSign = negatives >= amounts.length / 2 ? 'negative' : 'positive';

  const dateValues = mapping.date === null ? [] : sample.map((r) => r[mapping.date] ?? '');
  const { dateFormat, dateFormatConfidence } = detectDateFormat(dateValues);

  return { hasHeader, mapping, dateFormat, dateFormatConfidence, spendSign };
}

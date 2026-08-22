import { parseCsvWithLines } from './csv-parse.js';
import { sniffFormat, parseDate, parseAmount } from './format-sniff.js';
import { normaliseMerchant, extractCardSuffix } from './merchant-normalise.js';
import { assignOccurrenceIndexes, transactionId } from './dedupe-hash.js';
import { categoriseTransaction } from './categorise.js';

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Turn raw CSV text into ledger-ready transactions.
 *
 * The import preview and the import commit both call this with identical
 * arguments, so what the user confirms is exactly what gets written. This
 * function is pure: no file reads, no writes, no network, no global state —
 * the caller is responsible for all I/O.
 *
 * @param {object}  opts
 * @param {string}  opts.text               raw CSV file contents
 * @param {string}  opts.accountId          account these rows belong to
 * @param {string}  opts.importId           id tagged onto every row for rollback
 * @param {Array}   opts.rules              ordered categorisation rules
 * @param {Set}     opts.existingIds        transaction ids already in the ledger
 * @param {Set}     opts.existingMerchants  lowercased merchants with prior spend
 * @param {object} [opts.mappingOverride]   user-corrected format, wins over sniffing
 */
export function ingest({
  text, accountId, importId, rules,
  existingIds = new Set(), existingMerchants = new Set(), mappingOverride = null
}) {
  const records = parseCsvWithLines(text);
  if (!records.length) {
    // File-level failure, not a row-level one: there is no row to point the
    // user at, so `line: 0` (deliberately outside the 1-based row numbering
    // used everywhere else) and an empty `raw` are the correct signal, not
    // a bug to fix. This also means `added + duplicates + malformed.length`
    // does not equal `summary.rowsRead` here (0 + 0 + 1 !== 0) — accepted,
    // because the single malformed entry describes the whole file, not one
    // of its (zero) rows.
    return {
      format: null, transactions: [], duplicates: 0,
      malformed: [{ line: 0, raw: '', reason: 'File is empty' }],
      summary: emptySummary()
    };
  }

  let format;
  try {
    format = mappingOverride ?? sniffFormat(records.map((r) => r.fields));
  } catch (err) {
    // sniffFormat throws on input it cannot make sense of at all — e.g. a
    // header-only export with zero data rows, or a single line of garbage
    // that looks like neither a date nor an amount. That is ordinary user
    // input (an empty-period statement, a wrong file upload), not a reason
    // to blow up the whole import: report it the same way as the empty-file
    // case above, as one file-level malformed entry, and return normally.
    return {
      format: null, transactions: [], duplicates: 0,
      malformed: [{ line: 0, raw: '', reason: err.message }],
      summary: emptySummary()
    };
  }

  const { mapping, dateFormat, spendSign, hasHeader } = format;
  const dataRecords = hasHeader ? records.slice(1) : records;

  const malformed = [];
  const candidates = [];

  dataRecords.forEach(({ fields: row, line }) => {
    const raw = row.join(',');

    if (mapping.date === null) {
      malformed.push({ line, raw, reason: 'no date column could be identified' });
      return;
    }
    const rawDate = row[mapping.date] ?? '';
    const date = parseDate(rawDate, dateFormat);
    if (!date) {
      malformed.push({ line, raw, reason: `Unreadable date: "${rawDate}"` });
      return;
    }

    if (mapping.amount === null) {
      malformed.push({ line, raw, reason: 'no amount column could be identified' });
      return;
    }
    const rawAmount = row[mapping.amount] ?? '';
    const parsed = parseAmount(rawAmount);
    if (parsed === null) {
      malformed.push({ line, raw, reason: `Unreadable amount: "${rawAmount}"` });
      return;
    }

    // Normalise to the internal convention: negative = spend. `|| 0` folds
    // a rounded-to-zero result so a zero-amount row in a positive-spend
    // file reports `0`, not the technically-correct-but-misleading `-0`.
    const amount = round2(spendSign === 'positive' ? -parsed : parsed) || 0;

    // Preserved byte-identical to the source field — never trimmed or
    // otherwise mutated — so an improved normaliser can re-derive the
    // whole ledger later from rawDescription without re-importing.
    const rawDescription = mapping.description === null ? '' : (row[mapping.description] ?? '');

    candidates.push({ accountId, date, amount, rawDescription });
  });

  const indexed = assignOccurrenceIndexes(candidates);

  // Merchants with prior spend, from the ledger plus this file's own spend, so
  // a refund appearing in the same statement as its purchase still nets. Built
  // from `indexed` (every candidate row) rather than `transactions`, so a
  // spend row that turns out to be a duplicate already in the ledger still
  // counts as prior spend for a refund elsewhere in this same file.
  const merchantsWithSpend = new Set(existingMerchants);
  for (const row of indexed) {
    if (row.amount < 0) merchantsWithSpend.add(normaliseMerchant(row.rawDescription).toLowerCase());
  }

  const transactions = [];
  let duplicates = 0;

  for (const row of indexed) {
    const id = transactionId(row);
    if (existingIds.has(id)) { duplicates++; continue; }

    const merchant = normaliseMerchant(row.rawDescription);
    const { categoryId, categorySource } =
      categoriseTransaction({ amount: row.amount, merchant }, rules, merchantsWithSpend);

    transactions.push({
      id,
      date: row.date,
      amount: row.amount,
      rawDescription: row.rawDescription,
      merchant,
      accountId,
      cardSuffix: extractCardSuffix(row.rawDescription),
      categoryId,
      categorySource,
      excluded: false,
      importId,
      note: null
    });
  }

  // Deliberately spans every row read (not just added ones): the date range
  // of the statement is a property of the file, independent of how much of
  // it was already in the ledger.
  const dates = indexed.map((r) => r.date).sort();
  const summary = {
    rowsRead: dataRecords.length,
    added: transactions.length,
    duplicates,
    autoCategorised: transactions.filter((t) => t.categorySource === 'rule').length,
    needsReview: transactions.filter((t) => t.categorySource === 'unknown').length,
    dateFrom: dates[0] ?? null,
    dateTo: dates[dates.length - 1] ?? null,
    totalSpend: round2(transactions.filter((t) => t.amount < 0).reduce((a, t) => a + t.amount, 0)),
    totalIncome: round2(transactions.filter((t) => t.amount > 0).reduce((a, t) => a + t.amount, 0))
  };

  return { format, transactions, duplicates, malformed, summary };
}

function emptySummary() {
  return {
    rowsRead: 0, added: 0, duplicates: 0, autoCategorised: 0, needsReview: 0,
    dateFrom: null, dateTo: null, totalSpend: 0, totalIncome: 0
  };
}

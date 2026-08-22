import { parseCsv } from './csv-parse.js';
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
  const rows = parseCsv(text);
  if (!rows.length) {
    return {
      format: null, transactions: [], duplicates: 0,
      malformed: [{ line: 0, raw: '', reason: 'File is empty' }],
      summary: emptySummary()
    };
  }

  const format = mappingOverride ?? sniffFormat(rows);
  const { mapping, dateFormat, spendSign, hasHeader } = format;
  const headerOffset = hasHeader ? 1 : 0;
  const dataRows = hasHeader ? rows.slice(1) : rows;

  const malformed = [];
  const candidates = [];

  dataRows.forEach((row, index) => {
    const line = index + headerOffset + 1;
    const raw = row.join(',');

    const rawDate = mapping.date === null ? '' : (row[mapping.date] ?? '');
    const date = parseDate(rawDate, dateFormat);
    if (!date) {
      malformed.push({ line, raw, reason: `Unreadable date: "${rawDate}"` });
      return;
    }

    const rawAmount = mapping.amount === null ? '' : (row[mapping.amount] ?? '');
    const parsed = parseAmount(rawAmount);
    if (parsed === null) {
      malformed.push({ line, raw, reason: `Unreadable amount: "${rawAmount}"` });
      return;
    }

    // Normalise to the internal convention: negative = spend.
    const amount = round2(spendSign === 'positive' ? -parsed : parsed);

    // Preserved byte-identical to the source field — never trimmed or
    // otherwise mutated — so an improved normaliser can re-derive the
    // whole ledger later from rawDescription without re-importing.
    const rawDescription = mapping.description === null ? '' : (row[mapping.description] ?? '');

    candidates.push({ accountId, date, amount, rawDescription });
  });

  const indexed = assignOccurrenceIndexes(candidates);

  // Merchants with prior spend, from the ledger plus this file's own spend, so
  // a refund appearing in the same statement as its purchase still nets.
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

  const dates = indexed.map((r) => r.date).sort();
  const summary = {
    rowsRead: dataRows.length,
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

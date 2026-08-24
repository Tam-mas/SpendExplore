// Diagnose why rows in a re-imported CSV aren't being recognised as
// duplicates of what's already in the ledger.
//
// Prints only STRUCTURAL information (whether fields match, and their
// lengths) — never merchant names, and amounts only as already-known round
// dollar figures. Safe to share the output; the CSV itself never leaves
// your machine.
//
// Usage: node scripts/diagnose-reimport.js path/to/reimport.csv [dataDir]

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsvWithLines } from '../lib/csv-parse.js';
import { sniffFormat, parseDate, parseAmount } from '../lib/format-sniff.js';
import { assignOccurrenceIndexes, transactionId } from '../lib/dedupe-hash.js';

const csvPath = process.argv[2];
const dataDir = process.argv[3] ?? join(new URL('..', import.meta.url).pathname, 'data');

if (!csvPath) {
  console.error('Usage: node scripts/diagnose-reimport.js path/to/reimport.csv [dataDir]');
  process.exit(1);
}

let ledger, csvText;
try {
  ledger = JSON.parse(readFileSync(join(dataDir, 'ledger.json'), 'utf8'));
  csvText = readFileSync(csvPath, 'utf8');
} catch (err) {
  console.error(`Could not read ${err.path ?? 'a required file'}: ${err.message}`);
  process.exit(1);
}

const records = parseCsvWithLines(csvText);
let format;
try {
  format = sniffFormat(records.map((r) => r.fields));
} catch (err) {
  console.error(`Could not make sense of ${csvPath}: ${err.message}`);
  process.exit(1);
}
console.log('=== Detected format for the new file ===');
console.log(JSON.stringify(format, null, 2));
console.log();

const { mapping, dateFormat, spendSign, hasHeader } = format;
const dataRecords = hasHeader ? records.slice(1) : records;
const round2 = (n) => Math.round(n * 100) / 100;

const candidates = [];
for (const { fields: row, line } of dataRecords) {
  const rawDate = row[mapping.date] ?? '';
  const date = parseDate(rawDate, dateFormat);
  const rawAmount = mapping.amount === null ? '' : (row[mapping.amount] ?? '');
  const parsedAmount = parseAmount(rawAmount);
  if (!date || parsedAmount === null) continue; // malformed rows aren't the concern here
  const amount = round2(spendSign === 'positive' ? -parsedAmount : parsedAmount) || 0;
  const rawDescription = mapping.description === null ? '' : (row[mapping.description] ?? '');
  candidates.push({ line, date, amount, rawDescription, accountId: 'default' });
}

const indexed = assignOccurrenceIndexes(candidates);

const ledgerIds = new Set(ledger.map((t) => t.id));
const byDateAmount = new Map();
for (const t of ledger) {
  const key = `${t.date}|${round2(t.amount).toFixed(2)}`;
  if (!byDateAmount.has(key)) byDateAmount.set(key, []);
  byDateAmount.get(key).push(t);
}

let matched = 0, unmatchedNoDateAmount = 0, nearMisses = 0;
for (const row of indexed) {
  const id = transactionId(row);
  if (ledgerIds.has(id)) { matched++; continue; }

  const key = `${row.date}|${row.amount.toFixed(2)}`;
  const sameDateAmount = byDateAmount.get(key) ?? [];
  if (sameDateAmount.length === 0) {
    unmatchedNoDateAmount++;
    console.log(`Line ${row.line}: no ledger row shares this date+amount at all (${row.date}, $${row.amount.toFixed(2)}) — genuinely new, OR the date/amount itself is being read differently than before.`);
    continue;
  }

  nearMisses++;
  const ledgerDescLengths = sameDateAmount.map((t) => t.rawDescription.length);
  const newDescLength = row.rawDescription.length;
  const lengthsMatch = ledgerDescLengths.includes(newDescLength);
  console.log(`Line ${row.line}: SAME date+amount (${row.date}, $${row.amount.toFixed(2)}) exists in the ledger ${sameDateAmount.length} time(s), but the id still doesn't match.`);
  console.log(`  New file's description length: ${newDescLength} chars. Existing ledger description length(s) at this date+amount: ${ledgerDescLengths.join(', ')}.`);
  console.log(`  ${lengthsMatch ? '  Lengths match — likely a whitespace, casing, or hidden-character difference in the description text.' : '  Lengths DIFFER — the description text is structurally different (a different column may be getting picked, or the bank changed its export format).'}`);
}

console.log();
console.log('=== Summary ===');
console.log(`${indexed.length} rows read from the new file.`);
console.log(`${matched} matched an existing ledger row exactly (correctly detected as duplicates).`);
console.log(`${nearMisses} share a date+amount with an existing row but still didn't match (see detail above — this is almost always the bug).`);
console.log(`${unmatchedNoDateAmount} share no date+amount with anything in the ledger (likely genuinely new transactions).`);

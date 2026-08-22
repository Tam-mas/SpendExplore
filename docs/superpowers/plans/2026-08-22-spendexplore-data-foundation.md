# SpendExplore Plan 1 — Data Foundation & First Real Numbers

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import one or more bank CSVs, auto-categorise them, persist them to a durable JSON ledger that de-duplicates on re-import, and display real category totals in a browser.

**Architecture:** Four layers with hard seams (see `docs/superpowers/specs/2026-08-22-spend-explorer-design.md`). This plan builds layers 1–2 (storage, ingestion) plus a thin server and a minimal UI. The query engine (layer 3) and the configurable panel UI (layer 4) are Plan 2. All ingestion logic is pure functions in `lib/` with no I/O, so it is exhaustively unit-testable.

**Tech Stack:** Node.js 23, ES modules, `node:test` + `node:assert/strict`, `node:http`, `node:crypto`. **Zero npm dependencies.** Frontend is plain ES modules with no build step.

## Global Constraints

- `package.json` MUST set `"type": "module"`. All code uses ESM `import`/`export`, never `require`.
- Server MUST bind to `127.0.0.1` only. Never `0.0.0.0`.
- No outbound network requests from server or browser code, ever. No CDN links.
- `data/` is gitignored. Never commit real financial data.
- Amounts: negative = spend, positive = income/refund, normalised at ingest regardless of source convention.
- Dates stored as ISO `YYYY-MM-DD` strings.
- `rawDescription` is preserved verbatim and never mutated.
- A transaction with `categorySource: "manual"` is never overwritten by a rule.
- Exclusion is the `excluded` boolean only. There is no "Excluded" category.
- Every file write is atomic: write to `<file>.tmp`, then `rename`.
- Write a `CHANGELOG.md` entry after each task, using the format in `~/.claude/changelog-format.md`, newest at top.
- Commit messages MUST NOT contain `Co-Authored-By` trailers.

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json` | ESM flag, `test` and `start` scripts |
| `lib/csv-parse.js` | RFC4180-style CSV text → `string[][]` |
| `lib/format-sniff.js` | Detect column mapping, date format, sign convention; parse dates and amounts |
| `lib/merchant-normalise.js` | Raw bank description → clean merchant name |
| `lib/dedupe-hash.js` | Stable transaction id, occurrence indexing |
| `lib/categorise.js` | Rule matching, merchant → categoryId |
| `lib/ingest.js` | Orchestrates the above into a preview/commit result |
| `server/store.js` | Seam 3: atomic read/write, backups, seeding |
| `server/index.js` | HTTP server, routing, static file serving |
| `server/routes.js` | Route handlers (snapshot, import, transactions) |
| `data/seed/categories.json` | Seeded two-level taxonomy |
| `data/seed/rules.json` | Seeded Australian merchant rules |
| `web/index.html` | Page shell |
| `web/api.js` | `fetch` wrappers for the HTTP API |
| `web/import-view.js` | Drag-drop, preview cards, confirm |
| `web/overview-view.js` | Category totals table |
| `web/app.js` | Tab switching, snapshot loading, wiring |
| `tests/*.test.js` | One test file per `lib/` and `server/` module |

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tests/scaffold.test.js`, `CHANGELOG.md`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing
- Produces: `npm test` runs `node --test 'tests/**/*.test.js'`; `npm start` runs `server/index.js`

- [ ] **Step 1: Write the failing test**

Create `tests/scaffold.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('package.json declares ES modules', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.scripts.test, "node --test 'tests/**/*.test.js'");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/scaffold.test.js`
Expected: FAIL — `ENOENT: no such file or directory ... package.json`

- [ ] **Step 3: Write minimal implementation**

Create `package.json`:

```json
{
  "name": "spendexplore",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "node --test 'tests/**/*.test.js'",
    "start": "node server/index.js"
  }
}
```

Append to `.gitignore` (it already contains `node_modules/`, `.superpowers/`, `data/`):

```
data/backups/
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — `# pass 1`

- [ ] **Step 5: Create CHANGELOG.md**

```markdown
# Changelog

### [2026-08-22 00:00] Added

**Tech:** `package.json` — ESM project scaffold with `node --test` runner
**Dev:** Zero npm dependencies; Node 23 built-ins cover test running, HTTP and hashing. `"type": "module"` set so all code is ESM.
**Plain:** Set up the empty project so code and tests can be added.
**Why:** Wanted the tool to still just work in two years without a build toolchain to repair first.
```

- [ ] **Step 6: Commit**

```bash
git add package.json tests/scaffold.test.js CHANGELOG.md .gitignore
git commit -m "chore: scaffold ESM project with node:test runner"
```

---

## Task 2: CSV parser

**Files:**
- Create: `lib/csv-parse.js`
- Test: `tests/csv-parse.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `parseCsv(text: string) → string[][]`

Bank CSVs quote fields containing commas. A naive `split(',')` corrupts every description in the sample file, so this needs a real character-level parser.

- [ ] **Step 1: Write the failing test**

Create `tests/csv-parse.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../lib/csv-parse.js';

test('parses plain rows', () => {
  assert.deepEqual(parseCsv('a,b,c\n1,2,3'), [['a','b','c'], ['1','2','3']]);
});

test('preserves commas inside quoted fields', () => {
  const row = parseCsv('22/08/2026,"COLES, COBURG","-10.00"')[0];
  assert.deepEqual(row, ['22/08/2026', 'COLES, COBURG', '-10.00']);
});

test('handles escaped double quotes', () => {
  assert.deepEqual(parseCsv('"DAN MURPHY""S"')[0], ['DAN MURPHY"S']);
});

test('handles CRLF line endings', () => {
  assert.deepEqual(parseCsv('a,b\r\nc,d'), [['a','b'], ['c','d']]);
});

test('ignores a trailing newline', () => {
  assert.equal(parseCsv('a,b\n').length, 1);
});

test('keeps empty fields', () => {
  assert.deepEqual(parseCsv('a,,c')[0], ['a', '', 'c']);
});

test('returns empty array for empty input', () => {
  assert.deepEqual(parseCsv('   '), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/csv-parse.test.js`
Expected: FAIL — `Cannot find module '../lib/csv-parse.js'`

- [ ] **Step 3: Write minimal implementation**

Create `lib/csv-parse.js`:

```js
/**
 * Parse CSV text into rows of raw string fields.
 * Handles quoted fields, embedded commas and newlines, escaped quotes (""),
 * a leading UTF-8 BOM, and both LF and CRLF line endings. A bare quote
 * mid-field is literal. Lone-CR (classic Mac) endings are NOT supported.
 * Does not interpret headers or types.
 */
export function parseCsv(text) {
  // Excel-exported bank CSVs commonly carry a UTF-8 BOM; left in place it
  // would make the first header cell "\ufeffDate" and break column detection.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let seenAnyChar = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    // Only a quote at the START of a field opens a quoted field. A bare quote
    // mid-field is literal data (Excel's behaviour) — treating it as an opener
    // would swallow the next delimiter and silently drop a column.
    if (ch === '"') {
      seenAnyChar = true;
      if (field === '') { inQuotes = true; continue; }
      field += ch;
      continue;
    }
    if (ch === ',') { row.push(field); field = ''; seenAnyChar = true; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') {
      row.push(field);
      if (seenAnyChar) rows.push(row);
      row = []; field = ''; seenAnyChar = false;
      continue;
    }
    field += ch;
    if (ch.trim() !== '') seenAnyChar = true;
  }

  row.push(field);
  if (seenAnyChar) rows.push(row);
  return rows;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/csv-parse.test.js`
Expected: PASS — `# pass 7`

- [ ] **Step 5: Commit**

```bash
git add lib/csv-parse.js tests/csv-parse.test.js
git commit -m "feat: add RFC4180-style CSV parser"
```

Add a CHANGELOG entry (`Added`, `Tech: lib/csv-parse.js — character-level CSV parser`) before committing.

---

## Task 3: Format sniffing, date and amount parsing

**Files:**
- Create: `lib/format-sniff.js`
- Test: `tests/format-sniff.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `sniffFormat(rows: string[][]) → { hasHeader, mapping, dateFormat, spendSign, dateFormatConfidence }`
    where `mapping = { date, description, account, category, amount }` of column indices (`null` when absent)
  - `parseDate(value: string, dateFormat: string) → string | null` (ISO `YYYY-MM-DD`)
  - `parseAmount(value: string) → number | null`

This is the layer that protects against the single worst failure: a wrong sign convention silently inverting every chart. `spendSign` is a *guess* surfaced to the user in the import preview, never a silent decision.

- [ ] **Step 1: Write the failing test**

Create `tests/format-sniff.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sniffFormat, parseDate, parseAmount } from '../lib/format-sniff.js';
import { parseCsv } from '../lib/csv-parse.js';

const SAMPLE = parseCsv([
  '22/08/2026,"MYKI PAYMENTS MELBOURNE  AUS Card xx8765","Everyday Account","Auto & transport","-10.00"',
  '18/08/2026,"COLES 0592 COBURG VI AUS Card xx4321","Everyday Account","Groceries & household","-64.15"',
  '11/08/2026,"CITY DIAGNOSTICS GREENWICH  AUS","Everyday Account","Uncategorised","-286.48"'
].join('\n'));

test('detects the 5-column CommBank layout', () => {
  const f = sniffFormat(SAMPLE);
  assert.equal(f.hasHeader, false);
  assert.deepEqual(f.mapping, { date: 0, description: 1, account: 2, category: 3, amount: 4 });
  assert.equal(f.dateFormat, 'DD/MM/YYYY');
  assert.equal(f.spendSign, 'negative');
});

test('detects the 4-column Date,Amount,Description,Balance layout', () => {
  const rows = parseCsv([
    '22/08/2026,"-10.00","MYKI PAYMENTS MELBOURNE","1234.00"',
    '18/08/2026,"-64.15","COLES 0592 COBURG","1298.15"'
  ].join('\n'));
  const f = sniffFormat(rows);
  assert.equal(f.mapping.date, 0);
  assert.equal(f.mapping.amount, 1);
  assert.equal(f.mapping.description, 2);
  assert.equal(f.mapping.account, null);
  assert.equal(f.mapping.category, null);
});

test('detects a header row and does not treat it as data', () => {
  const rows = parseCsv('Date,Description,Amount\n22/08/2026,"COLES","-10.00"');
  const f = sniffFormat(rows);
  assert.equal(f.hasHeader, true);
  assert.equal(f.mapping.date, 0);
  assert.equal(f.mapping.amount, 2);
});

test('detects positive-spend convention', () => {
  const rows = parseCsv('22/08/2026,"COLES","10.00"\n18/08/2026,"ALDI","64.15"\n17/08/2026,"MYKI","7.35"');
  assert.equal(sniffFormat(rows).spendSign, 'positive');
});

test('flags ambiguous day/month order as low confidence', () => {
  const rows = parseCsv('05/08/2026,"COLES","-10.00"\n03/07/2026,"ALDI","-64.15"');
  const f = sniffFormat(rows);
  assert.equal(f.dateFormat, 'DD/MM/YYYY');
  assert.equal(f.dateFormatConfidence, 'low');
});

test('resolves day/month order when a day exceeds 12', () => {
  const rows = parseCsv('22/08/2026,"COLES","-10.00"\n03/07/2026,"ALDI","-64.15"');
  const f = sniffFormat(rows);
  assert.equal(f.dateFormat, 'DD/MM/YYYY');
  assert.equal(f.dateFormatConfidence, 'high');
});

test('detects ISO dates', () => {
  const rows = parseCsv('2026-08-22,"COLES","-10.00"');
  assert.equal(sniffFormat(rows).dateFormat, 'YYYY-MM-DD');
});

test('parseDate converts to ISO', () => {
  assert.equal(parseDate('22/08/2026', 'DD/MM/YYYY'), '2026-08-22');
  assert.equal(parseDate('2026-08-22', 'YYYY-MM-DD'), '2026-08-22');
  assert.equal(parseDate('08/22/2026', 'MM/DD/YYYY'), '2026-08-22');
});

test('parseDate rejects impossible dates', () => {
  assert.equal(parseDate('32/08/2026', 'DD/MM/YYYY'), null);
  assert.equal(parseDate('not a date', 'DD/MM/YYYY'), null);
});

test('parseAmount strips currency symbols and separators', () => {
  assert.equal(parseAmount('-64.15'), -64.15);
  assert.equal(parseAmount('$1,404.01'), 1404.01);
  assert.equal(parseAmount('(25.11)'), -25.11);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('abc'), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/format-sniff.test.js`
Expected: FAIL — `Cannot find module '../lib/format-sniff.js'`

- [ ] **Step 3: Write minimal implementation**

Create `lib/format-sniff.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/format-sniff.test.js`
Expected: PASS — `# pass 10`

- [ ] **Step 5: Commit**

```bash
git add lib/format-sniff.js tests/format-sniff.test.js CHANGELOG.md
git commit -m "feat: add CSV format sniffing with date and amount parsing"
```

---

## Task 4: Merchant normalisation

**Files:**
- Create: `lib/merchant-normalise.js`
- Test: `tests/merchant-normalise.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `normaliseMerchant(rawDescription: string) → string`
  - `extractCardSuffix(rawDescription: string) → string | null`

This function contributes more to categorisation accuracy than anything else in the system. Its tests use every pattern present in the real sample CSV.

- [ ] **Step 1: Write the failing test**

Create `tests/merchant-normalise.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseMerchant, extractCardSuffix } from '../lib/merchant-normalise.js';

const CASES = [
  ['COLES 0592 COBURG VI AUS Card xx4321 Value Date: 14/08/2026', 'Coles'],
  ['COLES 0592               COBURG       AU', 'Coles'],
  ["DAN MURPHY'S    3609 COBURG VI AUS Card xx4321 Value Date: 18/08/2026", "Dan Murphy's"],
  ['MYKI PAYMENTS MELBOURNE  AUS Card xx8765 Value Date: 21/08/2026', 'Myki Payments'],
  ['WW METRO        3438 MELBOURNE VI AUS Card xx4321 Value Date: 19/08/2026', 'Ww Metro'],
  ['ALDI STORES           PRESTON      VICAU', 'Aldi Stores'],
  ['SQ *BERGY BANDROOM          Brunswick AU', 'Bergy Bandroom'],
  ['SMP*DAT THANH BAKERY  0      COBURG03 AU', 'Dat Thanh Bakery'],
  ['LSP*3 Ravens Thornbury AU AUS Card xx4321 Value Date: 06/08/2026', '3 Ravens'],
  ['TRANSPORT NSW ETOLL      PARRAMATTA   AU', 'Transport Nsw Etoll'],
  ['CHEMIST WAREHOUSE PRESTON VI AUS Card xx4321 Value Date: 03/08/2026', 'Chemist Warehouse'],
  ['Direct Debit 604135 OVO ENERGY PTY L OVO4477613290', 'Ovo Energy'],
  ['Netflix.com Melbourne VI AUS Card xx8765 Value Date: 29/07/2026', 'Netflix.com'],
  ['Wdl ATM NAB NAB ATM            94 SYDNEY R    AU', 'Atm Nab'],
  ['AMAYSIM MOBILE PTY LTD', 'Amaysim Mobile'],
  ['Google CLOUD WK2PZP Sydney AU AUS Card xx4321 Value Date: 02/08/2026', 'Google Cloud'],
  ['LIBERTY OIL COBURG  COBURG            AU', 'Liberty Oil'],
  ['DIDI MOBILITY AUSTRAL Melbourne AU AUS Card xx4321 Value Date: 16/08/2026', 'Didi Mobility Austral']
];

for (const [raw, expected] of CASES) {
  test(`normalises: ${raw.slice(0, 34)}`, () => {
    assert.equal(normaliseMerchant(raw), expected);
  });
}

test('collapses all Coles variants to one merchant', () => {
  const variants = [
    'COLES 0592 COBURG VI AUS Card xx4321 Value Date: 14/08/2026',
    'COLES 0592               COBURG       AU',
    'COLES 0592 COBURG VI AUS Card xx4321 Value Date: 29/07/2026'
  ];
  assert.equal(new Set(variants.map(normaliseMerchant)).size, 1);
});

test('never returns an empty string', () => {
  assert.equal(normaliseMerchant('   '), 'Unknown');
  assert.equal(normaliseMerchant('AU AUS'), 'Unknown');
});

test('extracts the card suffix', () => {
  assert.equal(extractCardSuffix('COLES 0592 AUS Card xx4321 Value Date: 14/08/2026'), '4321');
  assert.equal(extractCardSuffix('MYKI PAYMENTS Card xx8765'), '8765');
  assert.equal(extractCardSuffix('AMAYSIM MOBILE PTY LTD'), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/merchant-normalise.test.js`
Expected: FAIL — `Cannot find module '../lib/merchant-normalise.js'`

- [ ] **Step 3: Write minimal implementation**

Create `lib/merchant-normalise.js`:

```js
const CARD_SUFFIX_RE = /\bCard\s+xx(\d{4})\b/i;

// Applied in order. Each strips a layer of bank noise from the raw description.
const STRIP_PATTERNS = [
  /\bValue Date:.*$/i,              // trailing settlement date
  /\bCard\s+xx\d{4}\b/i,            // card identifier
  /^Direct Debit\s+\d+\s*/i,        // direct debit prefix + biller number
  /^(?:Wdl|Dep)\s+/i,               // withdrawal / deposit prefix
  /^(?:SQ|SMP|LSP|SP|PAYPAL|PP)\s*\*\s*/i, // payment gateway prefixes
  /\b[A-Z]{3}\d{6,}\b/g,            // biller reference codes e.g. OVO4477613290
  // Terminal/reference codes: 5+ uppercase alphanumerics containing at least
  // one digit AND one letter, e.g. WK2PZP, COBURG03. Real merchant words never
  // look like this, and leaving them in splinters one merchant into many.
  /\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{5,}\b/g,
  /\b(?:PTY\s+L(?:TD)?|P\/L|LIMITED|LTD|INC)\b/gi // company suffixes
];

// Location noise removed token-by-token from the END of the string only, so a
// merchant genuinely named after a place (e.g. "Coburg Bakery") keeps its name.
// Note `vi` as well as `vic` — CommBank abbreviates Victoria both ways.
const TRAILING_NOISE = new Set([
  'au', 'aus', 'australia',
  'vi', 'vic', 'nsw', 'qld', 'wa', 'sa', 'tas', 'nt', 'act',
  'vicau', 'nswau', 'qldau', 'waau', 'saau', 'tasau', 'ntau', 'actau',
  'melbourne', 'sydney', 'brisbane', 'perth', 'adelaide', 'hobart', 'canberra', 'darwin',
  'coburg', 'preston', 'thornbury', 'brunswick', 'docklands', 'parramatta',
  'greenwich', 'dandenong', 'balwyn', 'north', 'bella', 'vista', 'r'
]);

function titleCase(text) {
  return text
    .split(' ')
    .map((word) => {
      if (word === '') return word;
      if (/^\d/.test(word)) return word;             // keep "3 Ravens" numeric
      if (word.includes('.')) {                       // keep "Netflix.com"
        return word[0].toUpperCase() + word.slice(1).toLowerCase();
      }
      return word[0].toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

/** Extract the last four digits of the card used, or null. */
export function extractCardSuffix(rawDescription) {
  const match = String(rawDescription ?? '').match(CARD_SUFFIX_RE);
  return match ? match[1] : null;
}

/**
 * Reduce a raw bank description to a stable, human-readable merchant name.
 * All six Coles description variants in a statement collapse to "Coles".
 */
export function normaliseMerchant(rawDescription) {
  let s = String(rawDescription ?? '');

  for (const pattern of STRIP_PATTERNS) s = s.replace(pattern, ' ');

  s = s.replace(/[‘’]/g, "'");
  s = s.replace(/\s+/g, ' ').trim();

  let tokens = s.split(' ').filter(Boolean);

  // Drop trailing location/country noise and bare store numbers.
  while (tokens.length) {
    const last = tokens[tokens.length - 1].toLowerCase().replace(/[^a-z0-9']/g, '');
    if (TRAILING_NOISE.has(last) || /^\d{1,6}$/.test(last) || last === '') tokens.pop();
    else break;
  }

  // Drop interior store numbers (COLES 0592 COBURG -> COLES COBURG) but keep a
  // leading number, which is usually part of the name (3 Ravens).
  tokens = tokens.filter((tok, idx) => idx === 0 || !/^\d{3,6}$/.test(tok));

  // Re-run trailing cleanup now that store numbers are gone.
  while (tokens.length) {
    const last = tokens[tokens.length - 1].toLowerCase().replace(/[^a-z0-9']/g, '');
    if (TRAILING_NOISE.has(last) || /^\d{1,6}$/.test(last) || last === '') tokens.pop();
    else break;
  }

  // Banks repeat the merchant name inside one description
  // ("ATM NAB NAB ATM"). Keep the first occurrence of each token.
  const seen = new Set();
  tokens = tokens.filter((tok) => {
    const key = tok.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Cap length: bank descriptions pad with detail the merchant name never needs.
  if (tokens.length > 3) tokens = tokens.slice(0, 3);

  const result = titleCase(tokens.join(' ')).trim();
  return result === '' ? 'Unknown' : result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/merchant-normalise.test.js`
Expected: PASS — `# pass 21`

If any of the 18 real-world cases fail, adjust `TRAILING_NOISE` or the token rules until all pass. Do not change the expected values — they are the contract.

- [ ] **Step 5: Commit**

```bash
git add lib/merchant-normalise.js tests/merchant-normalise.test.js CHANGELOG.md
git commit -m "feat: add merchant name normalisation"
```

---

## Task 5: Stable transaction ids and dedupe

**Files:**
- Create: `lib/dedupe-hash.js`
- Test: `tests/dedupe-hash.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `transactionId({ accountId, date, amount, rawDescription, occurrenceIndex }) → string` (16 hex chars)
  - `assignOccurrenceIndexes(rows) → rows with `occurrenceIndex` added`
    where each `row` is `{ accountId, date, amount, rawDescription }`

**Design note — read before implementing.** `occurrenceIndex` is the position of a row **within its own duplicate group in the source file**, counting from 0. It is NOT a collision-avoidance counter incremented against the existing ledger. This is what makes re-import idempotent: the two Coles rows dated 18 Aug always hash to the same two ids, so importing the same statement twice adds nothing.

Known, accepted limitation: if the same transaction arrives in two *different* files that each contain only one of a duplicate pair, both get `occurrenceIndex: 0` and one is treated as a duplicate. This is rare and is preferable to the alternative failure (silently duplicating real spend on every overlapping import). The import summary always reports skipped duplicates, so it is visible.

- [ ] **Step 1: Write the failing test**

Create `tests/dedupe-hash.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/dedupe-hash.test.js`
Expected: FAIL — `Cannot find module '../lib/dedupe-hash.js'`

- [ ] **Step 3: Write minimal implementation**

Create `lib/dedupe-hash.js`:

```js
import { createHash } from 'node:crypto';

const groupKey = (row) =>
  [row.accountId, row.date, row.amount.toFixed(2), row.rawDescription].join(' ');

/**
 * Stable id for a transaction. Identical input always yields the same id, so
 * re-importing an overlapping statement adds nothing to the ledger.
 */
export function transactionId({ accountId, date, amount, rawDescription, occurrenceIndex }) {
  const key = [accountId, date, Number(amount).toFixed(2), rawDescription, occurrenceIndex]
    .join(' ');
  return createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 16);
}

/**
 * Number each row by its position within its own duplicate group in this file,
 * so genuinely repeated transactions (two identical Myki top-ups on one day)
 * survive while re-imports stay idempotent.
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/dedupe-hash.test.js`
Expected: PASS — `# pass 6`

- [ ] **Step 5: Commit**

```bash
git add lib/dedupe-hash.js tests/dedupe-hash.test.js CHANGELOG.md
git commit -m "feat: add stable transaction ids with occurrence indexing"
```

---

## Task 6: Seed taxonomy and rule matching

**Files:**
- Create: `data/seed/categories.json`, `data/seed/rules.json`, `lib/categorise.js`
- Test: `tests/categorise.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `matchRule(merchant: string, rules: Rule[]) → string | null` (a categoryId)
  - `categoriseTransaction(txn, rules, merchantsWithPriorSpend: Set<string>) → { categoryId, categorySource }`
  - `Rule = { match: 'exact'|'contains'|'regex', value: string, categoryId: string }`

Note `data/seed/` is committed (it contains no financial data); `data/*.json` at the top level is gitignored. Add `!data/seed/` to `.gitignore` in Step 3.

- [ ] **Step 1: Write the failing test**

Create `tests/categorise.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { matchRule, categoriseTransaction } from '../lib/categorise.js';

const load = async (name) =>
  JSON.parse(await readFile(new URL(`../data/seed/${name}.json`, import.meta.url), 'utf8'));

test('seed categories form a valid two-level taxonomy', async () => {
  const { groups, categories } = await load('categories');
  const groupIds = new Set(groups.map((g) => g.id));
  assert.ok(groups.length >= 7);
  for (const c of categories) {
    assert.ok(groupIds.has(c.groupId), `category ${c.id} references unknown group ${c.groupId}`);
  }
  assert.ok(categories.some((c) => c.id === 'uncategorised'));
  assert.ok(categories.some((c) => c.id === 'income'));
  assert.ok(!categories.some((c) => c.id === 'excluded'), 'exclusion is a flag, not a category');
});

test('every seed rule points at a real category', async () => {
  const { categories } = await load('categories');
  const ids = new Set(categories.map((c) => c.id));
  for (const rule of await load('rules')) {
    assert.ok(ids.has(rule.categoryId), `rule "${rule.value}" -> unknown category ${rule.categoryId}`);
    assert.ok(['exact', 'contains', 'regex'].includes(rule.match));
  }
});

test('seed rules categorise the real sample merchants', async () => {
  const rules = await load('rules');
  const expected = {
    'Coles': 'groceries',
    'Aldi Stores': 'groceries',
    'Ww Metro': 'groceries',
    "Dan Murphy's": 'alcohol',
    'Myki Payments': 'public-transport',
    'Transport Nsw Etoll': 'tolls-parking',
    'Liberty Oil': 'fuel',
    'Chemist Warehouse': 'pharmacy',
    'Ovo Energy': 'energy',
    'Amaysim Mobile': 'internet-phone',
    'Netflix.com': 'subscriptions',
    'Didi Mobility Austral': 'rideshare-taxi',
    'Mcdonalds Brunswick': 'takeaway'
  };
  for (const [merchant, categoryId] of Object.entries(expected)) {
    assert.equal(matchRule(merchant, rules), categoryId, `${merchant} should be ${categoryId}`);
  }
});

test('matching is case-insensitive', () => {
  const rules = [{ match: 'exact', value: 'coles', categoryId: 'groceries' }];
  assert.equal(matchRule('COLES', rules), 'groceries');
  assert.equal(matchRule('Coles', rules), 'groceries');
});

test('first matching rule wins', () => {
  const rules = [
    { match: 'exact', value: 'coles express', categoryId: 'fuel' },
    { match: 'contains', value: 'coles', categoryId: 'groceries' }
  ];
  assert.equal(matchRule('Coles Express', rules), 'fuel');
  assert.equal(matchRule('Coles', rules), 'groceries');
});

test('unmatched merchant returns null', () => {
  assert.equal(matchRule('Sunshine Deli', []), null);
});

test('an invalid regex rule is skipped rather than throwing', () => {
  const rules = [
    { match: 'regex', value: '([unclosed', categoryId: 'groceries' },
    { match: 'exact', value: 'coles', categoryId: 'groceries' }
  ];
  assert.equal(matchRule('Coles', rules), 'groceries');
});

test('spend with no rule is uncategorised', () => {
  const txn = { amount: -22.39, merchant: 'Sunshine Deli' };
  assert.deepEqual(categoriseTransaction(txn, [], new Set()),
    { categoryId: 'uncategorised', categorySource: 'unknown' });
});

test('spend with a rule is categorised from it', () => {
  const rules = [{ match: 'exact', value: 'coles', categoryId: 'groceries' }];
  assert.deepEqual(categoriseTransaction({ amount: -64.15, merchant: 'Coles' }, rules, new Set()),
    { categoryId: 'groceries', categorySource: 'rule' });
});

test('a positive amount from a merchant with prior spend is a refund', () => {
  const rules = [{ match: 'exact', value: 'coles', categoryId: 'groceries' }];
  const result = categoriseTransaction({ amount: 40, merchant: 'Coles' }, rules, new Set(['coles']));
  assert.deepEqual(result, { categoryId: 'groceries', categorySource: 'rule' });
});

test('a positive amount from a merchant with no prior spend is income', () => {
  const rules = [{ match: 'exact', value: 'acme payroll', categoryId: 'groceries' }];
  const result = categoriseTransaction({ amount: 4200, merchant: 'Acme Payroll' }, rules, new Set());
  assert.deepEqual(result, { categoryId: 'income', categorySource: 'rule' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/categorise.test.js`
Expected: FAIL — `Cannot find module '../lib/categorise.js'`

- [ ] **Step 3: Write minimal implementation**

Add to `.gitignore` (so seed data is tracked while real data is not):

```
!data/seed/
```

Create `data/seed/categories.json`:

```json
{
  "groups": [
    { "id": "food-drink", "label": "Food & Drink" },
    { "id": "transport",  "label": "Transport" },
    { "id": "home",       "label": "Home" },
    { "id": "health",     "label": "Health" },
    { "id": "lifestyle",  "label": "Lifestyle" },
    { "id": "money",      "label": "Money" },
    { "id": "other",      "label": "Other" }
  ],
  "categories": [
    { "id": "groceries",         "label": "Groceries",             "groupId": "food-drink" },
    { "id": "restaurants",       "label": "Restaurants",           "groupId": "food-drink" },
    { "id": "takeaway",          "label": "Takeaway",              "groupId": "food-drink" },
    { "id": "coffee",            "label": "Coffee",                "groupId": "food-drink" },
    { "id": "alcohol",           "label": "Alcohol",               "groupId": "food-drink" },

    { "id": "public-transport",  "label": "Public transport",      "groupId": "transport" },
    { "id": "fuel",              "label": "Fuel",                  "groupId": "transport" },
    { "id": "tolls-parking",     "label": "Tolls & parking",       "groupId": "transport" },
    { "id": "rideshare-taxi",    "label": "Rideshare & taxi",      "groupId": "transport" },
    { "id": "car-servicing",     "label": "Car servicing",         "groupId": "transport" },

    { "id": "rent-mortgage",     "label": "Rent/mortgage",         "groupId": "home" },
    { "id": "energy",            "label": "Energy",                "groupId": "home" },
    { "id": "water",             "label": "Water",                 "groupId": "home" },
    { "id": "internet-phone",    "label": "Internet & phone",      "groupId": "home" },
    { "id": "furniture-reno",    "label": "Furniture & renovation","groupId": "home" },

    { "id": "pharmacy",          "label": "Pharmacy",              "groupId": "health" },
    { "id": "doctors",           "label": "Doctors & specialists", "groupId": "health" },
    { "id": "fitness",           "label": "Fitness",               "groupId": "health" },
    { "id": "insurance",         "label": "Insurance",             "groupId": "health" },

    { "id": "shopping",          "label": "Shopping",              "groupId": "lifestyle" },
    { "id": "entertainment",     "label": "Entertainment",         "groupId": "lifestyle" },
    { "id": "subscriptions",     "label": "Subscriptions",         "groupId": "lifestyle" },
    { "id": "travel",            "label": "Travel & holidays",     "groupId": "lifestyle" },
    { "id": "gifts",             "label": "Gifts",                 "groupId": "lifestyle" },

    { "id": "cash",              "label": "Cash withdrawals",      "groupId": "money" },
    { "id": "fees-interest",     "label": "Fees & interest",       "groupId": "money" },
    { "id": "transfers",         "label": "Transfers",             "groupId": "money" },

    { "id": "uncategorised",     "label": "Uncategorised",         "groupId": "other" },
    { "id": "income",            "label": "Income",                "groupId": "other" }
  ]
}
```

Create `data/seed/rules.json` (ordered, most specific first):

```json
[
  { "match": "contains", "value": "coles express",       "categoryId": "fuel" },
  { "match": "contains", "value": "woolworths petrol",   "categoryId": "fuel" },

  { "match": "contains", "value": "coles",               "categoryId": "groceries" },
  { "match": "contains", "value": "woolworths",          "categoryId": "groceries" },
  { "match": "contains", "value": "ww metro",            "categoryId": "groceries" },
  { "match": "contains", "value": "aldi",                "categoryId": "groceries" },
  { "match": "contains", "value": "iga",                 "categoryId": "groceries" },
  { "match": "contains", "value": "foodworks",           "categoryId": "groceries" },
  { "match": "contains", "value": "costco",              "categoryId": "groceries" },
  { "match": "contains", "value": "fruit",               "categoryId": "groceries" },
  { "match": "contains", "value": "bakery",              "categoryId": "groceries" },

  { "match": "contains", "value": "dan murphy",          "categoryId": "alcohol" },
  { "match": "contains", "value": "bws",                 "categoryId": "alcohol" },
  { "match": "contains", "value": "liquorland",          "categoryId": "alcohol" },
  { "match": "contains", "value": "cellarbrations",      "categoryId": "alcohol" },
  { "match": "contains", "value": "brewing",             "categoryId": "alcohol" },

  { "match": "contains", "value": "mcdonalds",           "categoryId": "takeaway" },
  { "match": "contains", "value": "kfc",                 "categoryId": "takeaway" },
  { "match": "contains", "value": "hungry jack",         "categoryId": "takeaway" },
  { "match": "contains", "value": "domino",              "categoryId": "takeaway" },
  { "match": "contains", "value": "guzman",              "categoryId": "takeaway" },
  { "match": "contains", "value": "uber eats",           "categoryId": "takeaway" },
  { "match": "contains", "value": "menulog",             "categoryId": "takeaway" },
  { "match": "contains", "value": "doordash",            "categoryId": "takeaway" },

  { "match": "contains", "value": "cafe",                "categoryId": "coffee" },
  { "match": "contains", "value": "coffee",              "categoryId": "coffee" },

  { "match": "contains", "value": "myki",                "categoryId": "public-transport" },
  { "match": "contains", "value": "ptv",                 "categoryId": "public-transport" },
  { "match": "contains", "value": "opal",                "categoryId": "public-transport" },
  { "match": "contains", "value": "metro trains",        "categoryId": "public-transport" },
  { "match": "contains", "value": "v/line",              "categoryId": "public-transport" },

  { "match": "contains", "value": "etoll",               "categoryId": "tolls-parking" },
  { "match": "contains", "value": "linkt",               "categoryId": "tolls-parking" },
  { "match": "contains", "value": "citylink",            "categoryId": "tolls-parking" },
  { "match": "contains", "value": "eastlink",            "categoryId": "tolls-parking" },
  { "match": "contains", "value": "wilson parking",      "categoryId": "tolls-parking" },
  { "match": "contains", "value": "secure parking",      "categoryId": "tolls-parking" },

  { "match": "contains", "value": "uber",                "categoryId": "rideshare-taxi" },
  { "match": "contains", "value": "didi",                "categoryId": "rideshare-taxi" },
  { "match": "contains", "value": "ola ",                "categoryId": "rideshare-taxi" },
  { "match": "contains", "value": "13cabs",              "categoryId": "rideshare-taxi" },

  { "match": "contains", "value": "liberty oil",         "categoryId": "fuel" },
  { "match": "contains", "value": "bp ",                 "categoryId": "fuel" },
  { "match": "contains", "value": "shell",               "categoryId": "fuel" },
  { "match": "contains", "value": "ampol",               "categoryId": "fuel" },
  { "match": "contains", "value": "caltex",              "categoryId": "fuel" },
  { "match": "contains", "value": "7-eleven",            "categoryId": "fuel" },
  { "match": "contains", "value": "united petroleum",    "categoryId": "fuel" },

  { "match": "contains", "value": "chemist warehouse",   "categoryId": "pharmacy" },
  { "match": "contains", "value": "priceline",           "categoryId": "pharmacy" },
  { "match": "contains", "value": "pharmacy",            "categoryId": "pharmacy" },
  { "match": "contains", "value": "amcal",               "categoryId": "pharmacy" },

  { "match": "contains", "value": "medical",             "categoryId": "doctors" },
  { "match": "contains", "value": "dental",              "categoryId": "doctors" },
  { "match": "contains", "value": "pathology",           "categoryId": "doctors" },
  { "match": "contains", "value": "diagnostics",         "categoryId": "doctors" },
  { "match": "contains", "value": "radiology",           "categoryId": "doctors" },

  { "match": "contains", "value": "ovo energy",          "categoryId": "energy" },
  { "match": "contains", "value": "agl",                 "categoryId": "energy" },
  { "match": "contains", "value": "origin energy",       "categoryId": "energy" },
  { "match": "contains", "value": "energy australia",    "categoryId": "energy" },
  { "match": "contains", "value": "red energy",          "categoryId": "energy" },
  { "match": "contains", "value": "yarra valley water",  "categoryId": "water" },
  { "match": "contains", "value": "sydney water",        "categoryId": "water" },

  { "match": "contains", "value": "amaysim",             "categoryId": "internet-phone" },
  { "match": "contains", "value": "telstra",             "categoryId": "internet-phone" },
  { "match": "contains", "value": "optus",               "categoryId": "internet-phone" },
  { "match": "contains", "value": "vodafone",            "categoryId": "internet-phone" },
  { "match": "contains", "value": "aussie broadband",    "categoryId": "internet-phone" },
  { "match": "contains", "value": "belong",              "categoryId": "internet-phone" },

  { "match": "contains", "value": "netflix",             "categoryId": "subscriptions" },
  { "match": "contains", "value": "spotify",             "categoryId": "subscriptions" },
  { "match": "contains", "value": "disney",              "categoryId": "subscriptions" },
  { "match": "contains", "value": "stan.com",            "categoryId": "subscriptions" },
  { "match": "contains", "value": "binge",               "categoryId": "subscriptions" },
  { "match": "contains", "value": "google cloud",        "categoryId": "subscriptions" },
  { "match": "contains", "value": "apple.com",           "categoryId": "subscriptions" },
  { "match": "contains", "value": "amazon prime",        "categoryId": "subscriptions" },

  { "match": "contains", "value": "bunnings",            "categoryId": "furniture-reno" },
  { "match": "contains", "value": "ikea",                "categoryId": "furniture-reno" },

  { "match": "contains", "value": "kmart",               "categoryId": "shopping" },
  { "match": "contains", "value": "target",              "categoryId": "shopping" },
  { "match": "contains", "value": "big w",               "categoryId": "shopping" },
  { "match": "contains", "value": "myer",                "categoryId": "shopping" },
  { "match": "contains", "value": "amazon",              "categoryId": "shopping" },
  { "match": "contains", "value": "ebay",                "categoryId": "shopping" },

  { "match": "contains", "value": "bandroom",            "categoryId": "entertainment" },
  { "match": "contains", "value": "cinema",              "categoryId": "entertainment" },
  { "match": "contains", "value": "hoyts",               "categoryId": "entertainment" },
  { "match": "contains", "value": "ticketek",            "categoryId": "entertainment" },
  { "match": "contains", "value": "eventbrite",          "categoryId": "entertainment" },

  { "match": "contains", "value": "qantas",              "categoryId": "travel" },
  { "match": "contains", "value": "jetstar",             "categoryId": "travel" },
  { "match": "contains", "value": "virgin australia",    "categoryId": "travel" },
  { "match": "contains", "value": "airbnb",              "categoryId": "travel" },
  { "match": "contains", "value": "booking.com",         "categoryId": "travel" },

  { "match": "contains", "value": "atm",                 "categoryId": "cash" },
  { "match": "contains", "value": "transfer to",         "categoryId": "transfers" },
  { "match": "contains", "value": "transfer from",       "categoryId": "transfers" },
  { "match": "contains", "value": "account fee",         "categoryId": "fees-interest" },
  { "match": "contains", "value": "interest charged",    "categoryId": "fees-interest" }
]
```

Create `lib/categorise.js`:

```js
/**
 * Find the categoryId for a merchant using an ordered rule list.
 * Rules are evaluated top-down and the first match wins, so more specific
 * rules must appear before more general ones. Returns null if nothing matches.
 */
export function matchRule(merchant, rules) {
  const subject = String(merchant ?? '').toLowerCase().trim();
  if (subject === '') return null;

  for (const rule of rules ?? []) {
    const value = String(rule.value ?? '').toLowerCase();
    if (value === '') continue;

    if (rule.match === 'exact') {
      if (subject === value) return rule.categoryId;
    } else if (rule.match === 'contains') {
      if (subject.includes(value)) return rule.categoryId;
    } else if (rule.match === 'regex') {
      try {
        if (new RegExp(rule.value, 'i').test(merchant)) return rule.categoryId;
      } catch {
        // A malformed user-authored regex must never break an import.
        continue;
      }
    }
  }
  return null;
}

/**
 * Decide a transaction's category.
 *
 * Spend (negative): rule match, else uncategorised.
 * Positive amount: treated as a refund and given the merchant's own category
 * ONLY if that merchant has prior spend; otherwise it is income. This stops a
 * salary deposit being netted against a spending category.
 */
export function categoriseTransaction(txn, rules, merchantsWithPriorSpend) {
  const merchantKey = String(txn.merchant ?? '').toLowerCase().trim();

  if (txn.amount > 0 && !merchantsWithPriorSpend.has(merchantKey)) {
    return { categoryId: 'income', categorySource: 'rule' };
  }

  const categoryId = matchRule(txn.merchant, rules);
  if (categoryId) return { categoryId, categorySource: 'rule' };
  return { categoryId: 'uncategorised', categorySource: 'unknown' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/categorise.test.js`
Expected: PASS — `# pass 11`

- [ ] **Step 5: Commit**

```bash
git add data/seed lib/categorise.js tests/categorise.test.js CHANGELOG.md .gitignore
git commit -m "feat: add seed taxonomy and merchant rule matching"
```

---

## Task 7: Ingest orchestration

**Files:**
- Create: `lib/ingest.js`
- Test: `tests/ingest.test.js`, `tests/fixtures/sample-commbank.csv`

**Interfaces:**
- Consumes: `parseCsv`, `sniffFormat`, `parseDate`, `parseAmount`, `normaliseMerchant`, `extractCardSuffix`, `assignOccurrenceIndexes`, `transactionId`, `categoriseTransaction`
- Produces:
  ```js
  ingest({ text, accountId, importId, rules, existingIds, existingMerchants, mappingOverride })
  // → { format, transactions, duplicates, malformed, summary }
  //   transactions: full records ready to append (duplicates already removed)
  //   duplicates:   count of rows already present in the ledger
  //   malformed:    [{ line, raw, reason }]
  //   summary:      { rowsRead, added, duplicates, autoCategorised, needsReview,
  //                   dateFrom, dateTo, totalSpend, totalIncome }
  ```

**Critical design point:** the import *preview* and the import *commit* both call this one function with identical arguments. A preview that can disagree with the commit is a whole class of bug that simply cannot occur if there is only one code path.

- [ ] **Step 1: Write the failing test**

Create `tests/fixtures/sample-commbank.csv` with these six lines (a trimmed copy of the real export shape):

```
22/08/2026,"MYKI PAYMENTS MELBOURNE  AUS Card xx8765 Value Date: 21/08/2026","Everyday Account 1234 5678","Auto & transport","-10.00"
18/08/2026,"COLES 0592 COBURG VI AUS Card xx4321 Value Date: 14/08/2026","Everyday Account 1234 5678","Groceries & household","-64.15"
18/08/2026,"COLES 0592 COBURG VI AUS Card xx4321 Value Date: 14/08/2026","Everyday Account 1234 5678","Groceries & household","-31.50"
16/08/2026,"SUNSHINE DELI BALWYN NORTH VIC              AU","Everyday Account 1234 5678","Uncategorised","-22.39"
13/08/2026,"Transfer To Sam Rivers CommBank App birthday gift","Everyday Account 1234 5678","Gifts & donations","-100.00"
11/08/2026,"CITY DIAGNOSTICS GREENWICH  AUS Card xx4321 Value Date: 07/08/2026","Everyday Account 1234 5678","Uncategorised","-286.48"
```

Create `tests/ingest.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ingest } from '../lib/ingest.js';

const RULES = [
  { match: 'contains', value: 'coles',       categoryId: 'groceries' },
  { match: 'contains', value: 'myki',        categoryId: 'public-transport' },
  { match: 'contains', value: 'diagnostics', categoryId: 'doctors' },
  { match: 'contains', value: 'transfer to', categoryId: 'transfers' }
];

const loadFixture = () =>
  readFile(new URL('./fixtures/sample-commbank.csv', import.meta.url), 'utf8');

const run = async (overrides = {}) => ingest({
  text: await loadFixture(),
  accountId: 'spending',
  importId: 'imp_test_001',
  rules: RULES,
  existingIds: new Set(),
  existingMerchants: new Set(),
  ...overrides
});

test('reads every row and builds a transaction for each', async () => {
  const r = await run();
  assert.equal(r.summary.rowsRead, 6);
  assert.equal(r.transactions.length, 6);
  assert.equal(r.malformed.length, 0);
});

test('normalises dates to ISO and keeps the raw description', async () => {
  const t = (await run()).transactions[0];
  assert.equal(t.date, '2026-08-22');
  assert.match(t.rawDescription, /^MYKI PAYMENTS MELBOURNE/);
  assert.equal(t.merchant, 'Myki Payments');
  assert.equal(t.cardSuffix, '8765');
  assert.equal(t.accountId, 'spending');
  assert.equal(t.importId, 'imp_test_001');
  assert.equal(t.excluded, false);
  assert.equal(t.note, null);
});

test('spend is stored as a negative number', async () => {
  const r = await run();
  assert.ok(r.transactions.every((t) => t.amount < 0));
  assert.equal(r.summary.totalSpend, -514.52);
  assert.equal(r.summary.totalIncome, 0);
});

test('ignores the bank supplied category column', async () => {
  const r = await run();
  const virtus = r.transactions.find((t) => t.merchant.startsWith('City Diagnostics'));
  // The bank called this "Uncategorised"; our rules call it doctors.
  assert.equal(virtus.categoryId, 'doctors');
  assert.equal(virtus.categorySource, 'rule');
});

test('unmatched merchants are flagged for review', async () => {
  const r = await run();
  const rong = r.transactions.find((t) => t.merchant === 'Sunshine Deli');
  assert.equal(rong.categoryId, 'uncategorised');
  assert.equal(rong.categorySource, 'unknown');
  assert.equal(r.summary.needsReview, 1);
  assert.equal(r.summary.autoCategorised, 5);
});

test('reports the date range', async () => {
  const r = await run();
  assert.equal(r.summary.dateFrom, '2026-08-11');
  assert.equal(r.summary.dateTo, '2026-08-22');
});

test('re-importing the same file adds nothing', async () => {
  const first = await run();
  const second = await run({ existingIds: new Set(first.transactions.map((t) => t.id)) });
  assert.equal(second.transactions.length, 0);
  assert.equal(second.summary.added, 0);
  assert.equal(second.summary.duplicates, 6);
});

test('the two same-day Coles rows both survive', async () => {
  const r = await run();
  const coles = r.transactions.filter((t) => t.merchant === 'Coles');
  assert.equal(coles.length, 2);
  assert.equal(new Set(coles.map((t) => t.id)).size, 2);
});

test('malformed rows are skipped with a reason, not fatal', async () => {
  const text = await loadFixture() + '\nnot-a-date,"BROKEN ROW","acct","cat","abc"\n';
  const r = await ingest({
    text, accountId: 'spending', importId: 'imp_test_002', rules: RULES,
    existingIds: new Set(), existingMerchants: new Set()
  });
  assert.equal(r.transactions.length, 6);
  assert.equal(r.malformed.length, 1);
  assert.match(r.malformed[0].reason, /date|amount/i);
  assert.equal(r.malformed[0].line, 7);
});

test('a positive-spend file is normalised to negative', async () => {
  const text = '22/08/2026,"COLES 0592 COBURG","64.15"\n21/08/2026,"MYKI PAYMENTS","10.00"';
  const r = await ingest({
    text, accountId: 'card', importId: 'imp_test_003', rules: RULES,
    existingIds: new Set(), existingMerchants: new Set()
  });
  assert.equal(r.format.spendSign, 'positive');
  assert.ok(r.transactions.every((t) => t.amount < 0));
  assert.equal(r.summary.totalSpend, -74.15);
});

test('a mapping override wins over sniffing', async () => {
  const text = '22/08/2026,"COLES 0592 COBURG","acct","cat","-64.15"';
  const r = await ingest({
    text, accountId: 'spending', importId: 'imp_test_004', rules: RULES,
    existingIds: new Set(), existingMerchants: new Set(),
    mappingOverride: {
      mapping: { date: 0, description: 1, account: 2, category: 3, amount: 4 },
      dateFormat: 'DD/MM/YYYY', spendSign: 'negative', hasHeader: false
    }
  });
  assert.equal(r.transactions[0].merchant, 'Coles');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/ingest.test.js`
Expected: FAIL — `Cannot find module '../lib/ingest.js'`

- [ ] **Step 3: Write minimal implementation**

Create `lib/ingest.js`:

```js
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
 * arguments, so what the user confirms is exactly what gets written.
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

    const rawDescription =
      (mapping.description === null ? '' : (row[mapping.description] ?? '')).trim();

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/ingest.test.js`
Expected: PASS — `# pass 11`

- [ ] **Step 5: Commit**

```bash
git add lib/ingest.js tests/ingest.test.js tests/fixtures CHANGELOG.md
git commit -m "feat: add ingest pipeline turning CSV text into ledger transactions"
```

---

## Task 8: Storage layer

**Files:**
- Create: `server/store.js`
- Test: `tests/store.test.js`

**Interfaces:**
- Consumes: `data/seed/categories.json`, `data/seed/rules.json`
- Produces: `createStore(dataDir) → store` with
  - `store.read(name) → Promise<any>` — `name` is one of `ledger`, `categories`, `rules`, `accounts`, `views`, `imports`
  - `store.write(name, data) → Promise<void>` — atomic
  - `store.init() → Promise<void>` — creates `dataDir` and seeds missing files
  - `store.backup() → Promise<string>` — copies all data files into `data/backups/<timestamp>/`, returns the path

- [ ] **Step 1: Write the failing test**

Create `tests/store.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../server/store.js';

const withStore = async (fn) => {
  const dir = await mkdtemp(join(tmpdir(), 'spendexplore-'));
  try { await fn(await (async () => { const s = createStore(dir); await s.init(); return s; })(), dir); }
  finally { await rm(dir, { recursive: true, force: true }); }
};

test('init seeds categories and rules but starts with an empty ledger', async () => {
  await withStore(async (store) => {
    const categories = await store.read('categories');
    assert.ok(categories.groups.length >= 7);
    assert.ok((await store.read('rules')).length > 20);
    assert.deepEqual(await store.read('ledger'), []);
    assert.deepEqual(await store.read('imports'), []);
    assert.deepEqual(await store.read('views'), []);
    assert.deepEqual(await store.read('accounts'), []);
  });
});

test('init does not overwrite existing data', async () => {
  await withStore(async (store, dir) => {
    await store.write('ledger', [{ id: 'abc' }]);
    await createStore(dir).init();
    assert.deepEqual(await store.read('ledger'), [{ id: 'abc' }]);
  });
});

test('write then read round-trips', async () => {
  await withStore(async (store) => {
    await store.write('ledger', [{ id: 'x', amount: -1.5 }]);
    assert.deepEqual(await store.read('ledger'), [{ id: 'x', amount: -1.5 }]);
  });
});

test('write leaves no temp file behind', async () => {
  await withStore(async (store, dir) => {
    await store.write('ledger', [{ id: 'x' }]);
    const files = await readdir(dir);
    assert.ok(!files.some((f) => f.endsWith('.tmp')), `temp file left: ${files}`);
  });
});

test('backup copies current data and returns its path', async () => {
  await withStore(async (store) => {
    await store.write('ledger', [{ id: 'before' }]);
    const path = await store.backup();
    await store.write('ledger', [{ id: 'after' }]);
    const backed = JSON.parse(await readFile(join(path, 'ledger.json'), 'utf8'));
    assert.deepEqual(backed, [{ id: 'before' }]);
    assert.deepEqual(await store.read('ledger'), [{ id: 'after' }]);
  });
});

test('reading a corrupt file throws a message naming the file', async () => {
  await withStore(async (store, dir) => {
    await writeFile(join(dir, 'ledger.json'), '{ not json');
    await assert.rejects(() => store.read('ledger'), /ledger\.json/);
  });
});

test('rejects an unknown collection name', async () => {
  await withStore(async (store) => {
    await assert.rejects(() => store.read('../../etc/passwd'), /Unknown collection/);
    await assert.rejects(() => store.write('evil', []), /Unknown collection/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/store.test.js`
Expected: FAIL — `Cannot find module '../server/store.js'`

- [ ] **Step 3: Write minimal implementation**

Create `server/store.js`:

```js
import { readFile, writeFile, rename, mkdir, copyFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEED_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'seed');

// Allow-list of collection names. This is also the defence against a path
// traversal via a crafted API request, so it must stay exhaustive.
const COLLECTIONS = {
  ledger:     { file: 'ledger.json',     seed: () => [] },
  categories: { file: 'categories.json', seedFile: 'categories.json' },
  rules:      { file: 'rules.json',      seedFile: 'rules.json' },
  accounts:   { file: 'accounts.json',   seed: () => [] },
  views:      { file: 'views.json',      seed: () => [] },
  imports:    { file: 'imports.json',    seed: () => [] }
};

const exists = async (path) => {
  try { await access(path); return true; } catch { return false; }
};

export function createStore(dataDir) {
  const pathFor = (name) => {
    const spec = COLLECTIONS[name];
    if (!spec) throw new Error(`Unknown collection: ${name}`);
    return join(dataDir, spec.file);
  };

  async function read(name) {
    const path = pathFor(name);
    let text;
    try {
      text = await readFile(path, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return structuredClone(await defaultFor(name));
      throw err;
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(
        `${COLLECTIONS[name].file} is not valid JSON. ` +
        `Restore it from data/backups/ before starting again.`
      );
    }
  }

  /** Atomic: write a temp file then rename, so the target is never half-written. */
  async function write(name, data) {
    const path = pathFor(name);
    const tmp = `${path}.tmp`;
    await mkdir(dataDir, { recursive: true });
    await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await rename(tmp, path);
  }

  async function defaultFor(name) {
    const spec = COLLECTIONS[name];
    if (spec.seedFile) return JSON.parse(await readFile(join(SEED_DIR, spec.seedFile), 'utf8'));
    return spec.seed();
  }

  async function init() {
    await mkdir(dataDir, { recursive: true });
    for (const name of Object.keys(COLLECTIONS)) {
      if (!(await exists(pathFor(name)))) await write(name, await defaultFor(name));
    }
  }

  async function backup() {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = join(dataDir, 'backups', stamp);
    await mkdir(dir, { recursive: true });
    for (const name of Object.keys(COLLECTIONS)) {
      const src = pathFor(name);
      if (await exists(src)) await copyFile(src, join(dir, COLLECTIONS[name].file));
    }
    return dir;
  }

  return { read, write, init, backup, dataDir };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/store.test.js`
Expected: PASS — `# pass 7`

- [ ] **Step 5: Commit**

```bash
git add server/store.js tests/store.test.js CHANGELOG.md
git commit -m "feat: add atomic JSON store with seeding and backups"
```

---

## Task 9: HTTP server and snapshot endpoint

**Files:**
- Create: `server/routes.js`, `server/index.js`
- Test: `tests/routes.test.js`

**Interfaces:**
- Consumes: `createStore`
- Produces:
  - `createApp(store) → (req, res) => void` — a `node:http` request handler
  - `startServer({ port, dataDir }) → Promise<{ server, port, close }>`
  - `GET /api/snapshot → { transactions, categories, rules, accounts, views, imports }`

- [ ] **Step 1: Write the failing test**

Create `tests/routes.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/index.js';

const withServer = async (fn) => {
  const dir = await mkdtemp(join(tmpdir(), 'spendexplore-srv-'));
  const app = await startServer({ port: 0, dataDir: dir });
  try { await fn(`http://127.0.0.1:${app.port}`, dir); }
  finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
};

test('binds to loopback only', async () => {
  await withServer(async (base) => {
    const address = new URL(base);
    assert.equal(address.hostname, '127.0.0.1');
    assert.equal((await fetch(`${base}/api/snapshot`)).status, 200);
  });
});

test('snapshot returns every collection', async () => {
  await withServer(async (base) => {
    const body = await (await fetch(`${base}/api/snapshot`)).json();
    assert.deepEqual(body.transactions, []);
    assert.ok(body.categories.groups.length >= 7);
    assert.ok(body.rules.length > 20);
    assert.deepEqual(body.accounts, []);
    assert.deepEqual(body.views, []);
    assert.deepEqual(body.imports, []);
  });
});

test('unknown api route returns 404 JSON', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/nope`);
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, 'Not found');
  });
});

test('serves the web UI at /', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(await res.text(), /SpendExplore/);
  });
});

test('refuses path traversal in static paths', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/../server/store.js`, { redirect: 'manual' });
    assert.ok([400, 404].includes(res.status), `unexpected status ${res.status}`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/routes.test.js`
Expected: FAIL — `Cannot find module '../server/index.js'`

- [ ] **Step 3: Write minimal implementation**

Create `server/routes.js`:

```js
import { readFile } from 'node:fs/promises';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

export const sendJson = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload)
  });
  res.end(payload);
};

export const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    // Guard against an unbounded upload filling memory.
    if (size > 50 * 1024 * 1024) { reject(new Error('Request body too large (limit 50MB)')); req.destroy(); return; }
    chunks.push(chunk);
  });
  req.on('end', () => {
    const text = Buffer.concat(chunks).toString('utf8');
    if (text === '') return resolve({});
    try { resolve(JSON.parse(text)); } catch { reject(new Error('Request body is not valid JSON')); }
  });
  req.on('error', reject);
});

export async function serveStatic(req, res, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  // normalize() then reject anything that escapes WEB_DIR.
  const target = normalize(join(WEB_DIR, relative));
  if (!target.startsWith(WEB_DIR)) return sendJson(res, 400, { error: 'Bad path' });

  try {
    const body = await readFile(target);
    res.writeHead(200, {
      'content-type': MIME[extname(target)] ?? 'application/octet-stream',
      'cache-control': 'no-store'
    });
    res.end(body);
  } catch {
    sendJson(res, 404, { error: 'Not found' });
  }
}

export function createRouter(store) {
  return async function route(req, res, pathname) {
    if (req.method === 'GET' && pathname === '/api/snapshot') {
      const [transactions, categories, rules, accounts, views, imports] = await Promise.all([
        store.read('ledger'), store.read('categories'), store.read('rules'),
        store.read('accounts'), store.read('views'), store.read('imports')
      ]);
      return sendJson(res, 200, { transactions, categories, rules, accounts, views, imports });
    }
    return sendJson(res, 404, { error: 'Not found' });
  };
}
```

Create `server/index.js`:

```js
import { createServer } from 'node:http';
import { createStore } from './store.js';
import { createRouter, serveStatic, sendJson } from './routes.js';

const HOST = '127.0.0.1';   // loopback only, never 0.0.0.0

export function createApp(store) {
  const route = createRouter(store);
  return async (req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, `http://${HOST}`).pathname);
    } catch {
      return sendJson(res, 400, { error: 'Bad path' });
    }
    try {
      if (pathname.startsWith('/api/')) return await route(req, res, pathname);
      return await serveStatic(req, res, pathname);
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
  };
}

export async function startServer({ port = 5173, dataDir } = {}) {
  const store = createStore(dataDir ?? new URL('../data/', import.meta.url).pathname);
  await store.init();

  const server = createServer(createApp(store));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, resolve);
  });

  return {
    server,
    store,
    port: server.address().port,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

// Only auto-start when run directly, so tests can import without listening.
if (import.meta.url === `file://${process.argv[1]}`) {
  const app = await startServer({ port: Number(process.env.PORT) || 5173 });
  console.log(`SpendExplore running at http://${HOST}:${app.port}`);
}
```

Create a placeholder `web/index.html` so the static test passes (Task 12 replaces it):

```html
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>SpendExplore</title></head>
  <body><h1>SpendExplore</h1></body>
</html>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/routes.test.js`
Expected: PASS — `# pass 5`

- [ ] **Step 5: Commit**

```bash
git add server/routes.js server/index.js web/index.html tests/routes.test.js CHANGELOG.md
git commit -m "feat: add loopback-only HTTP server with snapshot endpoint"
```

---

## Task 10: Import preview and commit endpoints

**Files:**
- Modify: `server/routes.js` (add handlers to `createRouter`)
- Test: `tests/import-routes.test.js`

**Interfaces:**
- Consumes: `ingest`, `store`
- Produces:
  - `POST /api/import/preview` — body `{ files: [{ filename, text }], accountId?, mappingOverride? }` → `{ previews: [{ filename, accountId, format, summary, malformed, sampleTransactions }] }`. **Writes nothing.**
  - `POST /api/import/commit` — same body → `{ results: [...], importIds: [...] }`. Backs up, appends, logs.
  - `DELETE /api/import/:importId` → `{ removed: n }`

- [ ] **Step 1: Write the failing test**

Create `tests/import-routes.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/index.js';

const CSV = await readFile(new URL('./fixtures/sample-commbank.csv', import.meta.url), 'utf8');

const withServer = async (fn) => {
  const dir = await mkdtemp(join(tmpdir(), 'spendexplore-imp-'));
  const app = await startServer({ port: 0, dataDir: dir });
  try { await fn(`http://127.0.0.1:${app.port}`, app.store); }
  finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
};

const post = (base, path, body) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });

const files = [{ filename: 'aug.csv', text: CSV }];

test('preview reports what would happen and writes nothing', async () => {
  await withServer(async (base, store) => {
    const body = await (await post(base, '/api/import/preview', { files })).json();
    const p = body.previews[0];
    assert.equal(p.filename, 'aug.csv');
    assert.equal(p.summary.rowsRead, 6);
    assert.equal(p.summary.added, 6);
    assert.equal(p.summary.dateFrom, '2026-08-11');
    assert.equal(p.format.dateFormat, 'DD/MM/YYYY');
    assert.equal(p.format.spendSign, 'negative');
    assert.ok(Array.isArray(p.sampleTransactions));
    assert.deepEqual(await store.read('ledger'), []);
    assert.deepEqual(await store.read('imports'), []);
  });
});

test('commit appends transactions and logs the import', async () => {
  await withServer(async (base, store) => {
    const body = await (await post(base, '/api/import/commit', { files })).json();
    assert.equal(body.results[0].summary.added, 6);
    assert.equal((await store.read('ledger')).length, 6);
    const log = await store.read('imports');
    assert.equal(log.length, 1);
    assert.equal(log[0].filename, 'aug.csv');
    assert.equal(log[0].rowsRead, 6);
    assert.ok(log[0].importId.startsWith('imp_'));
    assert.ok(log[0].timestamp);
  });
});

test('committing the same file twice adds nothing the second time', async () => {
  await withServer(async (base, store) => {
    await post(base, '/api/import/commit', { files });
    const second = await (await post(base, '/api/import/commit', { files })).json();
    assert.equal(second.results[0].summary.added, 0);
    assert.equal(second.results[0].summary.duplicates, 6);
    assert.equal((await store.read('ledger')).length, 6);
  });
});

test('multiple files import in one request', async () => {
  await withServer(async (base, store) => {
    const two = [
      { filename: 'a.csv', text: CSV },
      { filename: 'b.csv', text: '01/08/2026,"ALDI STORES PRESTON VICAU","acct","cat","-44.43"' }
    ];
    const body = await (await post(base, '/api/import/commit', { files: two })).json();
    assert.equal(body.results.length, 2);
    assert.equal((await store.read('ledger')).length, 7);
  });
});

test('preview surfaces malformed rows without failing', async () => {
  await withServer(async (base) => {
    const bad = [{ filename: 'bad.csv', text: CSV + '\nnope,"X","a","b","zz"\n' }];
    const body = await (await post(base, '/api/import/preview', { files: bad })).json();
    assert.equal(body.previews[0].malformed.length, 1);
    assert.equal(body.previews[0].summary.added, 6);
  });
});

test('an import can be rolled back by id', async () => {
  await withServer(async (base, store) => {
    const body = await (await post(base, '/api/import/commit', { files })).json();
    const importId = body.results[0].importId;
    const res = await fetch(`${base}/api/import/${importId}`, { method: 'DELETE' });
    assert.equal((await res.json()).removed, 6);
    assert.deepEqual(await store.read('ledger'), []);
  });
});

test('rejects a request with no files', async () => {
  await withServer(async (base) => {
    const res = await post(base, '/api/import/preview', { files: [] });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /file/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/import-routes.test.js`
Expected: FAIL — 404 responses; assertions on `previews` fail with `Cannot read properties of undefined`

- [ ] **Step 3: Write minimal implementation**

In `server/routes.js`, add the import at the top:

```js
import { ingest } from '../lib/ingest.js';
```

Then replace the body of `createRouter` with:

```js
export function createRouter(store) {
  const nextImportId = (existing, filename, stamp) => {
    const day = stamp.slice(0, 10);
    const seq = existing.filter((i) => i.importId.includes(day)).length + 1;
    return `imp_${day}_${String(seq).padStart(3, '0')}_${filename.replace(/[^a-z0-9]/gi, '').slice(0, 12)}`;
  };

  async function runIngest(files, accountId, mappingOverride, ledger, rules) {
    const existingIds = new Set(ledger.map((t) => t.id));
    const existingMerchants = new Set(
      ledger.filter((t) => t.amount < 0).map((t) => String(t.merchant).toLowerCase())
    );
    const imports = await store.read('imports');
    const stamp = new Date().toISOString();
    const results = [];

    for (const file of files) {
      const importId = nextImportId([...imports, ...results], file.filename, stamp);
      const result = ingest({
        text: file.text,
        accountId: accountId ?? 'default',
        importId,
        rules,
        existingIds,
        existingMerchants,
        mappingOverride: mappingOverride ?? null
      });
      // Later files in the same request must see earlier files' rows.
      for (const t of result.transactions) {
        existingIds.add(t.id);
        if (t.amount < 0) existingMerchants.add(String(t.merchant).toLowerCase());
      }
      results.push({ ...result, importId, filename: file.filename, timestamp: stamp });
    }
    return results;
  }

  return async function route(req, res, pathname) {
    if (req.method === 'GET' && pathname === '/api/snapshot') {
      const [transactions, categories, rules, accounts, views, imports] = await Promise.all([
        store.read('ledger'), store.read('categories'), store.read('rules'),
        store.read('accounts'), store.read('views'), store.read('imports')
      ]);
      return sendJson(res, 200, { transactions, categories, rules, accounts, views, imports });
    }

    if (req.method === 'POST' && (pathname === '/api/import/preview' || pathname === '/api/import/commit')) {
      const body = await readBody(req);
      const files = body.files ?? [];
      if (!Array.isArray(files) || files.length === 0) {
        return sendJson(res, 400, { error: 'No files supplied' });
      }
      for (const f of files) {
        if (typeof f?.text !== 'string' || typeof f?.filename !== 'string') {
          return sendJson(res, 400, { error: 'Each file needs a filename and text' });
        }
      }

      const [ledger, rules] = await Promise.all([store.read('ledger'), store.read('rules')]);
      const results = await runIngest(files, body.accountId, body.mappingOverride, ledger, rules);

      if (pathname === '/api/import/preview') {
        return sendJson(res, 200, {
          previews: results.map((r) => ({
            filename: r.filename,
            accountId: body.accountId ?? 'default',
            format: r.format,
            summary: r.summary,
            malformed: r.malformed,
            sampleTransactions: r.transactions.slice(0, 8)
          }))
        });
      }

      // Commit: back up first, so a bad import is always recoverable.
      await store.backup();
      const added = results.flatMap((r) => r.transactions);
      await store.write('ledger', [...ledger, ...added]);

      const imports = await store.read('imports');
      await store.write('imports', [
        ...imports,
        ...results.map((r) => ({
          importId: r.importId,
          filename: r.filename,
          timestamp: r.timestamp,
          accountId: body.accountId ?? 'default',
          rowsRead: r.summary.rowsRead,
          added: r.summary.added,
          duplicates: r.summary.duplicates,
          malformed: r.malformed.length,
          dateFrom: r.summary.dateFrom,
          dateTo: r.summary.dateTo
        }))
      ]);

      return sendJson(res, 200, {
        results: results.map((r) => ({
          filename: r.filename, importId: r.importId,
          summary: r.summary, malformed: r.malformed
        }))
      });
    }

    const rollback = pathname.match(/^\/api\/import\/([A-Za-z0-9_-]+)$/);
    if (req.method === 'DELETE' && rollback) {
      const importId = rollback[1];
      const ledger = await store.read('ledger');
      const kept = ledger.filter((t) => t.importId !== importId);
      const removed = ledger.length - kept.length;
      if (removed > 0) {
        await store.backup();
        await store.write('ledger', kept);
        const imports = await store.read('imports');
        await store.write('imports', imports.filter((i) => i.importId !== importId));
      }
      return sendJson(res, 200, { removed });
    }

    return sendJson(res, 404, { error: 'Not found' });
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/import-routes.test.js`
Expected: PASS — `# pass 7`

Then run the whole suite: `npm test`
Expected: PASS — all tests from Tasks 1–10

- [ ] **Step 5: Commit**

```bash
git add server/routes.js tests/import-routes.test.js CHANGELOG.md
git commit -m "feat: add import preview, commit and rollback endpoints"
```

---

## Task 11: Transaction editing and rule learning

**Files:**
- Modify: `server/routes.js`
- Test: `tests/transaction-routes.test.js`

**Interfaces:**
- Consumes: `store`
- Produces:
  - `PATCH /api/transactions/:id` — body `{ categoryId?, excluded?, note?, applyToPast?, rememberRule? }` → `{ transaction, updatedPast, ruleAdded }`
  - `POST /api/categories` — body `{ id, label, groupId }` → `{ categories }`

Behaviour required by the spec: setting a `categoryId` marks the transaction `categorySource: "manual"`. Past transactions are updated **only** when `applyToPast` is explicitly `true` (default off), and a rule is saved **only** when `rememberRule` is explicitly `true` (default on in the UI, but the server never assumes). A `manual` transaction is never overwritten by a bulk apply.

- [ ] **Step 1: Write the failing test**

Create `tests/transaction-routes.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/index.js';

const CSV = await readFile(new URL('./fixtures/sample-commbank.csv', import.meta.url), 'utf8');

const withImported = async (fn) => {
  const dir = await mkdtemp(join(tmpdir(), 'spendexplore-txn-'));
  const app = await startServer({ port: 0, dataDir: dir });
  const base = `http://127.0.0.1:${app.port}`;
  await fetch(`${base}/api/import/commit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ files: [{ filename: 'aug.csv', text: CSV }] })
  });
  try { await fn(base, app.store); }
  finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
};

const patch = (base, id, body) =>
  fetch(`${base}/api/transactions/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });

test('setting a category marks the source manual', async () => {
  await withImported(async (base, store) => {
    const rong = (await store.read('ledger')).find((t) => t.merchant === 'Sunshine Deli');
    const body = await (await patch(base, rong.id, { categoryId: 'restaurants' })).json();
    assert.equal(body.transaction.categoryId, 'restaurants');
    assert.equal(body.transaction.categorySource, 'manual');
    assert.equal(body.updatedPast, 0);
    assert.equal(body.ruleAdded, false);
  });
});

test('past transactions are untouched unless applyToPast is true', async () => {
  await withImported(async (base, store) => {
    const coles = (await store.read('ledger')).filter((t) => t.merchant === 'Coles');
    await patch(base, coles[0].id, { categoryId: 'alcohol' });
    const after = (await store.read('ledger')).filter((t) => t.merchant === 'Coles');
    assert.equal(after.find((t) => t.id === coles[0].id).categoryId, 'alcohol');
    assert.equal(after.find((t) => t.id === coles[1].id).categoryId, 'groceries');
  });
});

test('applyToPast updates matching merchants', async () => {
  await withImported(async (base, store) => {
    const coles = (await store.read('ledger')).filter((t) => t.merchant === 'Coles');
    const body = await (await patch(base, coles[0].id, {
      categoryId: 'alcohol', applyToPast: true
    })).json();
    assert.equal(body.updatedPast, 1);
    const after = (await store.read('ledger')).filter((t) => t.merchant === 'Coles');
    assert.ok(after.every((t) => t.categoryId === 'alcohol'));
  });
});

test('applyToPast never overwrites a manual categorisation', async () => {
  await withImported(async (base, store) => {
    const coles = (await store.read('ledger')).filter((t) => t.merchant === 'Coles');
    await patch(base, coles[1].id, { categoryId: 'takeaway' });          // manual
    await patch(base, coles[0].id, { categoryId: 'alcohol', applyToPast: true });
    const after = (await store.read('ledger')).find((t) => t.id === coles[1].id);
    assert.equal(after.categoryId, 'takeaway');
  });
});

test('rememberRule prepends an exact rule for the merchant', async () => {
  await withImported(async (base, store) => {
    const rong = (await store.read('ledger')).find((t) => t.merchant === 'Sunshine Deli');
    const body = await (await patch(base, rong.id, {
      categoryId: 'restaurants', rememberRule: true
    })).json();
    assert.equal(body.ruleAdded, true);
    const rules = await store.read('rules');
    assert.deepEqual(rules[0], { match: 'exact', value: 'sunshine deli', categoryId: 'restaurants' });
  });
});

test('excluding a transaction keeps its category', async () => {
  await withImported(async (base, store) => {
    const coles = (await store.read('ledger')).find((t) => t.merchant === 'Coles');
    const body = await (await patch(base, coles.id, { excluded: true })).json();
    assert.equal(body.transaction.excluded, true);
    assert.equal(body.transaction.categoryId, 'groceries');
  });
});

test('rejects an unknown category', async () => {
  await withImported(async (base, store) => {
    const t = (await store.read('ledger'))[0];
    const res = await patch(base, t.id, { categoryId: 'not-a-real-category' });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /category/i);
  });
});

test('returns 404 for an unknown transaction', async () => {
  await withImported(async (base) => {
    assert.equal((await patch(base, 'deadbeefdeadbeef', { excluded: true })).status, 404);
  });
});

test('a new category can be created', async () => {
  await withImported(async (base, store) => {
    const res = await fetch(`${base}/api/categories`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'pet-care', label: 'Pet care', groupId: 'lifestyle' })
    });
    assert.equal(res.status, 200);
    const { categories } = await store.read('categories');
    assert.ok(categories.some((c) => c.id === 'pet-care'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/transaction-routes.test.js`
Expected: FAIL — 404 responses; `body.transaction` undefined

- [ ] **Step 3: Write minimal implementation**

In `server/routes.js`, inside `createRouter`'s returned `route` function, insert these blocks **before** the final `return sendJson(res, 404, ...)`:

```js
    const txnMatch = pathname.match(/^\/api\/transactions\/([a-f0-9]{16})$/);
    if (req.method === 'PATCH' && txnMatch) {
      const id = txnMatch[1];
      const body = await readBody(req);
      const ledger = await store.read('ledger');
      const index = ledger.findIndex((t) => t.id === id);
      if (index === -1) return sendJson(res, 404, { error: 'Transaction not found' });

      const { categories } = await store.read('categories');
      const validIds = new Set(categories.map((c) => c.id));
      if (body.categoryId !== undefined && !validIds.has(body.categoryId)) {
        return sendJson(res, 400, { error: `Unknown category: ${body.categoryId}` });
      }

      const updated = { ...ledger[index] };
      if (body.categoryId !== undefined) {
        updated.categoryId = body.categoryId;
        updated.categorySource = 'manual';
      }
      if (body.excluded !== undefined) updated.excluded = Boolean(body.excluded);
      if (body.note !== undefined) updated.note = body.note === '' ? null : String(body.note);

      const next = [...ledger];
      next[index] = updated;

      let updatedPast = 0;
      if (body.applyToPast === true && body.categoryId !== undefined) {
        const merchant = updated.merchant;
        for (let i = 0; i < next.length; i++) {
          if (i === index) continue;
          const t = next[i];
          // Never overwrite a decision the user already made by hand.
          if (t.merchant !== merchant || t.categorySource === 'manual') continue;
          next[i] = { ...t, categoryId: body.categoryId, categorySource: 'manual' };
          updatedPast++;
        }
      }

      await store.write('ledger', next);

      let ruleAdded = false;
      if (body.rememberRule === true && body.categoryId !== undefined) {
        const value = String(updated.merchant).toLowerCase();
        const rules = await store.read('rules');
        const without = rules.filter((r) => !(r.match === 'exact' && r.value === value));
        await store.write('rules', [
          { match: 'exact', value, categoryId: body.categoryId },
          ...without
        ]);
        ruleAdded = true;
      }

      return sendJson(res, 200, { transaction: updated, updatedPast, ruleAdded });
    }

    if (req.method === 'POST' && pathname === '/api/categories') {
      const body = await readBody(req);
      const data = await store.read('categories');
      if (!body.id || !body.label || !body.groupId) {
        return sendJson(res, 400, { error: 'A category needs id, label and groupId' });
      }
      if (!data.groups.some((g) => g.id === body.groupId)) {
        return sendJson(res, 400, { error: `Unknown group: ${body.groupId}` });
      }
      if (data.categories.some((c) => c.id === body.id)) {
        return sendJson(res, 400, { error: `Category already exists: ${body.id}` });
      }
      data.categories.push({ id: body.id, label: body.label, groupId: body.groupId });
      await store.write('categories', data);
      return sendJson(res, 200, { categories: data.categories });
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/transaction-routes.test.js`
Expected: PASS — `# pass 9`

Then: `npm test` — all suites pass.

- [ ] **Step 5: Commit**

```bash
git add server/routes.js tests/transaction-routes.test.js CHANGELOG.md
git commit -m "feat: add transaction editing with opt-in bulk apply and rule learning"
```

---

## Task 12: Minimal web UI — import and real category totals

**Files:**
- Create: `web/style.css`, `web/api.js`, `web/import-view.js`, `web/overview-view.js`, `web/app.js`
- Modify: `web/index.html`
- Test: `tests/smoke.test.js`

**Interfaces:**
- Consumes: `GET /api/snapshot`, `POST /api/import/preview`, `POST /api/import/commit`
- Produces: a working browser UI with two tabs — Import and Overview

This is the payoff task: after it, real CSVs go in and real category totals come out.

- [ ] **Step 1: Write the failing test**

Create `tests/smoke.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/index.js';

const withServer = async (fn) => {
  const dir = await mkdtemp(join(tmpdir(), 'spendexplore-smoke-'));
  const app = await startServer({ port: 0, dataDir: dir });
  try { await fn(`http://127.0.0.1:${app.port}`); }
  finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
};

test('every UI asset is served', async () => {
  await withServer(async (base) => {
    for (const path of ['/', '/style.css', '/app.js', '/api.js', '/import-view.js', '/overview-view.js']) {
      const res = await fetch(`${base}${path}`);
      assert.equal(res.status, 200, `${path} returned ${res.status}`);
    }
  });
});

test('the page wires up the module entry point and both tabs', async () => {
  await withServer(async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /<script type="module" src="\/app\.js">/);
    assert.match(html, /data-tab="import"/);
    assert.match(html, /data-tab="overview"/);
  });
});

test('no UI asset references an external host', async () => {
  await withServer(async (base) => {
    for (const path of ['/', '/style.css', '/app.js', '/api.js', '/import-view.js', '/overview-view.js']) {
      const body = await (await fetch(`${base}${path}`)).text();
      assert.doesNotMatch(body, /https?:\/\/(?!127\.0\.0\.1|localhost)/,
        `${path} references an external host`);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/smoke.test.js`
Expected: FAIL — `/style.css returned 404`

- [ ] **Step 3: Write minimal implementation**

Replace `web/index.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SpendExplore</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header>
    <h1>SpendExplore</h1>
    <nav id="tabs">
      <button data-tab="overview" class="active">Overview</button>
      <button data-tab="import">Import</button>
    </nav>
  </header>
  <main>
    <section id="view-overview" class="view"></section>
    <section id="view-import" class="view hidden"></section>
  </main>
  <script type="module" src="/app.js"></script>
</body>
</html>
```

Create `web/style.css`:

```css
:root {
  --bg: #ffffff; --fg: #1a1c1e; --muted: #6b7280;
  --line: #e3e5e8; --accent: #2563eb; --warn: #b45309; --bar: #93b8f5;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #16181c; --fg: #e8eaed; --muted: #9aa0a6;
    --line: #2c2f34; --accent: #6ea8fe; --warn: #e0a458; --bar: #3b5f9e;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--fg);
  font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
}
header {
  display: flex; align-items: baseline; gap: 24px;
  padding: 16px 24px; border-bottom: 1px solid var(--line);
}
h1 { font-size: 17px; margin: 0; letter-spacing: -0.01em; }
nav button {
  background: none; border: 1px solid transparent; color: var(--muted);
  padding: 5px 12px; border-radius: 6px; cursor: pointer; font-size: 14px;
}
nav button.active { color: var(--fg); border-color: var(--line); background: var(--line); }
main { padding: 24px; max-width: 980px; }
.hidden { display: none; }
.card { border: 1px solid var(--line); border-radius: 8px; padding: 16px; margin-bottom: 16px; }
.dropzone {
  border: 2px dashed var(--line); border-radius: 10px; padding: 40px;
  text-align: center; color: var(--muted); cursor: pointer;
}
.dropzone.over { border-color: var(--accent); color: var(--fg); }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--line); }
th { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
.bar { height: 8px; background: var(--bar); border-radius: 4px; }
.kpis { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
.kpi { flex: 1 1 140px; border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; }
.kpi span { display: block; font-size: 11px; text-transform: uppercase; color: var(--muted); }
.kpi b { font-size: 22px; font-weight: 600; }
.warn { color: var(--warn); }
button.primary {
  background: var(--accent); color: #fff; border: none;
  padding: 9px 18px; border-radius: 6px; cursor: pointer; font-size: 14px;
}
button.primary[disabled] { opacity: .5; cursor: default; }
.group-row td { font-weight: 600; }
.cat-row td:first-child { padding-left: 28px; color: var(--muted); }
.empty { color: var(--muted); padding: 32px 0; text-align: center; }
```

Create `web/api.js`:

```js
const request = async (path, options) => {
  const res = await fetch(path, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed: ${res.status}`);
  return body;
};

const postJson = (path, payload) =>
  request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });

export const getSnapshot    = () => request('/api/snapshot');
export const previewImport  = (files) => postJson('/api/import/preview', { files });
export const commitImport   = (files) => postJson('/api/import/commit', { files });
```

Create `web/import-view.js`:

```js
import { previewImport, commitImport } from './api.js';

const money = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(n).toFixed(2);

export function renderImportView(root, { onImported }) {
  let pending = [];

  root.innerHTML = `
    <div class="dropzone" id="dropzone">
      Drop bank CSVs here, or click to choose files
      <input type="file" id="filepicker" accept=".csv,text/csv" multiple hidden>
    </div>
    <div id="previews"></div>
  `;

  const dropzone = root.querySelector('#dropzone');
  const picker = root.querySelector('#filepicker');
  const previews = root.querySelector('#previews');

  dropzone.addEventListener('click', () => picker.click());
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('over'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('over'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('over');
    handleFiles([...e.dataTransfer.files]);
  });
  picker.addEventListener('change', () => handleFiles([...picker.files]));

  async function handleFiles(fileList) {
    if (!fileList.length) return;
    previews.innerHTML = '<p class="empty">Reading files…</p>';
    pending = await Promise.all(
      fileList.map(async (f) => ({ filename: f.name, text: await f.text() }))
    );
    try {
      const { previews: cards } = await previewImport(pending);
      renderPreviews(cards);
    } catch (err) {
      previews.innerHTML = `<div class="card warn">Could not read these files: ${err.message}</div>`;
    }
  }

  function renderPreviews(cards) {
    previews.innerHTML = cards.map((card) => `
      <div class="card">
        <h3>${card.filename}</h3>
        <p>
          Detected <b>${card.format.dateFormat}</b> dates,
          spend as <b>${card.format.spendSign}</b> amounts
          ${card.format.dateFormatConfidence === 'low'
            ? '<span class="warn">— day/month order could not be confirmed from this file, please check the dates below</span>'
            : ''}
        </p>
        <p>
          <b>${card.summary.rowsRead}</b> rows ·
          <b>${card.summary.added}</b> new ·
          <b>${card.summary.duplicates}</b> already imported ·
          <b>${card.summary.autoCategorised}</b> auto-categorised ·
          <b class="${card.summary.needsReview ? 'warn' : ''}">${card.summary.needsReview}</b> need review
        </p>
        <p>
          ${card.summary.dateFrom ?? '—'} to ${card.summary.dateTo ?? '—'} ·
          spend <b>${money(card.summary.totalSpend)}</b> ·
          income <b>${money(card.summary.totalIncome)}</b>
        </p>
        ${card.malformed.length ? `
          <p class="warn">${card.malformed.length} row(s) could not be read and will be skipped:</p>
          <ul>${card.malformed.map((m) => `<li>Line ${m.line}: ${m.reason}</li>`).join('')}</ul>
        ` : ''}
        <table>
          <thead><tr><th>Date</th><th>Merchant</th><th>Category</th><th class="num">Amount</th></tr></thead>
          <tbody>
            ${card.sampleTransactions.map((t) => `
              <tr>
                <td>${t.date}</td><td>${t.merchant}</td>
                <td>${t.categorySource === 'unknown' ? '<span class="warn">needs review</span>' : t.categoryId}</td>
                <td class="num">${money(t.amount)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `).join('') + `
      <button class="primary" id="confirm">Confirm and import</button>
      <p class="empty">Nothing has been saved yet.</p>
    `;

    previews.querySelector('#confirm').addEventListener('click', async (e) => {
      e.target.disabled = true;
      e.target.textContent = 'Importing…';
      try {
        const { results } = await commitImport(pending);
        const added = results.reduce((a, r) => a + r.summary.added, 0);
        const review = results.reduce((a, r) => a + r.summary.needsReview, 0);
        previews.innerHTML =
          `<div class="card"><b>${added}</b> transactions imported, ` +
          `<b class="${review ? 'warn' : ''}">${review}</b> need review.</div>`;
        pending = [];
        await onImported();
      } catch (err) {
        previews.innerHTML = `<div class="card warn">Import failed: ${err.message}</div>`;
      }
    });
  }
}
```

Create `web/overview-view.js`:

```js
const money = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(n).toFixed(2);

/**
 * Temporary aggregation for Plan 1. Plan 2 replaces this with the real
 * query engine; nothing outside this file depends on it.
 */
export function renderOverviewView(root, snapshot) {
  const { transactions, categories } = snapshot;
  const spend = transactions.filter((t) => !t.excluded && t.amount < 0 && t.categoryId !== 'income');

  if (!spend.length) {
    root.innerHTML = '<p class="empty">No transactions yet — import a CSV to get started.</p>';
    return;
  }

  const catById = new Map(categories.categories.map((c) => [c.id, c]));
  const groupById = new Map(categories.groups.map((g) => [g.id, g]));

  const byCategory = new Map();
  for (const t of spend) {
    const entry = byCategory.get(t.categoryId) ?? { total: 0, count: 0 };
    entry.total += t.amount;
    entry.count += 1;
    byCategory.set(t.categoryId, entry);
  }

  const byGroup = new Map();
  for (const [categoryId, entry] of byCategory) {
    const groupId = catById.get(categoryId)?.groupId ?? 'other';
    const g = byGroup.get(groupId) ?? { total: 0, count: 0, categories: [] };
    g.total += entry.total;
    g.count += entry.count;
    g.categories.push({ categoryId, ...entry });
    byGroup.set(groupId, g);
  }

  const total = spend.reduce((a, t) => a + t.amount, 0);
  const needsReview = transactions.filter((t) => t.categorySource === 'unknown').length;
  const largest = Math.min(...spend.map((t) => t.amount));
  const groups = [...byGroup.entries()].sort((a, b) => a[1].total - b[1].total);
  const widest = Math.abs(groups[0]?.[1].total ?? 1);

  root.innerHTML = `
    <div class="kpis">
      <div class="kpi"><span>Total spend</span><b>${money(total)}</b></div>
      <div class="kpi"><span>Transactions</span><b>${spend.length}</b></div>
      <div class="kpi"><span>Largest single</span><b>${money(largest)}</b></div>
      <div class="kpi"><span>Needs review</span><b class="${needsReview ? 'warn' : ''}">${needsReview}</b></div>
    </div>
    <table>
      <thead>
        <tr><th>Category</th><th class="num">Spend</th><th class="num">Txns</th><th style="width:34%"></th></tr>
      </thead>
      <tbody>
        ${groups.map(([groupId, g]) => `
          <tr class="group-row">
            <td>${groupById.get(groupId)?.label ?? groupId}</td>
            <td class="num">${money(g.total)}</td>
            <td class="num">${g.count}</td>
            <td><div class="bar" style="width:${(Math.abs(g.total) / widest * 100).toFixed(1)}%"></div></td>
          </tr>
          ${g.categories.sort((a, b) => a.total - b.total).map((c) => `
            <tr class="cat-row">
              <td>${catById.get(c.categoryId)?.label ?? c.categoryId}</td>
              <td class="num">${money(c.total)}</td>
              <td class="num">${c.count}</td>
              <td></td>
            </tr>`).join('')}
        `).join('')}
      </tbody>
    </table>
  `;
}
```

Create `web/app.js`:

```js
import { getSnapshot } from './api.js';
import { renderImportView } from './import-view.js';
import { renderOverviewView } from './overview-view.js';

const views = {
  overview: document.querySelector('#view-overview'),
  import: document.querySelector('#view-import')
};

async function refresh() {
  const snapshot = await getSnapshot();
  renderOverviewView(views.overview, snapshot);
}

function showTab(name) {
  for (const [key, element] of Object.entries(views)) element.classList.toggle('hidden', key !== name);
  for (const button of document.querySelectorAll('#tabs button')) {
    button.classList.toggle('active', button.dataset.tab === name);
  }
}

document.querySelector('#tabs').addEventListener('click', (event) => {
  const tab = event.target.dataset?.tab;
  if (tab) showTab(tab);
});

renderImportView(views.import, {
  onImported: async () => { await refresh(); showTab('overview'); }
});

await refresh();
showTab('overview');
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/smoke.test.js`
Expected: PASS — `# pass 3`

Then the full suite: `npm test`
Expected: PASS — every test from Tasks 1–12.

- [ ] **Step 5: Verify end-to-end with the real CSV**

```bash
npm start
```

Open `http://127.0.0.1:5173`, drag in `~/Downloads/CSVData (2).csv`, and confirm:

- The preview reports **44 rows read**, **44 new**, date range **2026-07-24** to **2026-08-22**, spend **-$1404.01**, income **$0.00**.
- Confirming shows the Overview with a group/category table totalling **-$1404.01**.
- Dragging the same file in again reports **0 new, 44 already imported**.

Record the actual observed numbers. If total spend is not `-$1404.01`, stop and debug before continuing — that figure is the ground truth for this dataset.

- [ ] **Step 6: Commit**

```bash
git add web tests/smoke.test.js CHANGELOG.md
git commit -m "feat: add import UI with confirmation preview and category totals"
```

---

## Done when

- `npm test` passes with every suite green.
- `npm start` serves a working UI on `127.0.0.1:5173`.
- The real sample CSV imports to a verified total of **-$1404.01** across 44 transactions.
- Re-importing the same file adds nothing.
- `data/ledger.json` is readable JSON that a human can open and understand.
- `CHANGELOG.md` has an entry per task.

## Deliberately NOT in this plan (Plan 2)

Query engine and the `query(spec)` contract · configurable panels (slice/measure/chart) · Chart.js and the seven chart types · saved custom views · Trends, Merchants, Recurring, Compare tabs · keyboard review queue · copy-paste AI categorisation round trip · budgets · card→person mapping UI.

**Explicitly deferred, so it is not silently lost:** the spec requires a confirmed CSV column
mapping to be *remembered per account* (`accounts.json` → `csvMapping`). This plan accepts a
`mappingOverride` per request and every transaction gets an `accountId`, but there is no
account management UI and no persistence of the mapping — all imports use `accountId:
"default"`. Plan 2 adds the accounts UI and wires `csvMapping` persistence through
`POST /api/import/commit`. Until then, a non-default format must be re-confirmed each import.

# SpendExplore — Design Spec

**Date:** 2026-08-22
**Status:** Approved, ready for implementation planning

## Purpose

A local, private, browser-based tool that two people open once a month to import bank CSVs,
see where their money went, drill into it from any angle, and find costs worth cutting.

Success means: a monthly sit-down takes under fifteen minutes, ends with a clear answer to
"what changed and why", and surfaces at least one concrete thing worth cancelling or reducing.

## Non-goals

No bank/Open Banking connection. No login, accounts, or cloud sync. No forecasting, net-worth
or asset tracking. No multi-currency. No mobile app. No alerts or nagging. All data stays on
the user's machine; the app makes no outbound network requests of any kind.

## Constraints

- Runs locally: `npm start` serves a browser UI on `127.0.0.1` only.
- Data persists to human-readable JSON files on disk and accumulates across months and years.
- Node.js (v23 available). No frontend build step.
- The UI/exploration layer must be separable from the data layer so either can evolve
  independently. This is an explicit user requirement, not an incidental nicety.

---

## Architecture

Four layers with three defined seams. Each layer talks only to its neighbour.

```
┌─ 4 · UI / Exploration ────────────────────────────────────┐
│  tabs, panels, filter bar, charts, review queue,          │
│  view builder. Knows nothing about CSVs, files, or        │
│  transaction storage.                                     │
└───────────────────────────────────────────────────────────┘
        ▲  Seam 1:  query(spec) → result
┌─ 3 · Query engine (pure, no I/O, no DOM) ─────────────────┐
│  filter → group → aggregate → derive stats.               │
│  Runs in the browser over an in-memory snapshot.          │
└───────────────────────────────────────────────────────────┘
        ▲  Seam 2:  JSON over HTTP
┌─ 2 · Ingestion (pure functions) ──────────────────────────┐
│  csv-parse, format-sniff, merchant-normalise,             │
│  dedupe-hash, categorise                                  │
└───────────────────────────────────────────────────────────┘
        ▲  Seam 3:  store.read(name) / store.write(name, data)
┌─ 1 · Storage ─────────────────────────────────────────────┐
│  plain JSON files, atomic writes, pre-import backups      │
└───────────────────────────────────────────────────────────┘
```

### Seam 1 — the query contract

The most important boundary. A panel is pure configuration; it never sees a transaction record.

```js
query({
  filters: {
    dateFrom, dateTo,          // ISO dates
    accountIds: [],            // empty = all
    categoryIds: [],
    groupIds: [],
    people: [],                // resolved from cardSuffix
    merchants: [],
    minAmount, maxAmount,
    includeExcluded: false
  },
  sliceBy: 'category' | 'group' | 'merchant' | 'person' | 'account'
         | 'weekday' | 'week' | 'month' | 'amountBand',
  measure: 'sum' | 'count' | 'avg' | 'median' | 'pctOfTotal',
  timeGrain: 'month' | 'week' | null,   // set for time-series charts
  sort:  { by: 'value' | 'label', dir: 'desc' | 'asc' },
  limit: number | null
})
// →
{
  rows: [{ key, label, value, count, children? }],
  total: number,
  stats: { median, largest, top3Share, txnCount }
}
```

Consequences: a new chart type is a UI-only change; a new way to slice is a query-engine-only
change; neither side learns that the other changed.

**The query engine runs in the browser.** Expected volume is 3–5k transactions after several
years — trivially held in memory, and every filter change or chart flip is instant with no
round-trip. The engine remains a pure module with no DOM or network access; it merely happens
to execute client-side.

### Seam 2 — HTTP API

```
GET    /api/snapshot              → { transactions, categories, rules, accounts, views }
POST   /api/import/preview        → parse + sniff, return preview, write nothing
POST   /api/import/commit         → backup, append, apply rules, return summary
DELETE /api/import/:importId      → roll back an entire import
PATCH  /api/transactions/:id      → category, excluded, note
POST   /api/transactions/bulk     → apply a category to a set of ids
CRUD   /api/categories | /api/rules | /api/accounts | /api/views
```

### Seam 3 — storage

`store.read(name)` / `store.write(name, data)`. Swapping JSON files for SQLite means rewriting
this one module and nothing else.

### Frontend tooling

Plain ES modules, no build step, no bundler. The tool is opened perhaps twelve times a year,
potentially for years; a toolchain is the component most likely to be broken on return. Cost
accepted: no JSX, no npm UI components.

Charts: **Chart.js, vendored into the repo as a local file** — never a CDN, so the app works
offline and makes no outbound requests. Before writing any chart code, load the `dataviz`
skill so the seven chart types read as one coherent, accessible system in both light and dark.

### Security posture

Server binds `127.0.0.1` only. No auth, no telemetry, no outbound requests. Bank CSVs never
leave the machine. `data/` is gitignored by default; versioning finances is an explicit opt-in.

---

## Data model

### Transaction

```json
{
  "id": "a3f1c9e27b04d8e5",
  "date": "2026-08-18",
  "amount": -64.15,
  "rawDescription": "COLES 0592 COBURG VI AUS Card xx4321 Value Date: 14/08/2026",
  "merchant": "Coles",
  "accountId": "spending",
  "cardSuffix": "4321",
  "categoryId": "groceries",
  "categorySource": "rule",
  "excluded": false,
  "importId": "imp_2026-08-22_001",
  "note": null
}
```

- `amount`: negative = spend, positive = income/refund. Normalised at import regardless of the
  source file's convention.
- `rawDescription` is preserved verbatim and never mutated. Everything else is derived, so an
  improved normaliser can re-derive the whole ledger without re-importing.
- `categorySource`: `rule` | `manual` | `ai` | `unknown`. **A `manual` value is never
  overwritten by a rule.**
- `excluded`: user-set, omits the row from all spend analysis while keeping it in the ledger.

### Dedupe

`id = hash(accountId + date + amount + rawDescription + occurrenceIndex)`.

`occurrenceIndex` distinguishes genuinely identical same-day transactions — the sample contains
two Coles rows on 18 Aug and repeated identical `$10.00` Myki top-ups. Without it, real
transactions would silently vanish. Re-importing an overlapping statement adds zero rows.

### Merchant normalisation

Strips, in order: gateway prefixes (`SQ*`, `SMP*`, `LSP*`, `SP `), `Card xx….`,
`Value Date: …`, trailing store numbers, suburb and state tokens, `AUS`/`AU`. Then title-cases
and collapses whitespace.

All six Coles variants → `Coles`. `SQ *BERGY BANDROOM Brunswick AU` → `Bergy Bandroom`.

This function contributes more to categorisation accuracy than anything else in the system and
receives correspondingly thorough tests.

### Categories — two levels

Seeded, fully editable (rename, add, delete, move):

| Group | Categories |
|---|---|
| Food & Drink | Groceries, Restaurants, Takeaway, Coffee, Alcohol |
| Transport | Public transport, Fuel, Tolls & parking, Rideshare & taxi, Car servicing |
| Home | Rent/mortgage, Energy, Water, Internet, Furniture & renovation |
| Health | Pharmacy, Doctors & specialists, Fitness, Insurance |
| Lifestyle | Shopping, Entertainment, Subscriptions, Travel & holidays, Gifts |
| Money | Cash withdrawals, Fees & interest, Transfers |
| Other | Uncategorised, Income |

Exclusion is the `excluded` boolean on the transaction, not a category — a transaction keeps
its real category and is simply omitted from spend analysis. There is deliberately no
"Excluded" category, which would make the two mechanisms ambiguous.

### Rules

Ordered, most-specific-first; evaluated top-down, first match wins.

```json
{ "match": "exact",    "value": "coles",      "categoryId": "groceries" }
{ "match": "contains", "value": "dan murphy", "categoryId": "alcohol" }
{ "match": "regex",    "value": "^myki",      "categoryId": "public-transport" }
```

Matching is case-insensitive against the **normalised merchant**. Rules are never hand-edited
in normal use — they grow through corrections — but the file is plain JSON and the Settings tab
exposes a viewer/editor so nothing is invisible.

Ships with a seed ruleset covering common Australian merchants (major supermarkets, Myki,
tolls, fuel, pharmacies, energy retailers, telcos, streaming services) so month one is not a
blank slate.

### Accounts

```json
{ "id": "spending", "label": "Joint spending", "type": "transaction",
  "csvMapping": { "date": 0, "description": 1, "account": 2, "amount": 4,
                  "dateFormat": "DD/MM/YYYY", "spendSign": "negative" },
  "cardOwners": {} }
```

`csvMapping` is captured on first import via the confirmation preview and reused thereafter.
`cardOwners` maps card suffix → person name; **ships empty**, set by the user in Settings.
Transactions with no card suffix (direct debits, transfers, ATM) are attributed to `Joint`.

Note: the credit card is paid from an account that will not be imported, so no internal-transfer
double-counting logic is needed. If an imported account ever appears to pay another imported
account, the import preview warns rather than silently double-counting.

### Files

```
data/ledger.json        every transaction, ever
data/categories.json    groups → categories
data/rules.json         merchant → category
data/accounts.json      accounts, CSV mappings, card → person
data/views.json         saved dashboards
data/imports.json       audit log: file, timestamp, range, rows read/added/skipped
data/backups/           pre-import snapshots
```

---

## Income and refunds

Spend-focused, with refunds netted:

- A positive amount whose normalised merchant has **prior spend in the ledger** is treated as a
  refund and nets against that merchant's category, so a $40 Coles refund reduces the Groceries
  total rather than appearing as income.
- A positive amount whose merchant has no prior spend is categorised `Income`, regardless of
  whether a rule would otherwise match it.
- All `Income` transactions are shown as a single summary line and excluded from every spend
  analysis.
- No savings rate, no net cashflow view.

---

## UI

### Shell

Tabs: **Overview · Trends · Merchants · Recurring · Compare · Review · Import · Settings**.

Below the tabs, a global filter bar (month/range, accounts, people, categories) applying to
**every panel on the page simultaneously**. Below that, panels stacked vertically, each
independently configurable, with inline expand for drill-down.

### Panels

Every panel is a mini pivot with three controls:

- **Slice by** — Category, Group, Merchant, Person, Account, Day of week, Week, Month, Amount band
- **Measure** — Total $, Count, Average, Median, % of total
- **Chart** — Bar, Donut, Line, Stacked area, Treemap, Dot plot, Table

**The chart switcher offers only types valid for the current slice** (no line chart for a
non-time slice; no donut across 40 merchants). Unrestricted chart choice mostly produces
misleading charts, which defeats the purpose.

Drill-down: group → category → merchant → transactions, expanding inline.

Every category/group detail header shows the concentration line — the explicit answer to
"few big spends or many small ones":

> `6 transactions · median $31 · largest $64 · top 3 = 76% of bucket`

The dot plot is the visual form of the same question, making outliers like the $286.48 City Diagnostics
Diagnostics charge obvious against a cluster of $10 fares.

### Custom views

Users can add, remove and reorder panels on a page and save the result as a **named view**
("Our monthly review", "Eating out deep-dive"). A view is an array of panel configs persisted
to `views.json` — the builder edits JSON, not components. Panel state persists between
sessions, so the app reopens exactly as it was left.

### Review queue

Keyboard-driven, one card at a time, **grouped by merchant** so five unknown Coles rows are a
single decision. Shows merchant, amount, date, raw description.

`1`–`9` assign the most likely categories · `/` search all categories · `n` create a new
category inline · `x` exclude · `s` skip.

### Corrections

On correcting a category, the app asks two separate questions:

1. "Also apply to the 14 past Coles transactions?" — **default no**
2. "Remember Coles → Groceries for future imports?" — **default yes**

History is never silently rewritten; future imports still get smarter.

### AI categorisation — copy-paste round trip

No API key, no cost, no outbound requests. A **"Copy unknowns for Claude"** button places a
formatted prompt (the unresolved normalised merchants plus the available category list) on the
clipboard. The user pastes it into a Claude conversation, and pastes the returned JSON into an
input in the app, which validates it and applies the categories.

Results land as `categorySource: "ai"` and are visibly marked as machine-guessed. Invalid or
unparseable pasted JSON is rejected with a clear message and changes nothing.

### Additional tabs

- **Recurring** — detects anything appearing 3+ times at a regular interval with a stable
  amount (±10%). Shows cadence, annualised cost, and last-seen date so a cancelled-but-still-
  charging subscription is obvious. The sample alone would surface OVO Energy, Amaysim,
  Netflix, Arctel and Google Cloud.
- **Merchants** — leaderboard by total, count or average; drill into full history and trend.
- **Compare** — month-over-month deltas, categories ranked by largest increase/decrease.
- **Budgets** — optional simple monthly target per category with over/under. No alerts, no
  rollover. Absent unless set. Surfaced within Overview rather than as its own tab.

---

## Import flow

1. Drag one or more CSVs onto the Import tab.
2. Each file gets a **preview card**: detected column mapping, date format, sign convention,
   row count, date range, total spend, total income, new vs already-present counts, and any
   skipped malformed rows listed explicitly. The column mapping is editable via dropdowns.
3. **Nothing is written until Confirm.** The plain-English summary ("total spend $1,404,
   income $0") is the safeguard against a wrong sign convention — the single failure that would
   otherwise invert every chart unnoticed.
4. On confirm: backup taken → rows appended → rules applied → mapping saved to the account.
5. Summary screen: "127 added, 44 duplicates skipped, 112 auto-categorised, 15 need review",
   linking straight to the Review queue.

---

## Error handling

| Failure | Behaviour |
|---|---|
| Malformed CSV row | Skipped, not fatal; listed explicitly in the preview |
| Unrecognised format | Preview shows raw columns for manual mapping; no import on a guess |
| Wrong sign convention | Caught by the preview's plain-English spend/income summary |
| Interrupted write | Atomic write (temp file → rename); `ledger.json` never half-written |
| Bad import | Roll back wholesale by `importId`; pre-import backup as a second net |
| Corrupt JSON on load | Server refuses to start with a clear message pointing at the backup |
| Invalid pasted AI JSON | Rejected with a clear message; nothing changes |

---

## Testing

Unit tests (`node:test`) on the pure layers, where a bug quietly corrupts years of history
rather than being visible on screen:

- **format-sniff** — known layouts plus deliberately awkward ones (header/no header, quoted
  commas, both column orders, both sign conventions)
- **merchant-normalise** — every pattern present in the sample CSV
- **dedupe-hash** — including two identical same-day Myki top-ups and re-import idempotency
- **categorise** — rule precedence, case-insensitivity, `manual` never overwritten
- **query engine** — each slice dimension, each measure, filter combinations, concentration
  stats, empty result sets
- **recurring detection** — true positives, irregular intervals, amount drift at the ±10% edge
- **store** — atomic write, backup, rollback by `importId`

UI gets a smoke test that the app boots and renders a panel. Exhaustive UI testing is not
proportionate for a two-person local tool.

---

## Open items for implementation planning

- Card suffix → person mapping ships empty; the per-person view shows an empty-state prompt
  directing the user to Settings until it is filled in.
- Seed ruleset contents to be drafted during implementation from the sample CSV plus common
  Australian merchants.

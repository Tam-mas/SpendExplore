# SpendExplore

A local, private spending explorer for two people. Drop in your bank CSVs once a month, see where the money actually went, and drill into it from any angle.

Built for a specific question: **is this category a few large spends, or a lot of small ones?** — because the answer changes what you'd do about it.

---

## Privacy first

This is the part that matters most, so it goes first.

- **Everything stays on your machine.** The server binds to `127.0.0.1` only. Nothing on your network or the internet can reach it.
- **No outbound requests, ever.** No CDN, no external fonts, no telemetry, no analytics, no crash reporting. There is a test that fails the build if any UI asset references an external host.
- **No accounts, no login, no cloud sync.** There is nothing to sign into.
- **The app never sees your bank credentials.** It only ever reads a CSV you hand it.
- **Zero npm dependencies.** Nothing in `node_modules` can exfiltrate anything, because there is no `node_modules`. The entire app runs on Node's standard library.
- **`data/` is gitignored**, along with `*.csv` anywhere in the repo. Your ledger, import history and backups cannot be committed by accident.

If you want to version your finances, that has to be a deliberate choice you make — it will never happen by default.

---

## Quick start

Requires **Node.js 22 or newer**. No install step, no build step, no dependencies.

```bash
npm start
```

Then open <http://127.0.0.1:5173>.

Go to **Import**, drop in a CSV from your bank, check the preview, and hit **Confirm and import**.

To run the tests:

```bash
npm test
```

---

## The monthly ritual

1. **Export CSVs** from your bank for the period you care about. Multiple accounts is fine — drop them all in at once.
2. **Drag them onto the Import tab.** You get a preview card per file showing the detected format, the date range, the totals, how many rows are new versus already imported, and any rows that couldn't be read.
3. **Read the preview before confirming.** Nothing is written to disk until you do. This step exists specifically to catch a misdetected sign convention — if the app thinks spend is positive when it's negative, every chart inverts, and the plain-English summary (`total spend $1,404.01, income $0.00`) is where you'd notice.
4. **Confirm.** A backup is taken first, then rows are appended and categorisation rules applied. You get a summary: *"127 added, 44 duplicates skipped, 112 auto-categorised, 15 need review."*
5. **Explore.** Slice by whatever you're curious about.

Re-importing a statement you've already loaded adds nothing — see [Deduplication](#deduplication).

---

## Importing

### Supported formats

The importer **sniffs the layout** rather than assuming one, because bank exports vary:

- Column order and count are detected, not hardcoded.
- Date format is inferred (`DD/MM/YYYY`, `YYYY-MM-DD`, `MM/DD/YYYY`). When the file genuinely can't resolve day-vs-month order — no date in it has a day above 12 — it says so and marks the detection **low confidence** rather than guessing silently.
- Sign convention is inferred. Some exports make a purchase negative, some positive. Both work.
- A header row is detected and skipped if present.
- **Amount vs. running balance** is resolved structurally: the importer looks for the column whose values explain the deltas in the other. That's what stops a credit-card export loading the running balance as your transaction amounts.

If detection gets something wrong, the preview lets you correct the column mapping before importing.

### Deduplication

Every transaction gets a **stable id**, hashed from account + date + amount + the raw description + an occurrence index. The occurrence index is the row's position within its own group of identical rows *in the source file* — so two genuinely separate $10.00 top-ups on the same day both survive, while re-importing the same statement produces exactly the same ids and therefore adds nothing.

This means overlapping statements are safe. Import January–March and then February–April; you get one clean ledger.

### Malformed rows

A row that can't be parsed is **skipped, never fatal**. Each one is reported with its real line number in the file and a plain-English reason, so you can go look at it. A file that isn't a statement at all gets a readable error rather than a crash.

---

## Categorisation

### How it works

Categorisation is **rule-based first, and the rules grow as you correct them.** There is no AI call at import time — imports are instant, free, offline, and, importantly, *deterministic*. The same transaction always lands in the same category, so your month-to-month trends don't silently shift.

The pipeline:

1. **Normalise the merchant.** `COLES 0592 COBURG VI AUS Card xx1234 Value Date: 14/08/2026` becomes `Coles`. This strips payment-gateway prefixes (`SQ*`, `SMP*`, `LSP*`), card identifiers, settlement dates, store numbers, suburb and state tokens, terminal reference codes and company suffixes. This one function does more for accuracy than anything else in the app.
2. **Match against the rules**, top-down, first match wins. Rules are matched on **whole words**, so a rule for `coles` matches `Coles` but never `Nicoles Hairdressing`.
3. **Anything unmatched** lands in *Uncategorised* and is counted in **Needs review**.

On a first import of a typical Australian statement, expect roughly 75–80% auto-categorised. That climbs as you correct things.

### Two-level taxonomy

Seven groups, each with a handful of categories. Fully editable — rename, add, delete, move.

| Group | Categories |
|---|---|
| **Food & Drink** | Groceries, Restaurants, Takeaway, Coffee, Alcohol |
| **Transport** | Public transport, Fuel, Tolls & parking, Rideshare & taxi, Car servicing |
| **Home** | Rent/mortgage, Energy, Water, Internet & phone, Furniture & renovation |
| **Health** | Pharmacy, Doctors & specialists, Fitness, Insurance |
| **Lifestyle** | Shopping, Entertainment, Subscriptions, Travel & holidays, Gifts |
| **Money** | Cash withdrawals, Fees & interest, Transfers |
| **Other** | Uncategorised, Income |

The app ignores whatever category your bank supplied. Banks are bad at this — a real export had a Woolworths Metro grocery run filed as *Travel*, a rideshare as *Retail shopping*, and Netflix as *Business expenses*.

### Correcting a category

Two things happen when you correct a transaction, and they are deliberately separate:

- **History is never rewritten silently.** Correcting one row changes that row. Applying the change to past rows is opt-in, so your old monthly totals never shift under you.
- **Future imports get smarter.** Saving a rule means next month's transactions from that merchant arrive already categorised.

A transaction you edited by hand is marked `manual` and is **never** overwritten by a rule or a bulk apply. A row swept up by "apply to all past" is marked `bulk`, which a later bulk apply *can* correct — so a mis-clicked bulk action is fixable.

---

## Needs review — clearing the pile

Open the **Review** tab. Uncategorised transactions are **grouped by merchant**, so three coffees from the same shop are one decision, not three, and the biggest decision comes first.

| Key | Action |
|---|---|
| `1`–`9` | Assign one of the suggested categories to the whole group |
| `/` | Jump to the full category list |
| `n` | Create a new category and assign it |
| `x` | Exclude the whole group from spend analysis |
| `s` | Skip for now |
| `←` `→` | Move between merchants |

Assigning **saves a rule**, so next month that merchant arrives already categorised. It does **not** touch your past transactions — history is never rewritten silently.

### Stuck on a merchant? Ask Claude

Under **Stuck? Ask Claude**, the copy button puts a ready-made prompt on your clipboard containing **merchant names only** — no amounts, no dates, no account details. Paste it into a Claude conversation, then paste the JSON reply back into the box and hit Apply.

Every category id in the reply is checked against your real taxonomy first. A category that doesn't exist is reported and skipped, never written. Nonsense text gets a readable error and changes nothing.

### Or do it from the command line

The server is running on `127.0.0.1:5173`. All of these are plain HTTP.

### List what needs review

```bash
curl -s http://127.0.0.1:5173/api/snapshot \
  | python3 -c "import json,sys; [print(t['id'], t['date'], f\"{t['amount']:>10.2f}\", t['merchant']) for t in json.load(sys.stdin)['transactions'] if t['categorySource']=='unknown']"
```

### See the available category ids

```bash
curl -s http://127.0.0.1:5173/api/snapshot \
  | python3 -c "import json,sys; [print(f\"{c['id']:<20} {c['label']} ({c['groupId']})\") for c in json.load(sys.stdin)['categories']['categories']]"
```

### Tag one transaction

Replace `<ID>` with the id from the first command.

```bash
curl -s -X PATCH http://127.0.0.1:5173/api/transactions/<ID> \
  -H 'content-type: application/json' \
  -d '{"categoryId":"restaurants"}'
```

### Tag it *and* remember the merchant for future imports

```bash
curl -s -X PATCH http://127.0.0.1:5173/api/transactions/<ID> \
  -H 'content-type: application/json' \
  -d '{"categoryId":"restaurants","rememberRule":true}'
```

### Tag it, remember it, and apply to every past transaction from that merchant

```bash
curl -s -X PATCH http://127.0.0.1:5173/api/transactions/<ID> \
  -H 'content-type: application/json' \
  -d '{"categoryId":"restaurants","rememberRule":true,"applyToPast":true}'
```

The response tells you exactly what happened: `{"transaction":{…},"updatedPast":14,"ruleAdded":true}`.

### Other edits

```bash
# Exclude from spend analysis (keeps its category, omits it from totals)
curl -s -X PATCH http://127.0.0.1:5173/api/transactions/<ID> \
  -H 'content-type: application/json' -d '{"excluded":true}'

# Attach a note
curl -s -X PATCH http://127.0.0.1:5173/api/transactions/<ID> \
  -H 'content-type: application/json' -d '{"note":"split with Alex"}'

# Create a new category
curl -s -X POST http://127.0.0.1:5173/api/categories \
  -H 'content-type: application/json' \
  -d '{"id":"pet-care","label":"Pet care","groupId":"lifestyle"}'
```

### Undo a whole import

Every import is tagged with an `importId`, visible in `data/imports.json`. Rolling one back removes exactly its rows and its log entry, and takes a backup first.

```bash
curl -s -X DELETE http://127.0.0.1:5173/api/import/<IMPORT_ID>
```

### Getting Claude to help categorise

Until the copy-paste flow is built, this works by hand: run the "list what needs review" command above, paste the merchant names into a Claude conversation, and ask for a mapping to your category ids. Then apply each one with a PATCH. Rules you save this way persist, so it's a shrinking job — most months should be a handful of genuinely new merchants.

---

## Exploring

The Overview opens with a KPI row, a global filter bar, and three panels.

**The filter bar re-slices every panel at once** — period, account, person, group.

**Every panel is a small pivot.** Three controls:

| Control | Options |
|---|---|
| **Slice by** | Category · Group · Merchant · Person · Card · Account · Day of week · Week · Month · Amount band |
| **Measure** | Total $ · # Txns · Average · Median · % of total |
| **Chart** | Bar · Table · Donut · Treemap · Line · Stacked · Dots |

Your choices persist across reloads.

### The chart list changes with the slice — on purpose

The switcher only offers chart types that are honest for what you're looking at. No line chart across unordered categories (it implies a trend that doesn't exist). No donut across months (a whole isn't made of months). No donut or treemap on an average (those parts don't sum to a whole). Unrestricted chart choice feels freeing but mostly produces charts that mislead.

### Answering "few big or many small?"

Every panel shows a concentration line, and the Table view shows one per row:

> `16 transactions · median -$13.90 · largest -$64.15 · top 3 = 45% of bucket`

A bucket where the top 3 transactions are 95% of the total is a few big hits. One where they're 20% is death by a thousand cuts. Those need completely different responses.

The **Dots** chart is the same question drawn: one dot per transaction along an amount axis. A tight cluster with one dot far to the right tells you the story instantly.

### Finding a transaction

The search box above the filter bar matches merchant name or raw bank description, live as you type — "chem" finds Chemist Warehouse. Results open in the same drill-down panel described below.

### Drilling down and re-categorising

Click any bar, donut slice, treemap tile, or line point, and a side panel lists the transactions behind it — date, merchant, amount, and a category dropdown to fix a miscategorised one on the spot. A checkbox lets you hide a transaction from every chart for the rest of this session (it comes back on reload; use Review to exclude one permanently). A banner appears whenever anything is hidden, with a one-click "Show all" to bring it back.

### Over time, stacked

The **Stacked** chart option (alongside Line, for a Week/Month slice) draws one column per month, colour-banded by group, so you can see the *mix* change month to month — not just the total.

---

## Budgets

A separate tab for **envelope budgeting**: set a monthly amount per category, and unspent allocation carries forward automatically. A $500/month Travel budget untouched for ten months shows $5,000 **Available** — not ten months of "you're under budget" that resets and tells you nothing.

Each category shows three things side by side, which is the point: **this month's own allocation vs. spend** (the calendar-month view most budgeting apps stop at), a **status** telling you which of three things is true, and the **Available** balance (the envelope).

| Status | Meaning |
|---|---|
| On track | This month's spend is within this month's own allocation |
| ↻ Covered by rollover | Over this month's allocation, but the envelope is still positive — earlier months' unspent allocation is absorbing it |
| ⚠ Over | The envelope itself has gone negative |

That middle state is the whole reason this exists: a single big month reads as "over" in every calendar-month budget view, even when, across the year, nothing is wrong.

**Editing** is inline — click the amount, type a new one, save. A change takes effect from the **current month onward**; every past month keeps whatever was actually budgeted for it at the time, so editing today never rewrites history. There's no way to schedule a future change or delete a budget outright — set it to $0 to pause one. Budgets are household-wide (one envelope per category, not split per person), and an envelope starts clean the month you first set it — it has no opinion about what you spent before you turned it on.

Click a budgeted category's row to see that category's transactions for the current month, in the same drill-down panel search and the charts use (minus the session-hide checkbox, which has no meaning here).

---

## Settings

Two things, so far, both existing data with no screen to reach them until now.

**Appearance** — Light / Dark / Match system. The app already follows the OS via `prefers-color-scheme`; this is an explicit override for anyone who wants independence from it, stored locally and applied before the page paints so a reload never flashes the wrong theme.

**Accounts** — rename an account, and name the person behind each card that has actually charged something on it. Card numbers aren't typed in by hand: each one you can name is pulled from your own transaction history, so there's nothing to mistype into a mapping that then matches nothing. Naming a card is what makes the **Person** filter and slice usable — until you do, everything attributes to `Joint`. The raw **Card** slice needs no mapping at all and works immediately, which is why it's there as a separate option from Person, not a replacement for this screen.

---

## Architecture

Four layers, three hard seams. Each layer talks only to its neighbour, so any one can be rewritten without touching the others.

```
┌─ 4 · UI / Exploration ──────────────────────────────────┐
│  tabs, panels, filter bar, charts                       │
│  Knows nothing about CSVs, files, or how a transaction  │
│  is stored.                                             │
└─────────────────────────────────────────────────────────┘
      ▲  Seam 1:  query(snapshot, spec) → { rows, total, stats }
┌─ 3 · Query engine  (pure: no I/O, no DOM) ──────────────┐
│  filter → group → measure → derive stats                │
│  Runs in the browser over an in-memory snapshot.        │
└─────────────────────────────────────────────────────────┘
      ▲  Seam 2:  JSON over HTTP
┌─ 2 · Ingestion  (pure functions) ───────────────────────┐
│  csv-parse · format-sniff · merchant-normalise          │
│  dedupe-hash · categorise · ingest                      │
└─────────────────────────────────────────────────────────┘
      ▲  Seam 3:  store.read(name) / store.write(name, data)
┌─ 1 · Storage ───────────────────────────────────────────┐
│  plain JSON files · atomic writes · pre-import backups  │
└─────────────────────────────────────────────────────────┘
```

**Seam 1 is the important one.** A panel is pure configuration — `{ sliceBy, measure, chartType, filters }`. It hands that to `query()` and renders the rows it gets back. It never receives a transaction record, which is enforced by a test. So adding a chart type is a UI-only change, and adding a way to slice is a query-engine-only change.

### Why no build step

No bundler, no JSX, no transpiler — plain ES modules served directly. You open this tool maybe twelve times a year, potentially for years, and a toolchain is the component most likely to be broken when you come back to it. The cost is no npm UI components; for a dashboard this size that's a fair trade.

### Why hand-rolled SVG charts

No charting library. Seven renderers, each a pure function that takes a query result and returns SVG markup — which means they're fully unit-testable in Node with no browser. It also keeps the offline guarantee absolute and the dependency count at zero.

### Colour

The palette is **validated, not chosen by eye.** The seven taxonomy groups map onto seven categorical hues that were checked with a colourblindness and contrast validator:

- Side-by-side comparisons (bar, stacked, line, donut) — **pass**.
- All-against-all comparisons — **fail** (normal-vision separation below the readable floor).

That failure is why the **treemap uses a sequential ramp keyed to magnitude** rather than seven hues, and why the **dot plot is a single hue**. Their marks are compared all-against-all, so the categorical palette isn't safe there.

Three hues sit below the contrast floor in light mode, which obligates *relief*: every chart direct-labels its marks, and a **Table view is always available on every panel** and can never be removed.

Colour is keyed to a group's identity, never to its rank in a result — so filtering one group out never repaints the others.

---

## Data files

Everything lives in `data/`, as plain readable JSON you can open, grep, back up, or diff.

| File | Contents |
|---|---|
| `data/ledger.json` | Every transaction, ever |
| `data/categories.json` | Your groups and categories |
| `data/rules.json` | Merchant → category rules, growing as you correct things |
| `data/accounts.json` | Accounts, CSV column mappings, card → person mapping |
| `data/views.json` | Saved dashboards |
| `data/imports.json` | Audit log: file, timestamp, date range, rows added/skipped |
| `data/budgets.json` | Budget history per category — append-only, so a past month keeps whatever was actually budgeted for it |
| `data/backups/` | A full snapshot taken before every import |

`data/seed/` holds the starting taxonomy and ruleset. It's the only part of `data/` that's committed, and it contains no personal information.

### Safety

- **Atomic writes.** Every file is written to a temp file and then renamed, so a crash can never leave a half-written ledger.
- **Backup before every import** and before every bulk change.
- **Writes are serialised**, so two browser tabs can't silently lose each other's changes.
- **Roll back any import** by its id.

---

## API

All endpoints are on `127.0.0.1:5173`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/snapshot` | Everything: transactions, categories, rules, accounts, views, import log |
| `POST` | `/api/import/preview` | Parse and report. **Writes nothing.** |
| `POST` | `/api/import/commit` | Back up, append, apply rules, log |
| `DELETE` | `/api/import/:importId` | Roll back one import |
| `PATCH` | `/api/transactions/:id` | Set `categoryId`, `excluded`, `note`; optional `applyToPast`, `rememberRule` |
| `POST` | `/api/categories` | Create a category |
| `POST` | `/api/budgets` | Add a budget entry (`categoryId`, `amount`) — always appended, `effectiveFrom` stamped server-side as the current month |
| `POST` | `/api/recurring/override` | Mark a merchant `recurring`, `ignored`, or `auto` (clears the override) |
| `PATCH` | `/api/accounts/:id` | Set `label` and/or `cardOwners` (a full replace, not a merge) |

Preview and commit run the **same** ingest call with the same arguments — there is exactly one code path, so a preview can't disagree with what gets written.

---

## Project structure

```
lib/                      pure, no I/O, no DOM — fully unit-tested
  csv-parse.js            CSV text → rows of raw fields
  format-sniff.js         column layout, date format, sign convention
  merchant-normalise.js   raw description → clean merchant name
  dedupe-hash.js          stable transaction ids
  categorise.js           merchant → category rule matching
  ingest.js               orchestrates the above
  review.js               the review queue: grouping, suggestions, the Claude round trip
  budgets.js              envelope budget calculation: allocation, spend, balance, status
  query/                  the query engine (Seam 1)
    filter.js  group-by.js  measures.js  stats.js  query.js
    slice-transactions.js  search-transactions.js   drill-down / search data sources

server/                   the only code that touches the filesystem
  index.js                lifecycle, dispatch, binds 127.0.0.1
  http.js  static.js      helpers, static serving
  store.js                atomic JSON storage, backups (Seam 3)
  mutation-gate.js        serialises writes
  routes.js  routes/      HTTP endpoints (import, transactions, budgets,
                          recurring, settings)

web/                      plain ES modules, no build step
  index.html  style.css  app.js  api.js  theme.js
  import-view.js  overview-view.js  review-view.js  budgets-view.js
  recurring-view.js  settings-view.js
  panel.js  filter-bar.js  drilldown-panel.js
  charts/                 palette.js, scale.js, seven renderers, registry

data/                     your data (gitignored) + seed/ (committed)
docs/superpowers/         design spec and implementation plans
tests/                    760 tests
```

---

## Testing

```bash
npm test                                  # everything
node --test tests/ingest.test.js          # one file
```

510 tests, no test framework — Node's built-in `node:test`.

Coverage is deliberately weighted toward the layers where a bug **silently corrupts years of history** rather than being visible on screen: format sniffing, merchant normalisation, deduplication, categorisation, the query engine, and storage atomicity. The UI has a smoke test and a module-graph test rather than exhaustive coverage.

---

## Not built yet

Being honest about where this stops:

- **Trends and Merchants tabs.** (Recurring-charge detection and period comparison shipped since this list was first written — Recurring as its own tab, comparison as a filter-bar control rather than a separate tab.)
- **Saved named views** and adding/removing/reordering panels.
- **Per-person or group-level budgets**, scheduling a budget change for a future month, or deleting a budget entirely (set it to $0 to pause one).

---

## Design notes

The full design rationale and the implementation plans are in `docs/superpowers/`:

- `specs/` — the design spec, including the decisions and the trade-offs behind them
- `plans/` — task-by-task implementation plans

**Dark mode** follows the OS via `prefers-color-scheme` by default, with an explicit Light/Dark/System override in **Settings** for anyone who wants independence from the OS setting — the choice is stored in `localStorage`, stamped onto `<html data-theme>`, and applied before first paint so a reload never flashes the wrong theme. An earlier pass claimed this had been visually reviewed end to end; it hadn't been, in the way that mattered — every chart was silently rendering hard-coded light-mode colours regardless of OS theme (`colourResolver()`/the chart `options` object never received a resolved mode), so the whole dark categorical palette, including the `money` fix that pass claimed, was dead code no browser had ever painted. That is now fixed: chart colour resolution runs through `resolveMode()` (`web/charts/palette.js`), which reads `prefers-color-scheme` via `matchMedia` and re-renders the Overview's charts live on an OS theme change; it degrades to `'light'` under Node, where `matchMedia` doesn't exist.

With dark colours actually reaching the screen for the first time, a real review found one further defect this pass fixes: the bar chart's dashed "ghost" baseline (shown when a comparison is active) sits behind the solid bar at `.55` opacity, a value tuned against the light palette — against the dark surface, six of the app's seven group colours measured under the 3:1 contrast floor for a graphical mark (as low as ~2.1:1; only `money`, already corrected for its own reasons, cleared it). Fixed by raising the ghost's opacity to `.8` in dark mode only — verified by the same relative-luminance blend-over-surface math as the `money` fix (worst case ~3.1:1), not a colour or hue change, so the categorical hue separation the palette depends on is untouched. Confirmed live (`npm run start:test`) for bar, donut, treemap, dots, stacked and line charts, the ghost baseline, and the KPI/drill-down/budget/recurring surfaces named by the previous (invalid) review — no further dark-mode defects found once colours were actually rendering.

---

## Licence

Personal project. No licence granted.

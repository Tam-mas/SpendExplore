# Envelope Budgets — Design Spec

## Problem

SpendExplore has no budgeting concept. The user wants to set a monthly target per category (e.g. Travel: $500/month) and, critically, wants unspent allocation to **carry forward** — an envelope, not a calendar-month reset. Ten months of not touching a $500/month Travel budget should leave $5,000 available, not ten separate "you didn't spend your $500" non-events.

The specific failure mode this fixes: a calendar-month-only budget view would flag a $5,000 Travel booking in month 11 as "way over budget" even though, across the year, nothing is actually wrong. The user needs to see both numbers at once — this month's own allocation vs. spend, *and* the running envelope — so a month that looks alarming in isolation can be read correctly in context.

## Scope decisions (from brainstorming)

These were explicitly decided and are binding on the rest of this spec:

1. **Household-wide only.** One envelope per category, shared — no per-person budgets. Matches the app's existing joint-tracking framing; Person stays a filter lens elsewhere, not a budget partition.
2. **Envelope starts clean when a budget is first set.** No backfilling against pre-existing ledger history. A budget set today has no opinion about what you spent on Travel last year.
3. **Three-state status per month**, not two: *on track* (this month's spend ≤ this month's own allocation) / *covered by rollover* (over this month's own allocation, but the envelope's running balance is still ≥ 0) / *over* (the envelope itself is negative).
4. **New "Budgets" tab**, not folded into Overview.
5. **Unbudgeted categories are listed**, with a quiet "No budget set" and an inline way to add one.
6. **Editing a budget takes effect from the current month onward.** No future-dating, no retroactive rewriting of a month already in effect at the time.

## Data model

One new collection, `budgets.json`: an **append-only history**, not a single mutable number per category.

```json
[
  { "id": "b1", "categoryId": "travel", "amount": 500, "effectiveFrom": "2026-08" }
]
```

- `id` — same id convention as other collections (short random string, assigned server-side on creation).
- `categoryId` — must be a real category id, validated the same way `PATCH /api/transactions/:id` validates `categoryId` today.
- `amount` — a non-negative number, same 2-decimal money convention as transaction amounts elsewhere in the ledger (rounded via the same `round2` helper pattern `lib/review.js` already uses). `0` is valid (an explicit "budgeted, but nothing allocated" state) — this is how a budget is effectively paused. There is **no delete**; once a category has ever been budgeted, editing (including down to 0) is the only lever. (Flagged as a simplification, not confirmed against a real removal need — cheap to add later if wrong.)
- `effectiveFrom` — a `"YYYY-MM"` month key, same format `lib/query/group-by.js` already uses for month slicing. Always stamped as the **current month at write time**, server-side (never trust the client's clock, consistent with how the rest of the server validates rather than trusts input). There is no UI to schedule a future change.

Editing a budget means **appending a new entry** with the same `categoryId` and today's month as `effectiveFrom`. It never mutates or removes a prior entry. This is what makes "which allocation was in effect for month M" answerable for any M, including months before the most recent edit — the same append-only reasoning the ledger's `categorySource: 'bulk'` vs `'manual'` history already relies on elsewhere in this app.

`store.js`'s `COLLECTIONS` allow-list gets a new `budgets` entry (file `budgets.json`, default `[]`), following the exact pattern `views`/`imports`/etc. already use. `GET /api/snapshot` includes `budgets` alongside the other five collections.

## Calculation — `lib/budgets.js` (new, pure)

Consistent with the rest of the app: the server serves raw data, the browser computes everything. This file is pure (snapshot + budget history in, numbers out), no DOM, no I/O — same contract as `lib/query/*`.

**Allocation in effect for category `c`, month `M`:**
Among all `budgets` entries for `c` with `effectiveFrom <= M`, take the one with the latest `effectiveFrom`. If none exists, `c` has no allocation for `M` (either never budgeted, or budgeted only after `M`).

**Envelope balance for category `c` through month `M`:**
Let `F` = the earliest `effectiveFrom` across all of `c`'s budget entries (the month it was first budgeted). Then:

```
envelopeBalance(c, M) = Σ allocation(c, m) for every month m from F through M
                       − Σ spend(c, m)      for every month m from F through M
```

`spend(c, m)` excludes permanently-excluded rows, same as `applyFilters`'s default. **Sign convention: `spend(c, m)` returns a positive magnitude**, not the ledger's signed negative — allocations are positive, the UI shows "$612 spent" not "-$612 spent", and comparing a signed negative against a positive allocation would make every month look on-track by construction (a real bug caught while drafting the code below — worth stating explicitly since it's easy to reintroduce). Months before `F` are excluded entirely from both sums — per decision 2, the envelope has no opinion about them.

**Per-month status, for any month `M` that has an allocation (`monthSpend` and `monthAllocation` both positive magnitudes):**

```
monthSpend = spend(c, M)
monthAllocation = allocation(c, M)
balance = envelopeBalance(c, M)

if monthSpend <= monthAllocation:      status = 'on-track'
else if balance >= 0:                  status = 'covered'
else:                                  status = 'over'
```

A category with no allocation for `M` at all (never budgeted, or `M` is before `F`) has no status — it's simply unbudgeted for that purpose.

**Exports:**
- `budgetStatus(snapshot, categoryId, month)` → `{ allocation, spend, balance, status } | null` (null when the category has no allocation covering `month` — either never budgeted, or `month` is before its first entry) — the workhorse, covers one category/month.
- `allBudgetStatuses(snapshot, month)` → one entry per category that has ANY budget history at all, each `{ categoryId, allocation, spend, balance, status, hasAllocationForMonth }`. `hasAllocationForMonth` is `false` only when `month` predates the category's first budget entry (`allocation`/`status` are then meaningless for that row) — this can't happen for the Budgets tab's own default query (`month` = now, and every budgeted category's most recent entry always covers "now" — allocations don't expire), but the function is written generically over `month` rather than assuming that, since nothing stops a future caller from asking about a past month. This is what the Budgets tab renders from directly.

`month` defaults to the current real-world month (`YYYY-MM` from `new Date()`), matching how "current month" is used elsewhere for edit-stamping.

## API

- `GET /api/snapshot` — extended to include `budgets` (no behavioural change to the route itself beyond the added collection).
- `POST /api/budgets` — body `{ categoryId, amount }`. Validates `categoryId` against real categories (same check style as category validation in `transactions.js`) and `amount` (number, `>= 0`). Server stamps `effectiveFrom` as the current month, generates an id, appends to `budgets.json`, backs up first (this is an infrequent, deliberate action — same backup discipline as category creation, not the no-backup-on-every-edit treatment PATCH gets). Returns the full updated `budgets` array (same "return what changed" convention as the other mutation routes).

No new route file needed for this alone — small enough to live in `server/routes/transactions.js` alongside category creation, or a new `server/routes/budgets.js` if that file is getting crowded. (Left as an implementation-time call — check the file's current size before deciding.)

## UI — the Budgets tab

A fourth tab: Overview / Import / Review / **Budgets**. No global filter bar (Period/Account/Person/Group) — a budget is inherently a running, all-time-per-category thing, and those filters don't map onto "this month's allocation vs. an envelope that spans however many months it's existed."

Layout: grouped by category group (matching Overview's convention), one row per category:

| Column | Content |
|---|---|
| Category | label |
| This month | allocation vs. spend, e.g. "$500 budgeted · $612 spent" |
| Status | badge: on-track / covered by rollover / over (three-state, per the calculation above) |
| Available | the envelope balance — the user-facing name for what the calculation section calls "envelope balance"; this is the number the user actually wants ("how much can I spend") |
| — | inline "Edit" control (click the amount, type a new one, save) |

A category with no budget history at all renders "No budget set" in place of the This month/Status/Available columns, with an inline "Add budget" control in the same spot the amount would otherwise be — same interaction, different starting state.

Clicking a budgeted category's row reuses the existing drill-down side panel (the same component wired up for chart click-through and search) to show that category's transactions — scoped to the current month by default, since "what made up this month's spend" is the natural question after seeing the status badge.

**Editing**: click the amount (or "Add budget"), an inline number input replaces it, Enter/blur saves via `POST /api/budgets`, the row updates and the envelope recalculates from the fresh snapshot. No modal, no separate page — matches every other edit interaction already in this app (category re-assign, the review queue).

## Non-goals for this pass

Explicitly out of scope, to keep this focused:

- Per-person budgets (decision 1).
- Future-dated or scheduled budget changes (decision 6).
- Deleting a budget entirely / un-budgeting a category (data model section).
- Group-level budget rollups (a "Food & Drink" budget spanning several categories) — categories only.
- A multi-month trail/sparkline visualization per category beyond reusing the existing drill-down panel — could be a nice follow-up, not needed for the core ask.
- Filters (Period/Account/Person/Group) on the Budgets tab.
- Alerts/notifications when a status changes (e.g. push notification on going "over") — this app has no notification mechanism at all today.

## Testing

Following this project's established TDD discipline:

- `lib/budgets.js` — the highest-value tests in this feature. Cover: allocation lookup across multiple superseding entries; envelope balance accumulation across several months including a gap month with no spend; all three status transitions, including a `$0` budget entry where any spend at all immediately exceeds the month's own allocation while the envelope (carrying a positive balance from before) still reads `covered`; a category with no budget entries at all (`null`); a category whose ledger has spend *before* its first budget entry — the envelope must exclude that pre-existing spend entirely, not count it against the new budget (decision 2); `allBudgetStatuses` called for a month before a category's first entry, confirming `hasAllocationForMonth: false`.
- `server/routes/budgets.js` (or wherever `POST /api/budgets` lands) — validation (bad categoryId, negative amount, non-numeric amount), append-only behaviour (a second POST for the same category doesn't overwrite the first entry), backup-before-write.
- `web/budgets-view.js` (or similar) — pure render tests for the table (three status badges, unbudgeted row, escaping of category labels), mirroring `drilldown-panel.js`'s test style. DOM-wiring (the inline edit, the drill-down click-through) verified live in the browser per this project's established convention for `mountX` functions, not unit-tested.

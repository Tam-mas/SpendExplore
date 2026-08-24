# Five Improvements — Plan Index

Five independent subsystems, one plan each. Every plan produces working, tested software on its own and can be shipped without the others.

## The plans

| # | Plan | What it delivers | Tasks |
|---|---|---|---|
| 1 | [Comparison & Baselines](2026-08-24-comparison-baselines.md) | A global "compare to" control; KPI delta chips, ghost bars, a baseline line series, a Δ column | 7 |
| 2 | [Recurring Detection](2026-08-24-recurring-detection.md) | A Recurring tab: cadences, annualised costs, price changes, gone-quiet subscriptions, committed monthly | 6 |
| 3 | [Chart Interaction](2026-08-24-chart-interaction.md) | Hover tooltips, rolling windows + custom ranges, multi-select filters, legend muting | 6 |
| 4 | [Design Pass](2026-08-24-design-pass.md) | Token layer, monospace figures, responsive panel grid, phone support, dark-mode review, motion | 4 |
| 5 | [Monthly Digest](2026-08-24-monthly-digest.md) | A generated "what changed" summary after every import — local, deterministic, no LLM | 6 |

## Build order

```
1 Comparison ──┬──────────────► 5 Digest
2 Recurring ───┘                    ▲
                                    │
3 Interaction ──► 4 Design          │
                                    │
        (3 and 4 are independent of everything above)
```

- **1 and 2 first.** Plan 5 consumes `lib/query/periods.js` from plan 1 and `detectRecurring` from plan 2.
- **3 before 4.** Plan 3 introduces the tooltip, the multi-select popover and the custom-range inputs; plan 4 styles them. Doing 4 first means styling them twice.
- **5 last.** It is mostly assembly once 1 and 2 exist.

Plans 3 and 4 share no code with 1, 2 or 5 and can run in parallel with them.

## Shared conventions

These hold across all five and are repeated verbatim in each plan's **Global Constraints**:

- **Zero npm dependencies, no build step.** Node stdlib and plain ES modules only.
- **Magnitude space for every comparison.** The ledger stores spend as a negative amount; every `delta`, cost and total these plans report is a positive magnitude, so **positive always means "more was spent"**. Computing deltas on signed values inverts every arrow in the UI. This mirrors the decision already made in `lib/budgets.js`.
- **`lib/` never imports from `web/`.** `tests/module-graph.test.js` enforces it. Where a `lib/` module needs a formatter that currently lives in `web/charts/scale.js`, it gets its own copy — six lines is cheaper than inverting the layering.
- **No external hosts, ever.** `tests/smoke.test.js` fails the build if a UI asset references one. This rules out web fonts, which is why plan 4 gets its distinctiveness from scale and the monospace-figures treatment rather than from a typeface.
- **Injected clocks.** Pure functions take `today` as an argument and never read it from the clock, so every test is deterministic.
- **Suppression over fabrication.** Where there is no history to compare against, nothing is reported — never a delta measured against a window that predates the ledger.
- **Live verification uses `npm run start:test` only** (`DATA_DIR=./data-test`, port 5174). Never `data/`, never a file from outside this repo, and where test data is needed, write a synthetic fixture into `tests/fixtures/`. See `CLAUDE.md`.

## What is deliberately not in any of these plans

- **No LLM anywhere.** The digest is template composition over local data.
- **Brush-to-filter** on the time chart. Considered, not selected, not partially built.
- **A theme toggle.** The app follows the OS.
- **Account and person management.** The Account and Person filters stay inert because `accounts` is never written by any route — see the comment in `server/store.js`. Plan 3 makes them multi-select, which does not change that. A Settings screen is separate work.
- **Saved named views** and add/remove/reorder panels. Plan 4 adds a per-panel width, which is the piece the grid needs; `data/views.json` remains unread.

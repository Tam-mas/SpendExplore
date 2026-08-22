# Changelog

### [2026-08-22 15:45] Added

**Tech:** `lib/csv-parse.js` — character-level CSV parser (`parseCsv(text) → string[][]`)
**Dev:** Hand-rolled state machine instead of `split(',')` because real bank exports quote fields containing commas (e.g. `"COLES, COBURG"`) and escape embedded quotes as `""`. Handles LF and CRLF line endings, drops a trailing newline, and treats a whitespace-only row as empty rather than a one-field row — that last part needed a one-line fix to the reference implementation's row-flush guard, which otherwise let `'   '` slip through as `[['   ']]` instead of `[]`. No headers, types, or date/amount parsing here — that's later modules' job.
**Plain:** Added the code that turns a bank statement CSV's raw text into rows of text fields, without breaking on commas that are part of a shop name.
**Why:** Every later step (matching formats, cleaning up merchant names, importing transactions) depends on getting this first read of the file exactly right, so a shop name like "COLES, COBURG" doesn't get chopped into pieces.

### [2026-08-22 00:00] Added

**Tech:** `package.json` — ESM project scaffold with `node --test` runner
**Dev:** Zero npm dependencies; Node 23 built-ins cover test running, HTTP and hashing. `"type": "module"` set so all code is ESM.
**Plain:** Set up the empty project so code and tests can be added.
**Why:** Wanted the tool to still just work in two years without a build toolchain to repair first.

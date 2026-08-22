# Changelog

### [2026-08-22 17:05] Added

**Tech:** `lib/format-sniff.js` — `sniffFormat(rows)`, `parseDate(value, dateFormat)`, `parseAmount(value)`
**Dev:** Infers column layout, date format and sign convention from sampled rows (first 50) rather than requiring a config file per bank. Column roles are scored, not hard-coded: the date column is whichever one matches a date pattern in ≥80% of sampled values; among remaining numeric columns, the one with the higher share of negatives and the smaller mean magnitude wins as `amount` (a running balance is near-always positive and larger), so the 4-column `Date,Amount,Description,Balance` layout resolves correctly even though both non-date columns are numeric; of the remaining text columns, the longest-average one is `description` and the lowest-cardinality one is `account`. Day/month order is genuinely ambiguous when no sampled date has a day above 12 (`05/08/2026` could be 5 Aug or 8 May) — in that case the function still returns a best guess (Australian `DD/MM/YYYY`) but sets `dateFormatConfidence: 'low'` so the import preview can warn the user instead of silently picking a side. `sniffFormat` never applies its guess; it only proposes one. Implemented the brief's reference implementation verbatim — unlike the prior two tasks, all 10 of its own tests passed on the first run, so no bug-fix was needed here.
**Plain:** Added the code that looks at an imported bank CSV and guesses which column is the date, which is the amount, and whether spending shows up as negative or positive numbers — a guess the app will show you before importing anything.
**Why:** Every bank exports its CSV differently, and if the app guessed wrong about which number is money spent vs. money received, every chart would flip upside down without any obvious sign something was wrong — this makes that guess visible and checkable instead of silent.

### [2026-08-22 16:20] Fixed

**Tech:** `lib/csv-parse.js` — bare mid-field quotes now literal, leading UTF-8 BOM stripped
**Dev:** Code review across 17 inputs found two real-world breakages: (1) a stray `"` inside an unquoted field (e.g. `a"b,c`) flipped the parser into quoted mode, silently swallowing the following comma and dropping a column — now a `"` only opens quoted mode when it's the first character of a field (`field === ''`), matching Excel; any other `"` is appended literally. (2) Excel-exported bank CSVs commonly start with a UTF-8 BOM (`﻿`), which was landing inside the first header/field (e.g. `﻿Date`) and would have silently broken Task 3's header detection — now stripped once at the top of `parseCsv` before parsing starts. Also added tests pinning the row-flush guard in the KEEP direction (blank/whitespace-only lines dropped vs. empty-field and quoted-empty-field lines kept), since the existing tests only covered the DROP direction and several wrong guard formulations would have still passed them. Lone-CR (classic Mac) line endings remain an explicit, documented non-goal — noted in a source comment, not handled.
**Plain:** Fixed two edge cases in the CSV reader: a stray quotation mark inside a word no longer eats the next column, and an invisible marker some spreadsheet exports add to the start of a file no longer sneaks into the first cell.
**Why:** Real bank export files have both quirks, and either one would have quietly corrupted a transaction or broken next week's header-detection step in a way that's hard to trace back to this file.

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

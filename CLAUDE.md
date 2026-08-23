# SpendExplore — project rules

## Never touch real user data during testing

This app's `data/` directory holds the user's actual bank transactions — not
fixtures, not sample data. An earlier session found real CSV exports sitting
in the user's Downloads folder during live testing and imported them into
the real ledger, mistaking convenience for permission. Recovering from that
took an entire debugging session. Do not let it happen again.

**Binding rules, no exceptions:**

- **Automated tests** (`node --test`) must use a temp directory
  (`mkdtemp` + `startServer({ dataDir })`), exactly as every file in
  `tests/` already does. Never point a test at `data/`.
- **Live/manual verification** of a running server (browser-driven checks,
  a subagent clicking through the UI, anything outside `node --test`) must
  run against an **isolated** data directory, never the real one:
  ```bash
  npm run start:test    # DATA_DIR=./data-test, port 5174 — see package.json
  ```
  `data-test/` is gitignored and starts empty; the store seeds it with the
  default taxonomy automatically on first run. If it doesn't have enough
  data to exercise a feature, **write synthetic fixtures** (see
  `tests/fixtures/`) — never reach for whatever real-looking files happen
  to be sitting on the filesystem.
- **Never read, list, or import files from the user's Downloads folder, home
  directory, or any location outside this repo** as part of testing or
  verification, for any reason.
- If a task's own instructions ever seem to call for real data (they
  shouldn't), stop and ask the user first — don't infer permission from
  "the file was just sitting there."

## When dispatching subagents for this project

Any implementer or reviewer prompt that involves running the dev server —
for browser verification, manual API checks, anything live — must
explicitly say to use `npm run start:test` (or an equivalent isolated
`dataDir`), never plain `npm start`. Don't rely on the subagent inferring
this; state it.

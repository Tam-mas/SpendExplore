# Changelog

### [2026-08-22 00:00] Added

**Tech:** `package.json` — ESM project scaffold with `node --test` runner
**Dev:** Zero npm dependencies; Node 23 built-ins cover test running, HTTP and hashing. `"type": "module"` set so all code is ESM.
**Plain:** Set up the empty project so code and tests can be added.
**Why:** Wanted the tool to still just work in two years without a build toolchain to repair first.

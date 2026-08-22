import { randomUUID } from 'node:crypto';
import { ingest } from '../../lib/ingest.js';
import { sendJson, readBody } from '../http.js';

// The recognised date formats parseDate() understands. A mappingOverride
// naming anything else would make every row in the file "unreadable" —
// reject it up front with a 400 instead of letting that play out row by row.
const KNOWN_DATE_FORMATS = ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY'];

// A column index in a mappingOverride's `mapping` must be a non-negative
// integer (a real column position) or null (column not present in this
// file) — anything else (a string, a float, NaN) is not a value ingest()'s
// row-reading code is prepared for.
const isColumnIndex = (v) => v === null || (Number.isInteger(v) && v >= 0);

/**
 * mappingOverride is passed straight into ingest() as `format`, which is
 * then destructured (`const { mapping, dateFormat, spendSign, hasHeader } =
 * format`) with no validation of its own — by design, ingest() trusts its
 * caller. Destructuring a malformed value (a string, an array, an object
 * missing `mapping`) does not throw in JS; it silently yields `undefined`
 * fields and produces nonsense output rather than a clean error. So the
 * validation has to live here, at the boundary where the value first
 * arrives from outside the process.
 */
function isValidMappingOverride(m) {
  if (m === null || m === undefined) return true; // not supplied: ingest() sniffs instead
  if (typeof m !== 'object' || Array.isArray(m)) return false;
  if (typeof m.hasHeader !== 'boolean') return false;
  if (!KNOWN_DATE_FORMATS.includes(m.dateFormat)) return false;
  if (m.spendSign !== 'negative' && m.spendSign !== 'positive') return false;
  const mapping = m.mapping;
  if (mapping === null || typeof mapping !== 'object' || Array.isArray(mapping)) return false;
  if (!isColumnIndex(mapping.date) || !isColumnIndex(mapping.amount)) return false;
  for (const key of ['description', 'account', 'category']) {
    if (key in mapping && !isColumnIndex(mapping[key])) return false;
  }
  return true;
}

// A DELETE to a literal endpoint path (/api/import/preview, .../commit)
// must not be read as "roll back the import literally named preview" — it
// isn't a route DELETE ever supports, and the id-shaped capture group would
// otherwise match those segments too, silently returning `{removed: 0}`
// (200) for what should be an ordinary 404.
const ROLLBACK_RE = /^\/api\/import\/(?!preview$|commit$)([A-Za-z0-9_-]+)$/;

// stamp.slice(0, 10) on an ISO string is the UTC day, which reads as
// "yesterday" for most of an Australian working day (AEST is UTC+10). The
// day embedded in an importId is a human-visible label, not machine state
// (dedup/rollback key off the full random id, never off this substring), so
// it should reflect the date the user actually experienced the import on.
const localDay = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

// Every import id is `imp_<local day>_<random>_<sanitised filename>`. The
// random component (rather than a sequence number counted against existing
// log entries) is deliberate: the brief's reference implementation derived
// the sequence from `existing.filter(i => i.importId.includes(day)).length`,
// which is only unique while the imports log only ever grows. Roll one
// import back (the very feature this router provides) and that count goes
// *down*, so the next commit on the same day can regenerate an id that a
// still-present, different import already owns — two log entries and two
// sets of ledger rows sharing one importId, which breaks the "rollback by
// id removes exactly that import" guarantee this endpoint exists to
// provide. A random suffix makes collision astronomically unlikely
// regardless of prior deletions or concurrent requests, and needs no
// knowledge of the current imports log to compute.
const nextImportId = (filename, day) => {
  const unique = randomUUID().replace(/-/g, '').slice(0, 10);
  const safeName = String(filename).replace(/[^a-z0-9]/gi, '').slice(0, 12);
  return `imp_${day}_${unique}_${safeName}`;
};

/**
 * Write `data` to `collection`. If that write throws, best-effort restore
 * `compensateCollection` to `compensateValue` so the two collections that
 * describe one commit/rollback don't end up disagreeing about whether it
 * happened, then rethrow the ORIGINAL error (never the compensating write's
 * own error) so the caller sees the real cause. If the compensating write
 * itself fails, that's a second, distinct failure — logged on its own line
 * naming data/backups/ as the recovery path, so a restored partial failure
 * is never silently indistinguishable from one that stayed broken.
 */
async function writeWithCompensation(store, collection, data, compensateCollection, compensateValue) {
  try {
    await store.write(collection, data);
  } catch (err) {
    try {
      await store.write(compensateCollection, compensateValue);
    } catch (compensationErr) {
      console.error(
        `Compensating write to '${compensateCollection}' also failed after '${collection}' write failed — ` +
        `the two collections may now be inconsistent. Restore from data/backups/.`,
        compensationErr
      );
    }
    throw err;
  }
}

/**
 * Import routes: preview, commit, rollback. Preview and commit share one
 * runIngest() call per file, threading existingIds/existingMerchants
 * forward so later files in the SAME request see earlier files' rows — the
 * one code path shared by preview and commit means what the user confirms
 * in preview is exactly what commit writes.
 *
 * Returns a router function `(req, res, pathname) => boolean | Promise` that
 * returns `false` (synchronously) when the request isn't for this router,
 * so the caller can fall through to other routes without awaiting.
 */
export function createImportRoutes(store) {
  /**
   * Run ingest() once per file, in order. Purely in-memory — no store I/O —
   * so it never needs to be part of the concurrency gate below.
   */
  function runIngest(files, accountId, mappingOverride, ledger, rules, day) {
    const existingIds = new Set(ledger.map((t) => t.id));
    const existingMerchants = new Set(
      ledger.filter((t) => t.amount < 0).map((t) => String(t.merchant).toLowerCase())
    );
    const timestamp = new Date().toISOString();
    const results = [];

    for (const file of files) {
      const importId = nextImportId(file.filename, day);
      const result = ingest({
        text: file.text,
        accountId: accountId ?? 'default',
        importId,
        rules,
        existingIds,
        existingMerchants,
        mappingOverride: mappingOverride ?? null
      });
      for (const t of result.transactions) {
        existingIds.add(t.id);
        if (t.amount < 0) existingMerchants.add(String(t.merchant).toLowerCase());
      }
      results.push({ ...result, importId, filename: file.filename, timestamp });
    }
    return results;
  }

  // Both commit and rollback do a read-modify-write across the ledger and
  // imports collections, spanning several `await` points (backup, two
  // reads, two writes). store.js only serialises concurrent writes to the
  // SAME collection against each other — it has no notion of this whole
  // sequence as one unit. Two concurrent commits can both read the same
  // pre-mutation ledger, each compute "ledger + their own new rows", and
  // then write one after another: the second write wins outright and the
  // first commit's rows are gone from disk, even though its request already
  // returned 200 with real importIds for rows that no longer exist anywhere.
  // Serialising the two mutating handlers behind one promise chain — so
  // each one only starts once the previous has fully finished, backup
  // through final write — closes that window. It also makes the
  // compensating write above sound: without serialisation, a compensating
  // write could restore a stale ledger snapshot and erase a *different*
  // request's rows that committed successfully in between. Preview does no
  // writes at all and is deliberately left off this gate.
  let gate = Promise.resolve();
  const serialized = (fn) => {
    const result = gate.then(fn, fn);
    gate = result.then(() => {}, () => {});
    return result;
  };

  function validateImportBody(rawBody) {
    // readBody can hand back JSON.parse's result for any valid JSON body
    // (`null`, `42`, `"x"`, `[]`), not only an object — guard against a
    // shape that would throw on `body.files` below rather than fail the
    // Array.isArray check cleanly.
    const body = (rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody)) ? rawBody : {};

    const files = body.files ?? [];
    if (!Array.isArray(files) || files.length === 0) {
      return { error: 'No files supplied' };
    }
    for (const f of files) {
      if (typeof f?.filename !== 'string' || typeof f?.text !== 'string') {
        return { error: 'Each file needs a filename and text' };
      }
    }
    if (body.accountId !== undefined && typeof body.accountId !== 'string') {
      return { error: 'accountId must be a string' };
    }
    if (!isValidMappingOverride(body.mappingOverride)) {
      return { error: 'mappingOverride is not a recognised format' };
    }
    return { body, files };
  }

  async function handlePreview(req, res) {
    const validated = validateImportBody(await readBody(req));
    if (validated.error) return sendJson(res, 400, { error: validated.error });
    const { body, files } = validated;

    const [ledger, rules] = await Promise.all([store.read('ledger'), store.read('rules')]);
    const day = localDay(new Date());
    const results = runIngest(files, body.accountId, body.mappingOverride, ledger, rules, day);

    // Writes nothing: no store.write, no store.backup call anywhere on this
    // branch. What the user sees here is produced by the exact same
    // ingest() call commit will make, so it cannot disagree with what
    // actually gets written.
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

  async function handleCommit(req, res) {
    const validated = validateImportBody(await readBody(req));
    if (validated.error) return sendJson(res, 400, { error: validated.error });
    const { body, files } = validated;

    const [ledger, rules] = await Promise.all([store.read('ledger'), store.read('rules')]);
    const day = localDay(new Date());
    const results = runIngest(files, body.accountId, body.mappingOverride, ledger, rules, day);

    // Back up before mutating, so a bad import is always recoverable
    // regardless of what happens next.
    await store.backup();
    const added = results.flatMap((r) => r.transactions);
    await store.write('ledger', [...ledger, ...added]);

    const importsBefore = await store.read('imports');
    const newImports = [
      ...importsBefore,
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
    ];

    await writeWithCompensation(store, 'imports', newImports, 'ledger', ledger);

    return sendJson(res, 200, {
      results: results.map((r) => ({
        filename: r.filename, importId: r.importId,
        summary: r.summary, malformed: r.malformed
      })),
      importIds: results.map((r) => r.importId)
    });
  }

  async function handleRollback(res, importId) {
    const [ledger, importsBefore] = await Promise.all([store.read('ledger'), store.read('imports')]);
    const kept = ledger.filter((t) => t.importId !== importId);
    const removed = ledger.length - kept.length;
    const hasLogEntry = importsBefore.some((i) => i.importId === importId);

    // Roll back the ledger rows AND the log entry even when only one of the
    // two still exists. A zero-row import — re-committing an already-
    // imported statement, which adds nothing to the ledger but still logs
    // an entry — used to be impossible to clear: the old `if (removed > 0)`
    // gate skipped every write whenever there were no ledger rows to
    // remove, so DELETE on that id always reported `{removed: 0}` without
    // ever touching the log, and the entry sat there permanently.
    if (removed > 0 || hasLogEntry) {
      await store.backup();
      const newImports = importsBefore.filter((i) => i.importId !== importId);
      if (removed > 0) {
        await store.write('ledger', kept);
        await writeWithCompensation(store, 'imports', newImports, 'ledger', ledger);
      } else {
        // Nothing was written to the ledger, so there is nothing to
        // compensate if this write fails.
        await store.write('imports', newImports);
      }
    }

    return sendJson(res, 200, { removed });
  }

  return function handleImportRoute(req, res, pathname) {
    if (req.method === 'POST' && pathname === '/api/import/preview') {
      return handlePreview(req, res);
    }
    if (req.method === 'POST' && pathname === '/api/import/commit') {
      return serialized(() => handleCommit(req, res));
    }
    const rollback = pathname.match(ROLLBACK_RE);
    if (req.method === 'DELETE' && rollback) {
      return serialized(() => handleRollback(res, rollback[1]));
    }
    return false;
  };
}

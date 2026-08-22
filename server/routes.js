import { readFile } from 'node:fs/promises';
import { join, normalize, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { ingest } from '../lib/ingest.js';

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
  // normalize() then verify the resolved path is inside WEB_DIR.
  //
  // A plain `target.startsWith(WEB_DIR)` is the classic trap: it's a raw
  // string-prefix check, so a *sibling* directory whose name happens to
  // start with the same characters as WEB_DIR (e.g. "web-evil" starts with
  // "web") would pass it and let a request escape into that sibling. The
  // fix is to require either an exact match or that the next character
  // after the prefix is a path separator, i.e. target === WEB_DIR or
  // target.startsWith(WEB_DIR + sep) — never a bare prefix match.
  const target = normalize(join(WEB_DIR, relative));
  if (target !== WEB_DIR && !target.startsWith(WEB_DIR + sep)) {
    return sendJson(res, 400, { error: 'Bad path' });
  }
  // Known limitation: this checks the requested path lexically, not the
  // resolved filesystem target — symlinks under web/ are not followed via
  // realpath, so a symlink planted inside web/ pointing outside it would
  // not be caught here. Not exploitable today (nothing writes into web/
  // at runtime), but worth knowing if that ever changes.

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

export function createRouter(store) {
  // Every import id is `imp_<day>_<random>_<sanitised filename>`. The random
  // component (rather than a sequence number counted against existing log
  // entries) is deliberate: the brief's reference implementation derived the
  // sequence from `existing.filter(i => i.importId.includes(day)).length`,
  // which is only unique while the imports log only ever grows. Roll one
  // import back (the very feature this router provides) and that count goes
  // *down*, so the next commit on the same day can regenerate an id that a
  // still-present, different import already owns — two log entries and two
  // sets of ledger rows sharing one importId, which breaks the "rollback by
  // id removes exactly that import" guarantee this endpoint exists to
  // provide. A random suffix makes collision astronomically unlikely
  // regardless of prior deletions or concurrent requests, and needs no
  // knowledge of the current imports log to compute.
  const nextImportId = (filename, stamp) => {
    const day = stamp.slice(0, 10);
    const unique = randomUUID().replace(/-/g, '').slice(0, 10);
    const safeName = String(filename).replace(/[^a-z0-9]/gi, '').slice(0, 12);
    return `imp_${day}_${unique}_${safeName}`;
  };

  /**
   * Run ingest() once per file, in order, threading existingIds and
   * existingMerchants forward so later files in the SAME request see
   * earlier files' rows: a row imported from file A counts as a duplicate
   * if it recurs in file B, and a merchant with spend in file A establishes
   * prior spend for a refund in file B. This is the one code path shared by
   * preview and commit — same ingest() call, same arguments either way.
   */
  async function runIngest(files, accountId, mappingOverride, ledger, rules) {
    const existingIds = new Set(ledger.map((t) => t.id));
    const existingMerchants = new Set(
      ledger.filter((t) => t.amount < 0).map((t) => String(t.merchant).toLowerCase())
    );
    const stamp = new Date().toISOString();
    const results = [];

    for (const file of files) {
      const importId = nextImportId(file.filename, stamp);
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
      const rawBody = await readBody(req);
      // readBody can hand back JSON.parse's result for any valid JSON body
      // (`null`, `42`, `"x"`, `[]`), not only an object — guard against a
      // shape that would throw on `body.files` below rather than fail the
      // Array.isArray check cleanly.
      const body = (rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody)) ? rawBody : {};

      const files = body.files ?? [];
      if (!Array.isArray(files) || files.length === 0) {
        return sendJson(res, 400, { error: 'No files supplied' });
      }
      for (const f of files) {
        if (typeof f?.filename !== 'string' || typeof f?.text !== 'string') {
          return sendJson(res, 400, { error: 'Each file needs a filename and text' });
        }
      }
      if (body.accountId !== undefined && typeof body.accountId !== 'string') {
        return sendJson(res, 400, { error: 'accountId must be a string' });
      }
      if (!isValidMappingOverride(body.mappingOverride)) {
        return sendJson(res, 400, { error: 'mappingOverride is not a recognised format' });
      }

      const [ledger, rules] = await Promise.all([store.read('ledger'), store.read('rules')]);
      const results = await runIngest(files, body.accountId, body.mappingOverride, ledger, rules);

      if (pathname === '/api/import/preview') {
        // Writes nothing: no store.write, no store.backup call anywhere on
        // this branch. What the user sees here is produced by the exact
        // same ingest() call commit will make, so it cannot disagree with
        // what actually gets written.
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

      // Commit: back up before mutating, so a bad import is always
      // recoverable regardless of what happens next.
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

      try {
        await store.write('imports', newImports);
      } catch (err) {
        // The ledger write above already landed. If the log write then
        // fails, leaving it there would mean committed rows with no import
        // log entry — invisible to the import history, and their importId
        // known to nobody since the response never reaches the client.
        // Compensate by writing the ledger back to its pre-commit state so
        // the two collections stay consistent with each other; the request
        // still fails (the error below propagates and is masked to a
        // generic 500 by the top-level handler in server/index.js), but no
        // orphaned data is left behind on success being aborted. If this
        // compensating write also fails, the two collections are left out
        // of sync and data/backups/ (written above, before either mutation)
        // is the recovery path.
        await store.write('ledger', ledger);
        throw err;
      }

      return sendJson(res, 200, {
        results: results.map((r) => ({
          filename: r.filename, importId: r.importId,
          summary: r.summary, malformed: r.malformed
        })),
        importIds: results.map((r) => r.importId)
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
        const importsBefore = await store.read('imports');
        const newImports = importsBefore.filter((i) => i.importId !== importId);
        try {
          await store.write('imports', newImports);
        } catch (err) {
          // Same compensating-write reasoning as the commit path above:
          // don't leave the ledger missing rows that the import log still
          // claims exist.
          await store.write('ledger', ledger);
          throw err;
        }
      }
      return sendJson(res, 200, { removed });
    }

    return sendJson(res, 404, { error: 'Not found' });
  };
}

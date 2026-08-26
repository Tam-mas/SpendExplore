import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { startServer, createApp } from '../server/index.js';
import { createStore } from '../server/store.js';

const CSV = await readFile(new URL('./fixtures/sample-commbank.csv', import.meta.url), 'utf8');

const withServer = async (fn) => {
  const dir = await mkdtemp(join(tmpdir(), 'spendexplore-imp-'));
  const app = await startServer({ port: 0, dataDir: dir });
  try { await fn(`http://127.0.0.1:${app.port}`, app.store); }
  finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
};

const post = (base, path, body) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });

const files = [{ filename: 'aug.csv', text: CSV }];

test('preview reports what would happen and writes nothing', async () => {
  await withServer(async (base, store) => {
    const body = await (await post(base, '/api/import/preview', { files })).json();
    const p = body.previews[0];
    assert.equal(p.filename, 'aug.csv');
    assert.equal(p.summary.rowsRead, 6);
    assert.equal(p.summary.added, 6);
    assert.equal(p.summary.dateFrom, '2026-08-11');
    assert.equal(p.format.dateFormat, 'DD/MM/YYYY');
    assert.equal(p.format.spendSign, 'negative');
    assert.ok(Array.isArray(p.sampleTransactions));
    assert.deepEqual(await store.read('ledger'), []);
    assert.deepEqual(await store.read('imports'), []);
  });
});

test('commit appends transactions and logs the import', async () => {
  await withServer(async (base, store) => {
    const body = await (await post(base, '/api/import/commit', { files })).json();
    assert.equal(body.results[0].summary.added, 6);
    assert.equal((await store.read('ledger')).length, 6);
    const log = await store.read('imports');
    assert.equal(log.length, 1);
    assert.equal(log[0].filename, 'aug.csv');
    assert.equal(log[0].rowsRead, 6);
    assert.ok(log[0].importId.startsWith('imp_'));
    assert.ok(log[0].timestamp);
  });
});

test('committing the same file twice adds nothing the second time', async () => {
  await withServer(async (base, store) => {
    await post(base, '/api/import/commit', { files });
    const second = await (await post(base, '/api/import/commit', { files })).json();
    assert.equal(second.results[0].summary.added, 0);
    assert.equal(second.results[0].summary.duplicates, 6);
    assert.equal((await store.read('ledger')).length, 6);
  });
});

test('multiple files import in one request', async () => {
  await withServer(async (base, store) => {
    const two = [
      { filename: 'a.csv', text: CSV },
      { filename: 'b.csv', text: '01/08/2026,"ALDI STORES PRESTON VICAU","acct","cat","-44.43"' }
    ];
    const body = await (await post(base, '/api/import/commit', { files: two })).json();
    assert.equal(body.results.length, 2);
    assert.equal((await store.read('ledger')).length, 7);
  });
});

test('preview surfaces malformed rows without failing', async () => {
  await withServer(async (base) => {
    const bad = [{ filename: 'bad.csv', text: CSV + '\nnope,"X","a","b","zz"\n' }];
    const body = await (await post(base, '/api/import/preview', { files: bad })).json();
    assert.equal(body.previews[0].malformed.length, 1);
    assert.equal(body.previews[0].summary.added, 6);
  });
});

test('an import can be rolled back by id', async () => {
  await withServer(async (base, store) => {
    const body = await (await post(base, '/api/import/commit', { files })).json();
    const importId = body.results[0].importId;
    const res = await fetch(`${base}/api/import/${importId}`, { method: 'DELETE' });
    assert.equal((await res.json()).removed, 6);
    assert.deepEqual(await store.read('ledger'), []);
  });
});

test('rejects a request with no files', async () => {
  await withServer(async (base) => {
    const res = await post(base, '/api/import/preview', { files: [] });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /file/i);
  });
});

// --- Additional tests beyond the brief's baseline ---

test('preview writes nothing at all: ledger, imports log and backups dir all untouched', async () => {
  await withServer(async (base, store) => {
    await post(base, '/api/import/preview', { files });
    assert.deepEqual(await store.read('ledger'), []);
    assert.deepEqual(await store.read('imports'), []);
    // backup() creates data/backups/<timestamp>/ on demand; if preview never
    // calls it, the directory should not exist at all yet.
    await assert.rejects(readdir(join(store.dataDir, 'backups')), /ENOENT/);
  });
});

test('two files in one request: a row repeated in the second file counts as a duplicate, not a second transaction', async () => {
  await withServer(async (base, store) => {
    const two = [
      { filename: 'a.csv', text: CSV },
      { filename: 'b.csv', text: CSV } // identical rows to a.csv
    ];
    const body = await (await post(base, '/api/import/commit', { files: two })).json();
    assert.equal(body.results[0].summary.added, 6);
    assert.equal(body.results[0].summary.duplicates, 0);
    assert.equal(body.results[1].summary.added, 0);
    assert.equal(body.results[1].summary.duplicates, 6);
    assert.equal((await store.read('ledger')).length, 6);
  });
});

test('a merchant with spend in file A establishes prior spend for a same-request refund in file B', async () => {
  await withServer(async (base, store) => {
    // Each file's spend sign is sniffed independently from its own rows, so
    // a single-row file whose only amount happens to be positive gets read
    // as "positive = spend" rather than "negative = spend" — an artifact of
    // per-file sniffing, not of the cross-file threading this test targets.
    // Each file below carries an extra unrelated negative row so its sniffed
    // convention matches the other file's (negative = spend), isolating the
    // one thing under test: whether file B's refund nets against file A's
    // spend rather than being misread as income.
    const spendThenRefund = [
      {
        filename: 'a.csv',
        text: [
          '20/08/2026,"COLES 0592 COBURG VI AUS","acct","cat","-50.00"',
          '19/08/2026,"SOME OTHER SHOP","acct","cat","-20.00"'
        ].join('\n')
      },
      {
        filename: 'b.csv',
        // Same merchant text, later date, positive amount: without cross-file
        // threading this would be misread as income instead of a refund.
        text: [
          '21/08/2026,"COLES 0592 COBURG VI AUS","acct","cat","30.00"',
          '22/08/2026,"ANOTHER SHOP","acct","cat","-15.00"'
        ].join('\n')
      }
    ];
    const body = await (await post(base, '/api/import/commit', { files: spendThenRefund })).json();
    const ledger = await store.read('ledger');
    const refund = ledger.find((t) => t.amount > 0);
    assert.ok(refund, 'expected the positive-amount row to be in the ledger');
    assert.equal(refund.categoryId, 'groceries');
    assert.equal(refund.categorySource, 'rule');
  });
});

test('rolling back one import leaves a different import\'s rows untouched', async () => {
  await withServer(async (base, store) => {
    const first = await (await post(base, '/api/import/commit', { files })).json();
    const second = await (await post(base, '/api/import/commit', {
      files: [{ filename: 'b.csv', text: '01/08/2026,"ALDI STORES PRESTON VICAU","acct","cat","-44.43"' }]
    })).json();

    const firstImportId = first.results[0].importId;
    const secondImportId = second.results[0].importId;
    assert.notEqual(firstImportId, secondImportId);

    const res = await fetch(`${base}/api/import/${firstImportId}`, { method: 'DELETE' });
    assert.equal((await res.json()).removed, 6);

    const ledger = await store.read('ledger');
    assert.equal(ledger.length, 1);
    assert.ok(ledger.every((t) => t.importId === secondImportId));

    const log = await store.read('imports');
    assert.equal(log.length, 1);
    assert.equal(log[0].importId, secondImportId);
  });
});

test('commit that fails writing the imports log rolls the ledger write back, leaving both collections consistent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'spendexplore-imp-flaky-'));
  try {
    const realStore = createStore(dir);
    await realStore.init();

    let importsWriteAttempts = 0;
    // Simulate a disk failure on the imports-log write only, after the
    // ledger write has already landed successfully — the exact partial-
    // failure window the commit handler's compensating write exists for.
    const flakyStore = {
      ...realStore,
      write: async (name, data) => {
        if (name === 'imports') {
          importsWriteAttempts++;
          throw new Error('simulated disk failure writing imports.json');
        }
        return realStore.write(name, data);
      }
    };

    const server = createServer(createApp(flakyStore));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      const res = await post(base, '/api/import/commit', { files });
      assert.equal(res.status, 500);
      assert.equal(importsWriteAttempts, 1);

      // The compensating write undoes the ledger append via the *real*
      // store (flakyStore only intercepts the 'imports' collection), so
      // both collections should be back to their pre-commit state —
      // neither shows the import as having happened.
      assert.deepEqual(await realStore.read('ledger'), []);
      assert.deepEqual(await realStore.read('imports'), []);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('malformed request bodies each get a clean 400, never a 500', async () => {
  await withServer(async (base) => {
    const cases = [
      { label: 'missing files', body: {} },
      { label: 'files not an array', body: { files: 'nope' } },
      { label: 'file with no text', body: { files: [{ filename: 'a.csv' }] } },
      { label: 'file with non-string text', body: { files: [{ filename: 'a.csv', text: 12345 }] } },
      { label: 'bogus mappingOverride', body: { files, mappingOverride: 'nonsense' } },
      {
        label: 'mappingOverride missing required fields',
        body: { files, mappingOverride: { mapping: { date: 0, amount: 1 } } }
      }
    ];
    for (const { label, body } of cases) {
      const res = await post(base, '/api/import/preview', body);
      assert.equal(res.status, 400, `${label}: expected 400, got ${res.status}`);
      const json = await res.json();
      assert.equal(typeof json.error, 'string', `${label}: expected a JSON error message`);
    }
  });
});

// --- Review round: concurrency and zero-row-rollback fixes ---

test('two concurrent commits of different files both land: no import is silently lost', async () => {
  await withServer(async (base, store) => {
    const [resA, resB] = await Promise.all([
      post(base, '/api/import/commit', { files }),
      post(base, '/api/import/commit', {
        files: [{ filename: 'b.csv', text: '01/08/2026,"ALDI STORES PRESTON VICAU","acct","cat","-44.43"' }]
      })
    ]);
    assert.equal(resA.status, 200);
    assert.equal(resB.status, 200);
    const [bodyA, bodyB] = await Promise.all([resA.json(), resB.json()]);

    // Without serialising the mutating handlers, the second write-back to
    // the ledger clobbers the first: both requests return 200 with real
    // importIds, but only one commit's rows actually land on disk.
    const ledger = await store.read('ledger');
    assert.equal(ledger.length, 7, 'expected rows from BOTH concurrent commits, not just whichever wrote last');

    const log = await store.read('imports');
    assert.equal(log.length, 2, 'expected a log entry for each concurrent commit');

    const importIdA = bodyA.results[0].importId;
    const importIdB = bodyB.results[0].importId;
    assert.notEqual(importIdA, importIdB);
    assert.ok(log.some((i) => i.importId === importIdA), 'first commit missing from the imports log');
    assert.ok(log.some((i) => i.importId === importIdB), 'second commit missing from the imports log');
  });
});

test('rolling back a zero-row import (a re-committed duplicate) removes its log entry', async () => {
  await withServer(async (base, store) => {
    await post(base, '/api/import/commit', { files });
    const second = await (await post(base, '/api/import/commit', { files })).json();
    const zeroRowImportId = second.results[0].importId;
    assert.equal(second.results[0].summary.added, 0);

    let log = await store.read('imports');
    assert.equal(log.length, 2);
    assert.ok(log.some((i) => i.importId === zeroRowImportId));

    const res = await fetch(`${base}/api/import/${zeroRowImportId}`, { method: 'DELETE' });
    assert.equal((await res.json()).removed, 0);

    log = await store.read('imports');
    assert.equal(log.length, 1, 'the zero-row import\'s log entry should be gone, not stuck forever');
    assert.ok(!log.some((i) => i.importId === zeroRowImportId));

    // The first (real) import's rows must be untouched.
    assert.equal((await store.read('ledger')).length, 6);
  });
});

test('DELETE on the literal /api/import/preview or /api/import/commit path is a 404, not a no-op rollback', async () => {
  await withServer(async (base) => {
    for (const path of ['/api/import/preview', '/api/import/commit']) {
      const res = await fetch(`${base}${path}`, { method: 'DELETE' });
      assert.equal(res.status, 404, `${path}: expected 404, got ${res.status}`);
    }
  });
});

test('a syntactically invalid JSON body on commit is a clean 400, not a 500', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/import/commit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ this is not json'
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /json/i);
  });
});

// --- Account attribution ---

test('committing with an accountId stamps it on every resulting transaction', async () => {
  await withServer(async (base, store) => {
    await post(base, '/api/import/commit', { files, accountId: 'CC' });
    const ledger = await store.read('ledger');
    assert.equal(ledger.length, 6);
    assert.ok(ledger.every((t) => t.accountId === 'CC'));
  });
});

test('committing with a new accountId writes an account record so the filter can find it', async () => {
  await withServer(async (base, store) => {
    assert.deepEqual(await store.read('accounts'), []);
    await post(base, '/api/import/commit', { files, accountId: 'CC' });
    const accounts = await store.read('accounts');
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].id, 'CC');
    assert.ok(accounts[0].label);
  });
});

test('committing twice with the same accountId does not duplicate the account record', async () => {
  await withServer(async (base, store) => {
    await post(base, '/api/import/commit', { files, accountId: 'CC' });
    await post(base, '/api/import/commit', {
      files: [{ filename: 'b.csv', text: '01/08/2026,"ALDI STORES PRESTON VICAU","acct","cat","-44.43"' }],
      accountId: 'CC'
    });
    const accounts = await store.read('accounts');
    assert.equal(accounts.length, 1, 'expected exactly one CC account record, not one per commit');
  });
});

test('an import with no accountId still stamps and records "default", preserving old behaviour', async () => {
  await withServer(async (base, store) => {
    await post(base, '/api/import/commit', { files });
    const ledger = await store.read('ledger');
    assert.ok(ledger.every((t) => t.accountId === 'default'));
    const accounts = await store.read('accounts');
    assert.ok(accounts.some((a) => a.id === 'default'));
  });
});

test('two different accountIds used across commits each get their own account record', async () => {
  await withServer(async (base, store) => {
    await post(base, '/api/import/commit', { files, accountId: 'CC' });
    await post(base, '/api/import/commit', {
      files: [{ filename: 'b.csv', text: '01/08/2026,"ALDI STORES PRESTON VICAU","acct","cat","-44.43"' }],
      accountId: 'default'
    });
    const accounts = await store.read('accounts');
    assert.equal(accounts.length, 2);
    assert.ok(accounts.some((a) => a.id === 'CC'));
    assert.ok(accounts.some((a) => a.id === 'default'));
  });
});

test('accountId is trimmed before being stamped and recorded', async () => {
  await withServer(async (base, store) => {
    await post(base, '/api/import/commit', { files, accountId: '  CC  ' });
    const ledger = await store.read('ledger');
    assert.ok(ledger.every((t) => t.accountId === 'CC'));
    const accounts = await store.read('accounts');
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].id, 'CC');
  });
});

test('rejects an empty or whitespace-only accountId', async () => {
  await withServer(async (base) => {
    for (const bad of ['', '   ']) {
      const res = await post(base, '/api/import/preview', { files, accountId: bad });
      assert.equal(res.status, 400, `accountId ${JSON.stringify(bad)}: expected 400`);
      assert.match((await res.json()).error, /accountId/i);
    }
  });
});

test('rejects an accountId over the length cap', async () => {
  await withServer(async (base) => {
    const res = await post(base, '/api/import/preview', { files, accountId: 'x'.repeat(200) });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /accountId/i);
  });
});

test('the Account filter dropdown is populated end to end after a CC import', async () => {
  await withServer(async (base) => {
    await post(base, '/api/import/commit', { files, accountId: 'CC' });
    const snapshot = await (await fetch(`${base}/api/snapshot`)).json();
    assert.ok(snapshot.accounts.some((a) => a.id === 'CC'), 'expected CC in the accounts collection served in the snapshot');
  });
});

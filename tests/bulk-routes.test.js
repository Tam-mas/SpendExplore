import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/index.js';

const CSV = [
  '05/08/2026,"GOOD HEAVENS MELBOURNE AU","acct","cat","-16.77"',
  '12/08/2026,"GOOD HEAVENS MELBOURNE AU","acct","cat","-19.31"',
  '14/08/2026,"GOOD HEAVENS MELBOURNE AU","acct","cat","-37.61"',
  '06/08/2026,"ARCTEL PTY LTD BELLA VISTA AU","acct","cat","-59.99"'
].join('\n');

const withImported = async (fn) => {
  const dir = await mkdtemp(join(tmpdir(), 'se-bulk-'));
  const app = await startServer({ port: 0, dataDir: dir });
  const base = `http://127.0.0.1:${app.port}`;
  await fetch(`${base}/api/import/commit`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ files: [{ filename: 'a.csv', text: CSV }] })
  });
  try { await fn(base, app.store, dir); }
  finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
};

const bulk = (base, body) =>
  fetch(`${base}/api/transactions/bulk`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });

const idsFor = async (store, merchant) =>
  (await store.read('ledger')).filter((t) => t.merchant === merchant).map((t) => t.id);

test('assigns a category to every supplied id', async () => {
  await withImported(async (base, store) => {
    const ids = await idsFor(store, 'Good Heavens');
    const body = await (await bulk(base, { ids, categoryId: 'coffee' })).json();
    assert.equal(body.updated, 3);
    const after = (await store.read('ledger')).filter((t) => t.merchant === 'Good Heavens');
    assert.ok(after.every((t) => t.categoryId === 'coffee'));
    assert.ok(after.every((t) => t.categorySource === 'manual'));
  });
});

test('leaves other merchants alone', async () => {
  await withImported(async (base, store) => {
    await bulk(base, { ids: await idsFor(store, 'Good Heavens'), categoryId: 'coffee' });
    const arctel = (await store.read('ledger')).find((t) => t.merchant.startsWith('Arctel'));
    assert.equal(arctel.categoryId, 'uncategorised');
  });
});

test('rememberRule saves one exact rule at the head', async () => {
  await withImported(async (base, store) => {
    const body = await (await bulk(base, {
      ids: await idsFor(store, 'Good Heavens'), categoryId: 'coffee', rememberRule: true
    })).json();
    assert.equal(body.ruleAdded, true);
    const rules = await store.read('rules');
    assert.deepEqual(rules[0], { match: 'exact', value: 'good heavens', categoryId: 'coffee' });
  });
});

test('re-running replaces the rule rather than accumulating duplicates', async () => {
  await withImported(async (base, store) => {
    const ids = await idsFor(store, 'Good Heavens');
    await bulk(base, { ids, categoryId: 'coffee', rememberRule: true });
    await bulk(base, { ids, categoryId: 'takeaway', rememberRule: true });
    const rules = await store.read('rules');
    assert.equal(rules.filter((r) => r.value === 'good heavens').length, 1);
    assert.equal(rules[0].categoryId, 'takeaway');
  });
});

test('a saved rule categorises a later import automatically', async () => {
  await withImported(async (base, store) => {
    await bulk(base, {
      ids: await idsFor(store, 'Good Heavens'), categoryId: 'coffee', rememberRule: true
    });
    const res = await fetch(`${base}/api/import/preview`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ files: [{ filename: 'b.csv', text: '01/09/2026,"GOOD HEAVENS MELBOURNE AU","acct","cat","-8.00"' }] })
    });
    const preview = (await res.json()).previews[0];
    assert.equal(preview.sampleTransactions[0].categoryId, 'coffee');
    assert.equal(preview.summary.needsReview, 0);
  });
});

test('takes a backup before writing', async () => {
  await withImported(async (base, store, dir) => {
    const { readdir } = await import('node:fs/promises');
    const before = (await readdir(join(dir, 'backups'))).length;
    await bulk(base, { ids: await idsFor(store, 'Good Heavens'), categoryId: 'coffee' });
    assert.ok((await readdir(join(dir, 'backups'))).length > before);
  });
});

test('rejects an unknown category with 400', async () => {
  await withImported(async (base, store) => {
    const res = await bulk(base, { ids: await idsFor(store, 'Good Heavens'), categoryId: 'nope' });
    assert.equal(res.status, 400);
  });
});

test('rejects a malformed body with 400, never 500', async () => {
  await withImported(async (base) => {
    for (const body of [{}, { ids: 'x', categoryId: 'coffee' }, { ids: [], categoryId: 'coffee' }, { ids: [1], categoryId: 'coffee' }]) {
      assert.equal((await bulk(base, body)).status, 400, JSON.stringify(body));
    }
    const res = await fetch(`${base}/api/transactions/bulk`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{ broken'
    });
    assert.equal(res.status, 400);
  });
});

test('an unknown id is reported, not silently ignored', async () => {
  await withImported(async (base, store) => {
    const ids = await idsFor(store, 'Good Heavens');
    const body = await (await bulk(base, { ids: [...ids, 'deadbeefdeadbeef'], categoryId: 'coffee' })).json();
    assert.equal(body.updated, 3);
    assert.equal(body.notFound, 1);
  });
});

test('two concurrent bulk calls both land', async () => {
  await withImported(async (base, store) => {
    const gh = await idsFor(store, 'Good Heavens');
    const arctel = (await store.read('ledger')).filter((t) => t.merchant.startsWith('Arctel')).map((t) => t.id);
    const [a, b] = await Promise.all([
      bulk(base, { ids: gh, categoryId: 'coffee' }),
      bulk(base, { ids: arctel, categoryId: 'internet-phone' })
    ]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const ledger = await store.read('ledger');
    assert.ok(ledger.filter((t) => t.merchant === 'Good Heavens').every((t) => t.categoryId === 'coffee'));
    assert.ok(ledger.filter((t) => t.merchant.startsWith('Arctel')).every((t) => t.categoryId === 'internet-phone'));
  });
});

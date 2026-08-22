import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/index.js';

const CSV = await readFile(new URL('./fixtures/sample-commbank.csv', import.meta.url), 'utf8');

const withImported = async (fn) => {
  const dir = await mkdtemp(join(tmpdir(), 'spendexplore-txn-'));
  const app = await startServer({ port: 0, dataDir: dir });
  const base = `http://127.0.0.1:${app.port}`;
  await fetch(`${base}/api/import/commit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ files: [{ filename: 'aug.csv', text: CSV }] })
  });
  try { await fn(base, app.store); }
  finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
};

const patch = (base, id, body) =>
  fetch(`${base}/api/transactions/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });

test('setting a category marks the source manual', async () => {
  await withImported(async (base, store) => {
    const rong = (await store.read('ledger')).find((t) => t.merchant === 'Sunshine Deli');
    const body = await (await patch(base, rong.id, { categoryId: 'restaurants' })).json();
    assert.equal(body.transaction.categoryId, 'restaurants');
    assert.equal(body.transaction.categorySource, 'manual');
    assert.equal(body.updatedPast, 0);
    assert.equal(body.ruleAdded, false);
  });
});

test('past transactions are untouched unless applyToPast is true', async () => {
  await withImported(async (base, store) => {
    const coles = (await store.read('ledger')).filter((t) => t.merchant === 'Coles');
    await patch(base, coles[0].id, { categoryId: 'alcohol' });
    const after = (await store.read('ledger')).filter((t) => t.merchant === 'Coles');
    assert.equal(after.find((t) => t.id === coles[0].id).categoryId, 'alcohol');
    assert.equal(after.find((t) => t.id === coles[1].id).categoryId, 'groceries');
  });
});

test('applyToPast updates matching merchants', async () => {
  await withImported(async (base, store) => {
    const coles = (await store.read('ledger')).filter((t) => t.merchant === 'Coles');
    const body = await (await patch(base, coles[0].id, {
      categoryId: 'alcohol', applyToPast: true
    })).json();
    assert.equal(body.updatedPast, 1);
    const after = (await store.read('ledger')).filter((t) => t.merchant === 'Coles');
    assert.ok(after.every((t) => t.categoryId === 'alcohol'));
  });
});

test('applyToPast never overwrites a manual categorisation', async () => {
  await withImported(async (base, store) => {
    const coles = (await store.read('ledger')).filter((t) => t.merchant === 'Coles');
    await patch(base, coles[1].id, { categoryId: 'takeaway' });          // manual
    await patch(base, coles[0].id, { categoryId: 'alcohol', applyToPast: true });
    const after = (await store.read('ledger')).find((t) => t.id === coles[1].id);
    assert.equal(after.categoryId, 'takeaway');
  });
});

test('rememberRule prepends an exact rule for the merchant', async () => {
  await withImported(async (base, store) => {
    const rong = (await store.read('ledger')).find((t) => t.merchant === 'Sunshine Deli');
    const body = await (await patch(base, rong.id, {
      categoryId: 'restaurants', rememberRule: true
    })).json();
    assert.equal(body.ruleAdded, true);
    const rules = await store.read('rules');
    assert.deepEqual(rules[0], { match: 'exact', value: 'sunshine deli', categoryId: 'restaurants' });
  });
});

test('excluding a transaction keeps its category', async () => {
  await withImported(async (base, store) => {
    const coles = (await store.read('ledger')).find((t) => t.merchant === 'Coles');
    const body = await (await patch(base, coles.id, { excluded: true })).json();
    assert.equal(body.transaction.excluded, true);
    assert.equal(body.transaction.categoryId, 'groceries');
  });
});

test('rejects an unknown category', async () => {
  await withImported(async (base, store) => {
    const t = (await store.read('ledger'))[0];
    const res = await patch(base, t.id, { categoryId: 'not-a-real-category' });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /category/i);
  });
});

test('returns 404 for an unknown transaction', async () => {
  await withImported(async (base) => {
    assert.equal((await patch(base, 'deadbeefdeadbeef', { excluded: true })).status, 404);
  });
});

test('a new category can be created', async () => {
  await withImported(async (base, store) => {
    const res = await fetch(`${base}/api/categories`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'pet-care', label: 'Pet care', groupId: 'lifestyle' })
    });
    assert.equal(res.status, 200);
    const { categories } = await store.read('categories');
    assert.ok(categories.some((c) => c.id === 'pet-care'));
  });
});

// --- Additional tests beyond the brief's baseline ---

test('applyToPast does not touch a different merchant\'s transactions', async () => {
  await withImported(async (base, store) => {
    const ledgerBefore = await store.read('ledger');
    const coles = ledgerBefore.filter((t) => t.merchant === 'Coles');
    const myki = ledgerBefore.find((t) => t.merchant !== 'Coles' && t.merchant !== coles[0]?.merchant);
    assert.ok(myki, 'expected a transaction from a merchant other than Coles');
    const mykiCategoryBefore = myki.categoryId;

    await patch(base, coles[0].id, { categoryId: 'alcohol', applyToPast: true });

    const after = (await store.read('ledger')).find((t) => t.id === myki.id);
    assert.equal(after.categoryId, mykiCategoryBefore, 'a different merchant must be untouched by applyToPast');
    assert.notEqual(after.categorySource, 'manual');
  });
});

test('rememberRule on a merchant that already has an exact rule replaces it, not duplicates it', async () => {
  await withImported(async (base, store) => {
    const rong = (await store.read('ledger')).find((t) => t.merchant === 'Sunshine Deli');

    await patch(base, rong.id, { categoryId: 'restaurants', rememberRule: true });
    const afterFirst = await store.read('rules');
    const exactRulesAfterFirst = afterFirst.filter((r) => r.match === 'exact' && r.value === 'sunshine deli');
    assert.equal(exactRulesAfterFirst.length, 1);

    // Re-correct the same merchant to a different category, remembering again.
    await patch(base, rong.id, { categoryId: 'takeaway', rememberRule: true });
    const afterSecond = await store.read('rules');
    const exactRulesAfterSecond = afterSecond.filter((r) => r.match === 'exact' && r.value === 'sunshine deli');
    assert.equal(exactRulesAfterSecond.length, 1, 'expected the stale rule to be replaced, not accumulated');
    assert.equal(exactRulesAfterSecond[0].categoryId, 'takeaway');
    assert.equal(afterSecond.length, afterFirst.length, 'rule count should not grow on a re-correction');
  });
});

test('a remembered rule takes effect on a later import of that merchant', async () => {
  await withImported(async (base, store) => {
    const rong = (await store.read('ledger')).find((t) => t.merchant === 'Sunshine Deli');
    const body = await (await patch(base, rong.id, {
      categoryId: 'restaurants', rememberRule: true
    })).json();
    assert.equal(body.ruleAdded, true);

    // A fresh row for the same merchant, different date/amount so it is
    // not treated as a duplicate of the row already in the ledger.
    const newRongLiRow = '20/08/2026,"SUNSHINE DELI BALWYN NORTH VIC              AU","acct","cat","-15.90"';
    const res = await fetch(`${base}/api/import/commit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ files: [{ filename: 'sept.csv', text: newRongLiRow }] })
    });
    assert.equal(res.status, 200);

    const ledger = await store.read('ledger');
    const newRow = ledger.find((t) => t.merchant === 'Sunshine Deli' && t.amount === -15.9);
    assert.ok(newRow, 'expected the newly imported Sunshine Deli row to be present');
    assert.equal(newRow.categoryId, 'restaurants');
    assert.equal(newRow.categorySource, 'rule');
  });
});

test('two concurrent PATCHes to different transactions both survive', async () => {
  await withImported(async (base, store) => {
    const ledger = await store.read('ledger');
    const a = ledger.find((t) => t.merchant === 'Sunshine Deli');
    const b = ledger.find((t) => t.merchant !== 'Sunshine Deli');
    assert.ok(a && b && a.id !== b.id);

    const [resA, resB] = await Promise.all([
      patch(base, a.id, { categoryId: 'restaurants' }),
      patch(base, b.id, { note: 'checked' })
    ]);
    assert.equal(resA.status, 200);
    assert.equal(resB.status, 200);

    const after = await store.read('ledger');
    const afterA = after.find((t) => t.id === a.id);
    const afterB = after.find((t) => t.id === b.id);
    assert.equal(afterA.categoryId, 'restaurants', 'first concurrent PATCH was lost');
    assert.equal(afterB.note, 'checked', 'second concurrent PATCH was lost');
  });
});

test('a PATCH concurrent with an import commit loses neither update', async () => {
  await withImported(async (base, store) => {
    const rong = (await store.read('ledger')).find((t) => t.merchant === 'Sunshine Deli');
    const before = (await store.read('ledger')).length;

    const newRow = '01/08/2026,"ALDI STORES PRESTON VICAU","acct","cat","-44.43"';
    const [patchRes, commitRes] = await Promise.all([
      patch(base, rong.id, { categoryId: 'restaurants' }),
      fetch(`${base}/api/import/commit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ files: [{ filename: 'extra.csv', text: newRow }] })
      })
    ]);
    assert.equal(patchRes.status, 200);
    assert.equal(commitRes.status, 200);

    const after = await store.read('ledger');
    assert.equal(after.length, before + 1, 'the concurrently-imported row must not be lost');
    const patchedRow = after.find((t) => t.id === rong.id);
    assert.equal(patchedRow.categoryId, 'restaurants', 'the concurrent PATCH must not be lost');
    assert.ok(after.some((t) => t.merchant === 'Aldi Stores'), 'expected the newly imported Aldi row to be present');
  });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
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
    const otherMerchant = ledgerBefore.find((t) => t.merchant !== 'Coles' && t.merchant !== coles[0]?.merchant);
    assert.ok(otherMerchant, 'expected a transaction from a merchant other than Coles');
    const otherCategoryBefore = otherMerchant.categoryId;

    await patch(base, coles[0].id, { categoryId: 'alcohol', applyToPast: true });

    const after = (await store.read('ledger')).find((t) => t.id === otherMerchant.id);
    assert.equal(after.categoryId, otherCategoryBefore, 'a different merchant must be untouched by applyToPast');
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

// --- Fix-round tests: 'Unknown' pseudo-merchant, backup discipline, malformed JSON ---

test('applyToPast and rememberRule never group by the "Unknown" pseudo-merchant', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'spendexplore-txn-'));
  const app = await startServer({ port: 0, dataDir: dir });
  const base = `http://127.0.0.1:${app.port}`;
  try {
    // Two raw descriptions that normalise to nothing but location/noise
    // tokens both collapse to the literal merchant name 'Unknown' — despite
    // describing two completely unrelated transactions.
    const rows = [
      '10/08/2026,"VIC AU","acct","cat","-12.00"',
      '11/08/2026,"NSW AU","acct","cat","-18.00"'
    ].join('\n');
    await fetch(`${base}/api/import/commit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ files: [{ filename: 'unknown.csv', text: rows }] })
    });
    const ledger = await app.store.read('ledger');
    assert.equal(ledger.length, 2);
    assert.ok(ledger.every((t) => t.merchant === 'Unknown'));
    const [a, b] = ledger;

    const applyBody = await (await patch(base, a.id, {
      categoryId: 'shopping', applyToPast: true
    })).json();
    // The single-row edit itself must still work normally.
    assert.equal(applyBody.transaction.categoryId, 'shopping');
    assert.equal(applyBody.transaction.categorySource, 'manual');
    assert.equal(applyBody.updatedPast, 0, 'applyToPast must not group by the Unknown pseudo-merchant');

    const afterApply = await app.store.read('ledger');
    const other = afterApply.find((t) => t.id === b.id);
    assert.notEqual(other.categoryId, 'shopping', 'a different unidentifiable transaction must be untouched');
    assert.notEqual(other.categorySource, 'manual');

    const rememberBody = await (await patch(base, a.id, {
      categoryId: 'shopping', rememberRule: true
    })).json();
    assert.equal(rememberBody.ruleAdded, false, 'rememberRule must not write a rule keyed on "unknown"');
    const rules = await app.store.read('rules');
    assert.ok(!rules.some((r) => r.match === 'exact' && r.value === 'unknown'));
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('a no-op PATCH touches no disk: no backup, no ledger rewrite', async () => {
  await withImported(async (base, store) => {
    // withImported already committed one file, which itself backs up
    // unconditionally, so 'backups' already exists here — the assertion is
    // that a no-op PATCH adds no NEW backup, not that none exists at all.
    const backupsBefore = await readdir(join(store.dataDir, 'backups'));
    const t = (await store.read('ledger'))[0];
    const res = await patch(base, t.id, {});
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.transaction, t);
    assert.equal(body.updatedPast, 0);
    assert.equal(body.ruleAdded, false);
    const backupsAfter = await readdir(join(store.dataDir, 'backups'));
    assert.equal(backupsAfter.length, backupsBefore.length, 'a no-op PATCH must not create a backup');
  });
});

test('a single-row edit takes no backup; a bulk applyToPast does', async () => {
  await withImported(async (base, store) => {
    const backupsAfterImport = (await readdir(join(store.dataDir, 'backups'))).length;

    const rong = (await store.read('ledger')).find((t) => t.merchant === 'Sunshine Deli');
    await patch(base, rong.id, { categoryId: 'restaurants' });
    const backupsAfterSingleEdit = (await readdir(join(store.dataDir, 'backups'))).length;
    assert.equal(backupsAfterSingleEdit, backupsAfterImport, 'a single-row edit should not create a backup');

    const coles = (await store.read('ledger')).filter((t) => t.merchant === 'Coles');
    await patch(base, coles[0].id, { categoryId: 'alcohol', applyToPast: true });
    const backupsAfterBulk = (await readdir(join(store.dataDir, 'backups'))).length;
    assert.ok(backupsAfterBulk > backupsAfterSingleEdit, 'a bulk applyToPast should back up before rewriting the ledger');
  });
});

test('a syntactically invalid JSON body on PATCH is a clean 400, not a 500', async () => {
  await withImported(async (base, store) => {
    const t = (await store.read('ledger'))[0];
    const res = await fetch(`${base}/api/transactions/${t.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: '{ this is not json'
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /json/i);
  });
});

// --- Second fix round: a later bulk apply may override an earlier one ---

test('a later bulk apply corrects an earlier one, but a hand-picked row survives both', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'spendexplore-txn-'));
  const app = await startServer({ port: 0, dataDir: dir });
  const base = `http://127.0.0.1:${app.port}`;
  try {
    // Four Coles rows, all normalising to the same merchant 'Coles', so
    // applyToPast has more than one row to sweep in each direction.
    const rows = [
      '01/08/2026,"COLES 1234 COBURG VIC AUS","acct","cat","-10.00"',
      '02/08/2026,"COLES 5678 PRESTON VIC AUS","acct","cat","-20.00"',
      '03/08/2026,"COLES 9999 THORNBURY VIC AUS","acct","cat","-30.00"',
      '04/08/2026,"COLES 1111 DOCKLANDS VIC AUS","acct","cat","-40.00"'
    ].join('\n');
    await fetch(`${base}/api/import/commit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ files: [{ filename: 'coles.csv', text: rows }] })
    });
    const [a, b, c, d] = await app.store.read('ledger');
    assert.ok([a, b, c, d].every((t) => t.merchant === 'Coles'));

    // D is a row the user corrected by hand, one transaction at a time —
    // this is the permanent guarantee that must never weaken.
    await patch(base, d.id, { categoryId: 'takeaway' });

    // First bulk apply, from A: sweeps B and C ('bulk'), skips D ('manual').
    const first = await (await patch(base, a.id, {
      categoryId: 'alcohol', applyToPast: true
    })).json();
    assert.equal(first.updatedPast, 2, 'expected B and C to be swept, D skipped');

    // Second bulk apply, from B (currently 'bulk' alcohol, NOT the row the
    // user hand-picked): corrects the merchant to groceries. It must be
    // free to re-sweep C (also 'bulk'), but must still never touch A
    // (now 'manual', the actual PATCH target of the first apply) or D
    // (hand-picked from the start).
    const second = await (await patch(base, b.id, {
      categoryId: 'groceries', applyToPast: true
    })).json();
    assert.equal(second.updatedPast, 1, 'expected only C to be re-swept by the second bulk apply');

    const after = await app.store.read('ledger');
    const byId = Object.fromEntries(after.map((t) => [t.id, t]));

    assert.equal(byId[a.id].categoryId, 'alcohol', 'A was the first apply\'s own PATCH target — a later, different bulk apply must not override it');
    assert.equal(byId[a.id].categorySource, 'manual');

    assert.equal(byId[b.id].categoryId, 'groceries');
    assert.equal(byId[b.id].categorySource, 'manual');

    assert.equal(byId[c.id].categoryId, 'groceries', 'C should have been re-swept by the second bulk apply');
    assert.equal(byId[c.id].categorySource, 'bulk');

    assert.equal(byId[d.id].categoryId, 'takeaway', 'a hand-picked row must survive both bulk applies unchanged');
    assert.equal(byId[d.id].categorySource, 'manual');

    // Every non-manual Coles row ends up on the second apply's category.
    const nonManual = after.filter((t) => t.merchant === 'Coles' && t.categorySource !== 'manual');
    assert.ok(nonManual.length > 0);
    assert.ok(nonManual.every((t) => t.categoryId === 'groceries'));
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('a bulk-swept row counts as categorised, not as needing review', async () => {
  await withImported(async (base, store) => {
    const coles = (await store.read('ledger')).filter((t) => t.merchant === 'Coles');
    await patch(base, coles[0].id, { categoryId: 'alcohol', applyToPast: true });

    const sweptRow = (await store.read('ledger')).find((t) => t.id === coles[1].id);
    assert.equal(sweptRow.categorySource, 'bulk');

    // Everywhere the app distinguishes "needs review" from "already
    // categorised" (see lib/ingest.js's summary.needsReview), only
    // 'unknown' means needs review — 'manual', 'rule', 'bulk' and 'ai' are
    // all real categorisations.
    assert.notEqual(sweptRow.categorySource, 'unknown');
  });
});

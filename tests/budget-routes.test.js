import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/index.js';

const withServer = async (fn) => {
  const dir = await mkdtemp(join(tmpdir(), 'spendexplore-budgets-'));
  const app = await startServer({ port: 0, dataDir: dir });
  const base = `http://127.0.0.1:${app.port}`;
  try { await fn(base, app.store); }
  finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
};

const postBudget = (base, body) =>
  fetch(`${base}/api/budgets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });

test('a valid budget is appended and returned', async () => {
  await withServer(async (base) => {
    const res = await postBudget(base, { categoryId: 'groceries', amount: 500 });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.budgets.length, 1);
    assert.equal(body.budgets[0].categoryId, 'groceries');
    assert.equal(body.budgets[0].amount, 500);
    assert.match(body.budgets[0].effectiveFrom, /^\d{4}-\d{2}$/);
    assert.ok(body.budgets[0].id);
  });
});

test('rejects an unknown category', async () => {
  await withServer(async (base) => {
    const res = await postBudget(base, { categoryId: 'not-a-real-category', amount: 500 });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /Unknown category/);
  });
});

test('rejects income as a budget category', async () => {
  await withServer(async (base) => {
    const res = await postBudget(base, { categoryId: 'income', amount: 500 });
    assert.equal(res.status, 400);
  });
});

test('rejects uncategorised as a budget category', async () => {
  await withServer(async (base) => {
    const res = await postBudget(base, { categoryId: 'uncategorised', amount: 500 });
    assert.equal(res.status, 400);
  });
});

test('rejects a negative amount', async () => {
  await withServer(async (base) => {
    assert.equal((await postBudget(base, { categoryId: 'groceries', amount: -50 })).status, 400);
  });
});

test('rejects a non-numeric amount', async () => {
  await withServer(async (base) => {
    assert.equal((await postBudget(base, { categoryId: 'groceries', amount: 'lots' })).status, 400);
  });
});

test('a missing categoryId is rejected', async () => {
  await withServer(async (base) => {
    assert.equal((await postBudget(base, { amount: 500 })).status, 400);
  });
});

test('a $0 budget is accepted', async () => {
  await withServer(async (base) => {
    assert.equal((await postBudget(base, { categoryId: 'groceries', amount: 0 })).status, 200);
  });
});

test('a second budget for the same category APPENDS rather than overwrites', async () => {
  await withServer(async (base, store) => {
    await postBudget(base, { categoryId: 'groceries', amount: 500 });
    await postBudget(base, { categoryId: 'groceries', amount: 600 });
    const budgets = await store.read('budgets');
    assert.equal(budgets.length, 2);
    assert.equal(budgets[0].amount, 500);
    assert.equal(budgets[1].amount, 600);
  });
});

test('a malformed JSON body is a clean 400, not a 500', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/budgets`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json'
    });
    assert.equal(res.status, 400);
  });
});

test('GET /api/snapshot includes budgets', async () => {
  await withServer(async (base) => {
    await postBudget(base, { categoryId: 'groceries', amount: 500 });
    const snapshot = await (await fetch(`${base}/api/snapshot`)).json();
    assert.equal(snapshot.budgets.length, 1);
  });
});

// --- Group budgets ---

test('a valid group budget is appended and returned', async () => {
  await withServer(async (base) => {
    const res = await postBudget(base, { groupId: 'food-drink', amount: 400 });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.budgets.length, 1);
    assert.equal(body.budgets[0].groupId, 'food-drink');
    assert.equal(body.budgets[0].categoryId, null);
    assert.equal(body.budgets[0].amount, 400);
  });
});

test('a category budget stores groupId: null, and vice versa', async () => {
  await withServer(async (base, store) => {
    await postBudget(base, { categoryId: 'groceries', amount: 500 });
    const [entry] = await store.read('budgets');
    assert.equal(entry.categoryId, 'groceries');
    assert.equal(entry.groupId, null);
  });
});

test('rejects a body with both categoryId and groupId', async () => {
  await withServer(async (base) => {
    const res = await postBudget(base, { categoryId: 'groceries', groupId: 'food-drink', amount: 500 });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /Exactly one/);
  });
});

test('rejects a body with neither categoryId nor groupId', async () => {
  await withServer(async (base) => {
    const res = await postBudget(base, { amount: 500 });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /Exactly one/);
  });
});

test('rejects an unknown group', async () => {
  await withServer(async (base) => {
    const res = await postBudget(base, { groupId: 'not-a-real-group', amount: 500 });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /Unknown group/);
  });
});

test('rejects budgeting the "other" group, which holds only non-assignable categories', async () => {
  await withServer(async (base) => {
    const res = await postBudget(base, { groupId: 'other', amount: 500 });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /no assignable categories/);
  });
});

test('a group budget and a category budget inside it coexist independently', async () => {
  await withServer(async (base, store) => {
    await postBudget(base, { groupId: 'food-drink', amount: 400 });
    await postBudget(base, { categoryId: 'groceries', amount: 500 });
    const budgets = await store.read('budgets');
    assert.equal(budgets.length, 2);
    assert.ok(budgets.some((b) => b.groupId === 'food-drink'));
    assert.ok(budgets.some((b) => b.categoryId === 'groceries'));
  });
});

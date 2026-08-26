import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/index.js';

const withServer = async (fn) => {
  const dir = await mkdtemp(join(tmpdir(), 'spendexplore-settings-'));
  const app = await startServer({ port: 0, dataDir: dir });
  try { await fn(`http://127.0.0.1:${app.port}`, app.store); }
  finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
};

const patch = (base, path, body) =>
  fetch(`${base}${path}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });

const seedAccount = (store, id, over = {}) =>
  store.write('accounts', [{ id, label: id, ...over }]);

test('PATCH /api/accounts/:id updates the label and persists it', async () => {
  await withServer(async (base, store) => {
    await seedAccount(store, 'CC');
    const res = await patch(base, '/api/accounts/CC', { label: 'Credit Card' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.accounts.find((a) => a.id === 'CC').label, 'Credit Card');

    const onDisk = await store.read('accounts');
    assert.equal(onDisk.find((a) => a.id === 'CC').label, 'Credit Card');
  });
});

test('PATCH /api/accounts/:id sets cardOwners, replacing the whole map', async () => {
  await withServer(async (base, store) => {
    await seedAccount(store, 'default', { cardOwners: { '1111': 'Old Name' } });
    const res = await patch(base, '/api/accounts/default', { cardOwners: { '5611': 'Alex', '5603': 'Partner' } });
    assert.equal(res.status, 200);
    const body = await res.json();
    const account = body.accounts.find((a) => a.id === 'default');
    assert.deepEqual(account.cardOwners, { '5611': 'Alex', '5603': 'Partner' });
    // Full replace, not merge: the old suffix is gone, not carried forward.
    assert.equal('1111' in account.cardOwners, false);
  });
});

test('PATCH /api/accounts/:id can set label and cardOwners together', async () => {
  await withServer(async (base, store) => {
    await seedAccount(store, 'CC');
    const res = await patch(base, '/api/accounts/CC', { label: 'Card', cardOwners: { '5611': 'Alex' } });
    const account = (await res.json()).accounts.find((a) => a.id === 'CC');
    assert.equal(account.label, 'Card');
    assert.deepEqual(account.cardOwners, { '5611': 'Alex' });
  });
});

test('PATCH with neither label nor cardOwners is a no-op that still succeeds', async () => {
  await withServer(async (base, store) => {
    await seedAccount(store, 'CC', { label: 'Original' });
    const res = await patch(base, '/api/accounts/CC', {});
    assert.equal(res.status, 200);
    const account = (await res.json()).accounts.find((a) => a.id === 'CC');
    assert.equal(account.label, 'Original');
  });
});

test('an unknown account id 404s', async () => {
  await withServer(async (base, store) => {
    await seedAccount(store, 'CC');
    const res = await patch(base, '/api/accounts/nope', { label: 'X' });
    assert.equal(res.status, 404);
  });
});

test('rejects a non-object, an array, and a null body', async () => {
  await withServer(async (base, store) => {
    await seedAccount(store, 'CC');
    for (const body of ['a string', ['array'], null]) {
      const res = await patch(base, '/api/accounts/CC', body);
      assert.equal(res.status, 400, JSON.stringify(body));
    }
  });
});

test('rejects an empty, whitespace-only, or over-long label', async () => {
  await withServer(async (base, store) => {
    await seedAccount(store, 'CC');
    assert.equal((await patch(base, '/api/accounts/CC', { label: '' })).status, 400);
    assert.equal((await patch(base, '/api/accounts/CC', { label: '   ' })).status, 400);
    assert.equal((await patch(base, '/api/accounts/CC', { label: 'x'.repeat(61) })).status, 400);
  });
});

test('a label is trimmed before being stored', async () => {
  await withServer(async (base, store) => {
    await seedAccount(store, 'CC');
    const res = await patch(base, '/api/accounts/CC', { label: '  Credit Card  ' });
    const account = (await res.json()).accounts.find((a) => a.id === 'CC');
    assert.equal(account.label, 'Credit Card');
  });
});

test('rejects cardOwners that is not a plain object', async () => {
  await withServer(async (base, store) => {
    await seedAccount(store, 'CC');
    for (const cardOwners of ['string', ['array'], 42, null]) {
      const res = await patch(base, '/api/accounts/CC', { cardOwners });
      assert.equal(res.status, 400, JSON.stringify(cardOwners));
    }
  });
});

test('rejects a cardOwners key that is not exactly 4 digits', async () => {
  await withServer(async (base, store) => {
    await seedAccount(store, 'CC');
    for (const badKey of ['123', '12345', 'abcd', '']) {
      const res = await patch(base, '/api/accounts/CC', { cardOwners: { [badKey]: 'Alex' } });
      assert.equal(res.status, 400, badKey);
    }
  });
});

test('rejects a cardOwners value that is empty, non-string, or over-long', async () => {
  await withServer(async (base, store) => {
    await seedAccount(store, 'CC');
    assert.equal((await patch(base, '/api/accounts/CC', { cardOwners: { '5611': '' } })).status, 400);
    assert.equal((await patch(base, '/api/accounts/CC', { cardOwners: { '5611': '   ' } })).status, 400);
    assert.equal((await patch(base, '/api/accounts/CC', { cardOwners: { '5611': 42 } })).status, 400);
    assert.equal((await patch(base, '/api/accounts/CC', { cardOwners: { '5611': 'x'.repeat(41) } })).status, 400);
  });
});

test('a cardOwners value is trimmed before being stored', async () => {
  await withServer(async (base, store) => {
    await seedAccount(store, 'CC');
    const res = await patch(base, '/api/accounts/CC', { cardOwners: { '5611': '  Alex  ' } });
    const account = (await res.json()).accounts.find((a) => a.id === 'CC');
    assert.equal(account.cardOwners['5611'], 'Alex');
  });
});

test('a backup is taken before the write', async () => {
  await withServer(async (base, store) => {
    await seedAccount(store, 'CC');
    await patch(base, '/api/accounts/CC', { label: 'Card' });
    const backupDirs = await readdir(join(store.dataDir, 'backups'));
    assert.ok(backupDirs.length > 0, 'expected at least one backup after the write');
  });
});

test('updating one account does not touch another', async () => {
  await withServer(async (base, store) => {
    await store.write('accounts', [{ id: 'CC', label: 'CC' }, { id: 'default', label: 'default' }]);
    await patch(base, '/api/accounts/CC', { label: 'Card' });
    const onDisk = await store.read('accounts');
    assert.equal(onDisk.find((a) => a.id === 'default').label, 'default');
  });
});

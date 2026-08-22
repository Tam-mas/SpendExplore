import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../server/store.js';

const withStore = async (fn) => {
  const dir = await mkdtemp(join(tmpdir(), 'spendexplore-'));
  try { await fn(await (async () => { const s = createStore(dir); await s.init(); return s; })(), dir); }
  finally { await rm(dir, { recursive: true, force: true }); }
};

test('init seeds categories and rules but starts with an empty ledger', async () => {
  await withStore(async (store) => {
    const categories = await store.read('categories');
    assert.ok(categories.groups.length >= 7);
    assert.ok((await store.read('rules')).length > 20);
    assert.deepEqual(await store.read('ledger'), []);
    assert.deepEqual(await store.read('imports'), []);
    assert.deepEqual(await store.read('views'), []);
    assert.deepEqual(await store.read('accounts'), []);
  });
});

test('init does not overwrite existing data', async () => {
  await withStore(async (store, dir) => {
    await store.write('ledger', [{ id: 'abc' }]);
    await createStore(dir).init();
    assert.deepEqual(await store.read('ledger'), [{ id: 'abc' }]);
  });
});

test('write then read round-trips', async () => {
  await withStore(async (store) => {
    await store.write('ledger', [{ id: 'x', amount: -1.5 }]);
    assert.deepEqual(await store.read('ledger'), [{ id: 'x', amount: -1.5 }]);
  });
});

test('write leaves no temp file behind', async () => {
  await withStore(async (store, dir) => {
    await store.write('ledger', [{ id: 'x' }]);
    const files = await readdir(dir);
    assert.ok(!files.some((f) => f.endsWith('.tmp')), `temp file left: ${files}`);
  });
});

test('backup copies current data and returns its path', async () => {
  await withStore(async (store) => {
    await store.write('ledger', [{ id: 'before' }]);
    const path = await store.backup();
    await store.write('ledger', [{ id: 'after' }]);
    const backed = JSON.parse(await readFile(join(path, 'ledger.json'), 'utf8'));
    assert.deepEqual(backed, [{ id: 'before' }]);
    assert.deepEqual(await store.read('ledger'), [{ id: 'after' }]);
  });
});

test('reading a corrupt file throws a message naming the file', async () => {
  await withStore(async (store, dir) => {
    await writeFile(join(dir, 'ledger.json'), '{ not json');
    await assert.rejects(() => store.read('ledger'), /ledger\.json/);
  });
});

test('rejects an unknown collection name', async () => {
  await withStore(async (store) => {
    await assert.rejects(() => store.read('../../etc/passwd'), /Unknown collection/);
    await assert.rejects(() => store.write('evil', []), /Unknown collection/);
  });
});

// --- Additional tests beyond the brief ---

test('a write that fails during serialisation does not corrupt the existing file', async () => {
  await withStore(async (store) => {
    await store.write('ledger', [{ id: 'safe' }]);

    const circular = {};
    circular.self = circular;
    await assert.rejects(() => store.write('ledger', circular));

    // The original, valid data must still be there and still readable.
    assert.deepEqual(await store.read('ledger'), [{ id: 'safe' }]);
  });
});

test('backup on a fresh store (no data files yet) does not throw', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'spendexplore-'));
  try {
    const store = createStore(dir);
    // Deliberately no init() — no data files exist at all yet.
    const path = await store.backup();
    assert.equal(typeof path, 'string');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('two sequential backups never collide, even at identical timestamps', async () => {
  await withStore(async (store) => {
    // Freeze time so both calls compute the exact same ISO timestamp,
    // forcing the collision a naive millisecond-resolution stamp would hit.
    const RealDate = globalThis.Date;
    class FrozenDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) super(0);
        else super(...args);
      }
      static now() { return 0; }
    }
    globalThis.Date = FrozenDate;
    try {
      const p1 = await store.backup();
      const p2 = await store.backup();
      assert.notEqual(p1, p2, 'two backups at the same timestamp must not share a directory');
      // Both directories must actually exist and be independently readable.
      await access(p1);
      await access(p2);
    } finally {
      globalThis.Date = RealDate;
    }
  });
});

test('read of a missing collection file returns the seeded default without creating the file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'spendexplore-'));
  try {
    const store = createStore(dir);
    // No init() — the ledger file has never been created.
    const data = await store.read('ledger');
    assert.deepEqual(data, []);

    await assert.rejects(() => access(join(dir, 'ledger.json')), /ENOENT/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

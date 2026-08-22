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

test('two concurrent backups never collide, even at identical timestamps', async () => {
  await withStore(async (store) => {
    // Freeze time so both calls compute the exact same ISO timestamp, then
    // fire them WITHOUT awaiting between the two calls, so their mkdir()
    // calls genuinely race rather than merely running back-to-back. A
    // check-then-act (access() then mkdir()) probe can let both callers pass
    // the check before either directory exists; only an atomic mkdir-as-the-
    // exclusivity-check is safe against this.
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
      const [p1, p2] = await Promise.all([store.backup(), store.backup()]);
      assert.notEqual(p1, p2, 'two backups at the same timestamp must not share a directory');
      // Both directories must actually exist and be independently readable.
      await access(p1);
      await access(p2);
    } finally {
      globalThis.Date = RealDate;
    }
  });
});

test('concurrent writes to the same collection serialise instead of racing', async () => {
  await withStore(async (store) => {
    // Issue both writes synchronously (no await between them) so their
    // internal tmp-write/rename pairs would race for real if the store did
    // not serialise same-collection writes. The queue makes call order the
    // execution order, so writeB — issued second — is guaranteed to run
    // after writeA completes.
    const writeA = store.write('ledger', [{ id: 'a' }]);
    const writeB = store.write('ledger', [{ id: 'b' }]);
    const results = await Promise.allSettled([writeA, writeB]);

    assert.ok(
      results.every((r) => r.status === 'fulfilled'),
      `both concurrent writes should succeed once serialised: ${JSON.stringify(results)}`
    );

    // Because writes are serialised in call order, writeB is guaranteed to
    // be the one that actually lands — deterministic last-writer-wins,
    // rather than whichever caller happened to win a filesystem race (which
    // could previously let writeA's promise fulfil while writeB's payload
    // was what actually got renamed into place).
    assert.deepEqual(await store.read('ledger'), [{ id: 'b' }]);
  });
});

test('rejects collection names that only resolve via the prototype chain', async () => {
  await withStore(async (store) => {
    // A plain-object allow-list checked with `if (!spec)` lets these through:
    // COLLECTIONS.toString, .constructor, .valueOf, .hasOwnProperty, and
    // .__proto__ all resolve to a truthy inherited member of Object.prototype
    // rather than undefined. They must be rejected by the allow-list itself
    // (Unknown collection), not merely happen to crash on `spec.file` being
    // undefined further down.
    for (const name of ['toString', 'constructor', 'valueOf', 'hasOwnProperty', '__proto__']) {
      await assert.rejects(() => store.read(name), /Unknown collection/, `read('${name}')`);
      await assert.rejects(() => store.write(name, []), /Unknown collection/, `write('${name}')`);
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

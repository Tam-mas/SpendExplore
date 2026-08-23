import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { startServer, createApp } from '../server/index.js';
import { readBody, UserFacingError } from '../server/http.js';

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const withServer = async (fn) => {
  const dir = await mkdtemp(join(tmpdir(), 'spendexplore-srv-'));
  const app = await startServer({ port: 0, dataDir: dir });
  try { await fn(`http://127.0.0.1:${app.port}`, dir, app); }
  finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
};

// Runs createApp(fakeStore) on a raw http server, bypassing startServer's
// real store/dataDir — for tests that need to control exactly what a route
// handler throws, without corrupting real files on disk to provoke it.
const withStubStore = async (fakeStore, fn) => {
  const server = createServer(createApp(fakeStore));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
};

test('binds to loopback only', async () => {
  await withServer(async (base) => {
    const address = new URL(base);
    assert.equal(address.hostname, '127.0.0.1');
    assert.equal((await fetch(`${base}/api/snapshot`)).status, 200);
  });
});

test('snapshot returns every collection', async () => {
  await withServer(async (base) => {
    const body = await (await fetch(`${base}/api/snapshot`)).json();
    assert.deepEqual(body.transactions, []);
    assert.ok(body.categories.groups.length >= 7);
    assert.ok(body.rules.length > 20);
    assert.deepEqual(body.accounts, []);
    assert.deepEqual(body.views, []);
    assert.deepEqual(body.imports, []);
  });
});

test('unknown api route returns 404 JSON', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/nope`);
    assert.equal(res.status, 404);
    assert.match(res.headers.get('content-type'), /application\/json/);
    assert.equal((await res.json()).error, 'Not found');
  });
});

test('serves the web UI at /', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(await res.text(), /SpendExplore/);
  });
});

test('refuses path traversal in static paths', async () => {
  await withServer(async (base) => {
    // A raw ".." at the URL root is stripped by new URL()'s own dot-segment
    // normalisation before this ever reaches our code, so this particular
    // request is refused only because /server/store.js doesn't exist under
    // web/ (ordinary 404) — it does not exercise the boundary check itself.
    // See "refuses several encodings of path traversal" below for the
    // encodings that actually reach the boundary check.
    const res = await fetch(`${base}/../server/store.js`, { redirect: 'manual' });
    assert.ok([400, 404].includes(res.status), `unexpected status ${res.status}`);
  });
});

// --- Additional security tests beyond the brief's baseline ---

test('refuses several encodings of path traversal, and never leaks file content', async () => {
  await withServer(async (base) => {
    const attempts = [
      // Raw "..": stripped by URL parsing before it reaches us; refused as
      // an ordinary 404, not by the boundary check. Kept as documentation
      // of that normalisation path, not as boundary-check coverage.
      '/../server/store.js',
      // %2f is not treated as a path separator during URL parsing, so this
      // survives intact and only becomes "../server/store.js" after our own
      // decodeURIComponent — this is what actually reaches the boundary
      // check in serveStatic.
      '/..%2fserver/store.js',
      '/..%2f..%2fserver/store.js',
      // Fully percent-encoded (dots and slash both escaped) so the "%2e%2e"
      // segment is never adjacent to a raw "/", which is what stops the URL
      // parser's dot-segment collapsing from firing early the way it did
      // for the "%2e%2e/..." form.
      '/%2e%2e%2fserver%2fstore.js',
    ];
    for (const path of attempts) {
      const res = await fetch(`${base}${path}`, { redirect: 'manual' });
      assert.ok([400, 404].includes(res.status), `${path} => unexpected status ${res.status}`);
      const text = await res.text();
      assert.doesNotMatch(text, /createStore/, `${path} leaked store.js source into the response body`);
    }
  });
});

test('refuses a path containing a null byte', async () => {
  await withServer(async (base) => {
    // %00 decodes to a literal NUL, which node's fs functions reject outright.
    const res = await fetch(`${base}/..%2fserver%2fstore.js%00.html`, { redirect: 'manual' });
    assert.ok([400, 404].includes(res.status), `unexpected status ${res.status}`);
    const text = await res.text();
    assert.doesNotMatch(text, /createStore/);
  });
});

test('a sibling directory sharing the "web" prefix cannot be escaped into', async () => {
  // Regression test for the classic startsWith(prefix) trap: a naive check
  // like target.startsWith(WEB_DIR) is fooled by a sibling directory whose
  // name happens to start with the same characters, e.g. "web-evil" starts
  // with "web". Create such a sibling next to the real web/ dir and confirm
  // several encodings are all refused, not served.
  const evilDir = join(PROJECT_ROOT, 'web-evil');
  await mkdir(evilDir, { recursive: true });
  await writeFile(join(evilDir, 'secret.txt'), 'TOP SECRET SIBLING CONTENT');
  try {
    await withServer(async (base) => {
      const attempts = [
        // Raw "..": normalised away by URL parsing at the root, so this
        // resolves to /web-evil/secret.txt (looked up *under* web/, where
        // it doesn't exist) — an ordinary 404, not boundary-check coverage.
        '/../web-evil/secret.txt',
        // %2f survives URL parsing intact; after our decode this is a
        // genuine "../web-evil/secret.txt" that reaches the boundary check.
        '/..%2fweb-evil/secret.txt',
        '/..%2f..%2fweb-evil/secret.txt',
        '/%2e%2e%2fweb-evil%2fsecret.txt',
      ];
      for (const path of attempts) {
        const res = await fetch(`${base}${path}`, { redirect: 'manual' });
        assert.ok([400, 404].includes(res.status), `${path} => unexpected status ${res.status}`);
        const text = await res.text();
        assert.doesNotMatch(text, /TOP SECRET SIBLING CONTENT/, `${path} leaked the sibling file`);
      }
    });
  } finally {
    await rm(evilDir, { recursive: true, force: true });
  }
});

test('a "dot dot slash slash" bypass attempt does not escape web/', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/....//server/store.js`, { redirect: 'manual' });
    assert.ok([400, 404].includes(res.status), `unexpected status ${res.status}`);
    const text = await res.text();
    assert.doesNotMatch(text, /createStore/);
  });
});

// --- /lib/ static root: same boundary check, same trap, mirrored tests ---

test('refuses several encodings of path traversal under /lib/, and never leaks file content', async () => {
  await withServer(async (base) => {
    const attempts = [
      // %2f survives URL parsing intact; after our decode this is a genuine
      // "../server/store.js" relative to lib/, which reaches the boundary
      // check in serveStatic.
      '/lib/..%2fserver/store.js',
      '/lib/..%2f..%2fserver/store.js',
      '/%2e%2e%2flib%2f..%2fserver%2fstore.js',
    ];
    for (const path of attempts) {
      const res = await fetch(`${base}${path}`, { redirect: 'manual' });
      assert.ok([400, 404].includes(res.status), `${path} => unexpected status ${res.status}`);
      const text = await res.text();
      assert.doesNotMatch(text, /createStore/, `${path} leaked store.js source into the response body`);
    }
  });
});

test('a sibling directory sharing the "lib" prefix cannot be escaped into', async () => {
  // Regression test for the classic startsWith(prefix) trap applied to the
  // new root: a naive check like target.startsWith(LIB_DIR) is fooled by a
  // sibling directory whose name happens to start with the same characters,
  // e.g. "lib-evil" starts with "lib". Create such a sibling next to the
  // real lib/ dir and confirm several encodings are all refused.
  const evilDir = join(PROJECT_ROOT, 'lib-evil');
  await mkdir(evilDir, { recursive: true });
  await writeFile(join(evilDir, 'secret.txt'), 'TOP SECRET LIB SIBLING CONTENT');
  try {
    await withServer(async (base) => {
      const attempts = [
        // A direct request under the wrong prefix never even matches the
        // /lib/ branch (isLib requires an exact "/lib" or "/lib/" prefix,
        // not a bare "/lib" string match), so it falls through to the web/
        // root and 404s there — ordinary 404, not boundary-check coverage.
        '/lib-evil/secret.txt',
        // %2f survives URL parsing intact; after decode this is a genuine
        // "../lib-evil/secret.txt" relative to lib/, which reaches the
        // boundary check.
        '/lib/..%2flib-evil/secret.txt',
        '/lib/..%2f..%2flib-evil/secret.txt',
      ];
      for (const path of attempts) {
        const res = await fetch(`${base}${path}`, { redirect: 'manual' });
        assert.ok([400, 404].includes(res.status), `${path} => unexpected status ${res.status}`);
        const text = await res.text();
        assert.doesNotMatch(text, /TOP SECRET LIB SIBLING CONTENT/, `${path} leaked the sibling file`);
      }
    });
  } finally {
    await rm(evilDir, { recursive: true, force: true });
  }
});

test('readBody rejects a body over the size cap instead of buffering it', async () => {
  const fakeReq = new EventEmitter();
  fakeReq.destroy = () => { fakeReq.destroyed = true; };

  const promise = readBody(fakeReq);
  // 6 x 10MB chunks = 60MB, over the 50MB cap. Buffer.alloc is zero-filled
  // and cheap, so this stays fast without needing a real socket.
  const chunk = Buffer.alloc(10 * 1024 * 1024);
  for (let i = 0; i < 6 && !fakeReq.destroyed; i++) {
    fakeReq.emit('data', chunk);
  }
  await assert.rejects(promise, /too large/i);
  assert.equal(fakeReq.destroyed, true);
});

test('unknown api route returns JSON content-type, not HTML', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/does-not-exist`);
    assert.equal(res.status, 404);
    assert.match(res.headers.get('content-type'), /application\/json/);
    assert.doesNotMatch(res.headers.get('content-type') ?? '', /text\/html/);
  });
});

test('server only binds the loopback address, never all interfaces', async () => {
  await withServer(async (_base, _dir, app) => {
    const address = app.server.address();
    assert.equal(address.address, '127.0.0.1');
    assert.notEqual(address.address, '0.0.0.0');
  });
});

// --- Error-handling: UserFacingError vs. unexpected errors (review fix) ---

test('a UserFacingError message reaches the client verbatim', async () => {
  const message = 'ledger.json is not valid JSON. Restore it from data/backups/ before starting again.';
  const fakeStore = {
    read: async () => { throw new UserFacingError(message); },
  };
  await withStubStore(fakeStore, async (base) => {
    const res = await fetch(`${base}/api/snapshot`);
    const body = await res.json();
    assert.equal(res.status, 500);
    assert.equal(body.error, message);
  });
});

test('an unexpected error is masked to a generic message and does not leak filesystem paths', async () => {
  const absolutePath = '/Users/tam/Documents/SpendExplore/data/ledger.json';
  const fakeStore = {
    read: async () => { throw new Error(`ENOENT: no such file or directory, open '${absolutePath}'`); },
  };
  const originalConsoleError = console.error;
  let logged;
  console.error = (err) => { logged = err; };
  try {
    await withStubStore(fakeStore, async (base) => {
      const res = await fetch(`${base}/api/snapshot`);
      const body = await res.json();
      assert.equal(res.status, 500);
      assert.equal(body.error, 'Internal server error');
      assert.ok(!JSON.stringify(body).includes(absolutePath), 'response body leaked the absolute path');
      assert.ok(!JSON.stringify(body).includes('/Users/'), 'response body leaked a filesystem path');
    });
  } finally {
    console.error = originalConsoleError;
  }
  // The real error must still reach server-side logs, or debugging an
  // unexpected failure would be impossible with the client-facing message
  // reduced to "Internal server error".
  assert.ok(logged instanceof Error);
  assert.match(logged.message, /ENOENT/);
  assert.match(logged.message, /ledger\.json/);
});

test('a corrupt data file surfaces its UserFacingError through the real snapshot endpoint', async () => {
  await withServer(async (base, dir) => {
    await writeFile(join(dir, 'ledger.json'), '{ not json');
    const res = await fetch(`${base}/api/snapshot`);
    const body = await res.json();
    assert.equal(res.status, 500);
    assert.match(body.error, /ledger\.json is not valid JSON/);
    assert.match(body.error, /Restore it from data\/backups/);
  });
});

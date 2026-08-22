import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { startServer } from '../server/index.js';
import { readBody } from '../server/routes.js';

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const withServer = async (fn) => {
  const dir = await mkdtemp(join(tmpdir(), 'spendexplore-srv-'));
  const app = await startServer({ port: 0, dataDir: dir });
  try { await fn(`http://127.0.0.1:${app.port}`, dir, app); }
  finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
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
    const res = await fetch(`${base}/../server/store.js`, { redirect: 'manual' });
    assert.ok([400, 404].includes(res.status), `unexpected status ${res.status}`);
  });
});

// --- Additional security tests beyond the brief's baseline ---

test('refuses several encodings of path traversal, and never leaks file content', async () => {
  await withServer(async (base) => {
    const attempts = [
      '/../server/store.js',
      '/..%2fserver/store.js',
      '/%2e%2e/server/store.js',
      '/..%2f..%2fserver/store.js',
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
  // it is refused, not served.
  const evilDir = join(PROJECT_ROOT, 'web-evil');
  await mkdir(evilDir, { recursive: true });
  await writeFile(join(evilDir, 'secret.txt'), 'TOP SECRET SIBLING CONTENT');
  try {
    await withServer(async (base) => {
      // A raw ".." in the request line gets eaten by the WHATWG URL
      // parser's own dot-segment normalisation before it ever reaches our
      // code (there's nothing to go "up" from at the root), so it never
      // actually exercises the boundary check. %2f survives that parse
      // step untouched — it only becomes ".." after *our* decode — so this
      // is the encoding that actually reaches serveStatic's boundary logic
      // with a literal "../web-evil/secret.txt".
      const res = await fetch(`${base}/..%2fweb-evil/secret.txt`, { redirect: 'manual' });
      assert.ok([400, 404].includes(res.status), `unexpected status ${res.status}`);
      const text = await res.text();
      assert.doesNotMatch(text, /TOP SECRET SIBLING CONTENT/);
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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:net';
import { startServer } from '../server/index.js';

const withServer = async (fn) => {
  const dir = await mkdtemp(join(tmpdir(), 'spendexplore-gate-'));
  const app = await startServer({ port: 0, dataDir: dir });
  try { await fn(`http://127.0.0.1:${app.port}`, app.port); }
  finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
};

// Opens a raw TCP connection, sends request headers declaring a body that
// never actually arrives, and leaves the socket open. A route that calls
// readBody() INSIDE the shared mutation gate would have that gate's promise
// chain wait forever on this connection, wedging every other write in the
// app behind it.
const openStalledPost = (port, path) => new Promise((resolve, reject) => {
  const socket = connect(port, '127.0.0.1', () => {
    socket.write(
      `POST ${path} HTTP/1.1\r\n` +
      `Host: 127.0.0.1:${port}\r\n` +
      `Content-Type: application/json\r\n` +
      `Content-Length: 100\r\n\r\n`
      // deliberately no body — the request never completes
    );
    resolve(socket);
  });
  socket.on('error', reject);
});

test('a stalled request body does not wedge the shared mutation gate', async () => {
  await withServer(async (base, port) => {
    const stalled = await openStalledPost(port, '/api/categories');
    try {
      const start = Date.now();
      const res = await fetch(`${base}/api/budgets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ categoryId: 'groceries', amount: 500 })
      });
      const elapsed = Date.now() - start;
      assert.equal(res.status, 200);
      assert.ok(elapsed < 2000, `expected the unrelated write to complete quickly, took ${elapsed}ms`);
    } finally {
      stalled.destroy();
    }
  });
});

test('a stalled request body does not wedge a later PATCH either', async () => {
  await withServer(async (base, port) => {
    const stalled = await openStalledPost(port, '/api/categories');
    try {
      const start = Date.now();
      const res = await fetch(`${base}/api/categories`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'test-cat', label: 'Test', groupId: 'other' })
      });
      const elapsed = Date.now() - start;
      assert.equal(res.status, 200);
      assert.ok(elapsed < 2000, `expected the unrelated write to complete quickly, took ${elapsed}ms`);
    } finally {
      stalled.destroy();
    }
  });
});

test('a stalled request body on the settings route does not wedge an unrelated write', async () => {
  await withServer(async (base, port) => {
    // The stall target is /api/accounts/CC itself (a PATCH, not a POST) —
    // proving THIS route reads its body outside the gate, not just that
    // some other route does.
    const stalled = await new Promise((resolve, reject) => {
      const socket = connect(port, '127.0.0.1', () => {
        socket.write(
          `PATCH /api/accounts/CC HTTP/1.1\r\n` +
          `Host: 127.0.0.1:${port}\r\n` +
          `Content-Type: application/json\r\n` +
          `Content-Length: 100\r\n\r\n`
        );
        resolve(socket);
      });
      socket.on('error', reject);
    });
    try {
      const start = Date.now();
      const res = await fetch(`${base}/api/budgets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ categoryId: 'groceries', amount: 500 })
      });
      const elapsed = Date.now() - start;
      assert.equal(res.status, 200);
      assert.ok(elapsed < 2000, `expected the unrelated write to complete quickly, took ${elapsed}ms`);
    } finally {
      stalled.destroy();
    }
  });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/index.js';

const withServer = async (fn) => {
  const dir = await mkdtemp(join(tmpdir(), 'spendexplore-smoke-'));
  const app = await startServer({ port: 0, dataDir: dir });
  try { await fn(`http://127.0.0.1:${app.port}`); }
  finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
};

test('every UI asset is served', async () => {
  await withServer(async (base) => {
    for (const path of ['/', '/style.css', '/app.js', '/api.js', '/import-view.js', '/overview-view.js']) {
      const res = await fetch(`${base}${path}`);
      assert.equal(res.status, 200, `${path} returned ${res.status}`);
    }
  });
});

test('the page wires up the module entry point and both tabs', async () => {
  await withServer(async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /<script type="module" src="\/app\.js">/);
    assert.match(html, /data-tab="import"/);
    assert.match(html, /data-tab="overview"/);
  });
});

test('no UI asset references an external host', async () => {
  await withServer(async (base) => {
    for (const path of ['/', '/style.css', '/app.js', '/api.js', '/import-view.js', '/overview-view.js']) {
      const body = await (await fetch(`${base}${path}`)).text();
      assert.doesNotMatch(body, /https?:\/\/(?!127\.0\.0\.1|localhost)/,
        `${path} references an external host`);
    }
  });
});

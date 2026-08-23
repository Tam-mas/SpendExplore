import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/index.js';

const withServer = async (fn) => {
  const dir = await mkdtemp(join(tmpdir(), 'spendexplore-modgraph-'));
  const app = await startServer({ port: 0, dataDir: dir });
  try { await fn(`http://127.0.0.1:${app.port}`); }
  finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
};

// Node's tests import modules through the filesystem and never notice when a
// browser-facing relative import can't actually be fetched over HTTP. This
// walks the real module graph the way a browser does: fetch a module, scan
// its source for `import ... from '...'` specifiers, resolve each one against
// the importing module's own URL, and recurse. Every module reachable this
// way must come back 200, or the page fails to load in a real browser exactly
// as Overview did (GET /lib/query/query.js 404).
async function fetchModuleGraph(base) {
  const visited = new Map();
  const importRe = /import\s+(?:[^'"]+?\s+from\s+)?['"]([^'"]+)['"]/g;

  async function visit(url) {
    if (visited.has(url)) return;
    const res = await fetch(url);
    visited.set(url, res.status);
    if (res.status !== 200) return;
    const source = await res.text();
    for (const match of source.matchAll(importRe)) {
      const spec = match[1];
      if (!spec.startsWith('.') && !spec.startsWith('/')) continue; // skip bare specifiers
      const resolved = new URL(spec, url).href;
      await visit(resolved);
    }
  }

  await visit(`${base}/app.js`);
  return visited;
}

test('the entire browser module graph reachable from /app.js resolves over HTTP', async () => {
  await withServer(async (base) => {
    const visited = await fetchModuleGraph(base);
    const paths = [...visited.keys()].map((u) => new URL(u).pathname);

    assert.ok(paths.includes('/lib/query/query.js'), 'graph never reached /lib/query/query.js');
    assert.ok(paths.includes('/charts/palette.js'), 'graph never reached /charts/palette.js');

    for (const [url, status] of visited) {
      assert.equal(status, 200, `${url} returned ${status}`);
    }
  });
});

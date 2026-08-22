import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');

// app.js, import-view.js and overview-view.js all reference `document` at
// module-evaluation time (they call document.querySelector or use it inside
// functions), so importing them for real against Node's non-DOM environment
// would throw a ReferenceError that has nothing to do with syntax validity.
// `node --check` parses the file without executing it — since the project's
// package.json declares "type": "module", Node parses plain .js files under
// it as ESM, so `import`/`export` syntax is validated, not rejected.
async function assertParsesAsModule(name) {
  await run(process.execPath, ['--check', join(WEB_DIR, name)]);
}

test('web/app.js is a syntactically valid ES module', async () => {
  await assertParsesAsModule('app.js');
});

test('web/api.js is a syntactically valid ES module', async () => {
  await assertParsesAsModule('api.js');
});

test('web/import-view.js is a syntactically valid ES module', async () => {
  await assertParsesAsModule('import-view.js');
});

test('web/overview-view.js is a syntactically valid ES module', async () => {
  await assertParsesAsModule('overview-view.js');
});

test('every fetch() in api.js targets a same-origin relative path', async () => {
  const source = await readFile(join(WEB_DIR, 'api.js'), 'utf8');
  const fetchCalls = [...source.matchAll(/fetch\(([^,)]+)/g)].map((m) => m[1].trim());
  assert.ok(fetchCalls.length > 0, 'expected at least one fetch() call in api.js');
  for (const arg of fetchCalls) {
    // The fetch target must be a bare identifier bound to a relative,
    // same-origin string ('/api/...'), never a literal absolute URL.
    assert.doesNotMatch(arg, /^['"`]https?:/, `fetch(${arg}) looks like an absolute URL literal`);
  }
  // Every exported request-shaped path string must start with '/'.
  const pathLiterals = [...source.matchAll(/request\(\s*(['"`])(.*?)\1/g)].map((m) => m[2]);
  assert.ok(pathLiterals.length > 0, 'expected request() calls with literal path arguments');
  for (const path of pathLiterals) {
    assert.match(path, /^\//, `path "${path}" is not same-origin relative`);
  }
});

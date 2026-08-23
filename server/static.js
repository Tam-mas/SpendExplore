import { readFile } from 'node:fs/promises';
import { join, normalize, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendJson } from './http.js';

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const WEB_DIR = join(PROJECT_ROOT, 'web');
export const LIB_DIR = join(PROJECT_ROOT, 'lib');

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

// Resolve `relative` against `root` and verify the result stays inside root.
//
// A plain `target.startsWith(root)` is the classic trap: it's a raw
// string-prefix check, so a *sibling* directory whose name happens to start
// with the same characters as root (e.g. "web-evil" starts with "web", and
// equally "lib-evil" starts with "lib") would pass it and let a request
// escape into that sibling. The fix is to require either an exact match or
// that the next character after the prefix is a path separator, i.e.
// target === root or target.startsWith(root + sep) — never a bare prefix
// match. Both static roots (web/ and lib/) share this one implementation so
// neither can drift into the weaker form.
//
// Known limitation: this checks the requested path lexically, not the
// resolved filesystem target — symlinks under root are not followed via
// realpath, so a symlink planted inside root pointing outside it would not
// be caught here. Not exploitable today (nothing writes into web/ or lib/
// at runtime), but worth knowing if that ever changes.
function resolveWithinRoot(root, relative) {
  const target = normalize(join(root, relative));
  if (target !== root && !target.startsWith(root + sep)) return null;
  return target;
}

export async function serveStatic(req, res, pathname) {
  // /lib/... is served from the project's lib/ directory so browser-facing
  // modules under web/ (e.g. panel.js, overview-view.js) can import the
  // query engine via '../lib/query/query.js' — a relative import resolves
  // to /lib/... in the browser, and without this branch that request 404s,
  // breaking the whole module graph even though every Node test (which
  // imports via the filesystem, never HTTP) stays green.
  const isLib = pathname === '/lib' || pathname.startsWith('/lib/');
  const root = isLib ? LIB_DIR : WEB_DIR;
  const relative = isLib
    ? pathname.slice('/lib'.length).replace(/^\/+/, '')
    : (pathname === '/' ? 'index.html' : pathname.slice(1));

  const target = resolveWithinRoot(root, relative);
  if (target === null) {
    return sendJson(res, 400, { error: 'Bad path' });
  }

  try {
    const body = await readFile(target);
    res.writeHead(200, {
      'content-type': MIME[extname(target)] ?? 'application/octet-stream',
      'cache-control': 'no-store'
    });
    res.end(body);
  } catch {
    sendJson(res, 404, { error: 'Not found' });
  }
}

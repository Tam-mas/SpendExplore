import { readFile } from 'node:fs/promises';
import { join, normalize, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendJson } from './http.js';

export const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

export async function serveStatic(req, res, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  // normalize() then verify the resolved path is inside WEB_DIR.
  //
  // A plain `target.startsWith(WEB_DIR)` is the classic trap: it's a raw
  // string-prefix check, so a *sibling* directory whose name happens to
  // start with the same characters as WEB_DIR (e.g. "web-evil" starts with
  // "web") would pass it and let a request escape into that sibling. The
  // fix is to require either an exact match or that the next character
  // after the prefix is a path separator, i.e. target === WEB_DIR or
  // target.startsWith(WEB_DIR + sep) — never a bare prefix match.
  const target = normalize(join(WEB_DIR, relative));
  if (target !== WEB_DIR && !target.startsWith(WEB_DIR + sep)) {
    return sendJson(res, 400, { error: 'Bad path' });
  }
  // Known limitation: this checks the requested path lexically, not the
  // resolved filesystem target — symlinks under web/ are not followed via
  // realpath, so a symlink planted inside web/ pointing outside it would
  // not be caught here. Not exploitable today (nothing writes into web/
  // at runtime), but worth knowing if that ever changes.

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

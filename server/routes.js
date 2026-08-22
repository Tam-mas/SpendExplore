import { readFile } from 'node:fs/promises';
import { join, normalize, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

export const sendJson = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload)
  });
  res.end(payload);
};

export const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    // Guard against an unbounded upload filling memory.
    if (size > 50 * 1024 * 1024) { reject(new Error('Request body too large (limit 50MB)')); req.destroy(); return; }
    chunks.push(chunk);
  });
  req.on('end', () => {
    const text = Buffer.concat(chunks).toString('utf8');
    if (text === '') return resolve({});
    try { resolve(JSON.parse(text)); } catch { reject(new Error('Request body is not valid JSON')); }
  });
  req.on('error', reject);
});

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

export function createRouter(store) {
  return async function route(req, res, pathname) {
    if (req.method === 'GET' && pathname === '/api/snapshot') {
      const [transactions, categories, rules, accounts, views, imports] = await Promise.all([
        store.read('ledger'), store.read('categories'), store.read('rules'),
        store.read('accounts'), store.read('views'), store.read('imports')
      ]);
      return sendJson(res, 200, { transactions, categories, rules, accounts, views, imports });
    }
    return sendJson(res, 404, { error: 'Not found' });
  };
}

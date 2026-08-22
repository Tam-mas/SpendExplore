import { sendJson } from './http.js';
import { createImportRoutes } from './routes/import.js';

/**
 * Thin dispatcher: GET /api/snapshot, then whatever createImportRoutes
 * handles (preview/commit/rollback), then a generic 404. Route-specific
 * logic lives in server/routes/*.js — this file only decides which handler
 * a request belongs to.
 */
export function createRouter(store) {
  const importRoutes = createImportRoutes(store);

  return async function route(req, res, pathname) {
    if (req.method === 'GET' && pathname === '/api/snapshot') {
      const [transactions, categories, rules, accounts, views, imports] = await Promise.all([
        store.read('ledger'), store.read('categories'), store.read('rules'),
        store.read('accounts'), store.read('views'), store.read('imports')
      ]);
      return sendJson(res, 200, { transactions, categories, rules, accounts, views, imports });
    }

    // handleImportRoute returns `false` synchronously when the request
    // isn't one of its routes, so a non-match falls through without ever
    // awaiting a Promise.
    const handled = importRoutes(req, res, pathname);
    if (handled !== false) return await handled;

    return sendJson(res, 404, { error: 'Not found' });
  };
}

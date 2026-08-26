import { sendJson } from './http.js';
import { createImportRoutes } from './routes/import.js';
import { createTransactionRoutes } from './routes/transactions.js';
import { createBudgetRoutes } from './routes/budgets.js';
import { createRecurringRoutes } from './routes/recurring.js';
import { createSettingsRoutes } from './routes/settings.js';
import { createMutationGate } from './mutation-gate.js';

/**
 * Thin dispatcher: GET /api/snapshot, then whatever createImportRoutes or
 * createTransactionRoutes handles, then a generic 404. Route-specific logic
 * lives in server/routes/*.js — this file only decides which handler a
 * request belongs to.
 *
 * One mutation gate is created here and handed to BOTH route modules.
 * Import commit/rollback and transaction PATCH all do a read-modify-write
 * against the shared 'ledger' collection, so a gate owned by only one
 * module can't stop it from racing a mutating handler in the other —
 * see server/mutation-gate.js for the full reasoning.
 */
export function createRouter(store) {
  const gate = createMutationGate();
  const importRoutes = createImportRoutes(store, gate);
  const transactionRoutes = createTransactionRoutes(store, gate);
  const budgetRoutes = createBudgetRoutes(store, gate);
  const recurringRoutes = createRecurringRoutes(store, gate);
  const settingsRoutes = createSettingsRoutes(store, gate);

  return async function route(req, res, pathname) {
    if (req.method === 'GET' && pathname === '/api/snapshot') {
      const [transactions, categories, rules, accounts, views, imports, budgets, recurring] = await Promise.all([
        store.read('ledger'), store.read('categories'), store.read('rules'),
        store.read('accounts'), store.read('views'), store.read('imports'),
        store.read('budgets'), store.read('recurring')
      ]);
      return sendJson(res, 200, { transactions, categories, rules, accounts, views, imports, budgets, recurring });
    }

    // Each route handler returns `false` synchronously when the request
    // isn't one of its routes, so a non-match falls through without ever
    // awaiting a Promise.
    for (const handler of [importRoutes, transactionRoutes, budgetRoutes, recurringRoutes, settingsRoutes]) {
      const handled = handler(req, res, pathname);
      if (handled !== false) return await handled;
    }

    return sendJson(res, 404, { error: 'Not found' });
  };
}

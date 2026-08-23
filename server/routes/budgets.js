import { randomUUID } from 'node:crypto';
import { sendJson, readBody } from '../http.js';
import { currentMonthKey } from '../../lib/budgets.js';

function validateBudgetBody(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Request body must be an object' };
  }
  if (typeof body.categoryId !== 'string' || body.categoryId === '') {
    return { error: 'categoryId is required' };
  }
  if (typeof body.amount !== 'number' || !Number.isFinite(body.amount) || body.amount < 0) {
    return { error: 'amount must be a non-negative number' };
  }
  return { body };
}

/**
 * POST /api/budgets — appends a new budget entry. Never overwrites a prior
 * entry: the append-only history is what lets a past month keep whatever
 * allocation was actually in effect for it, even after a later edit (see
 * docs/superpowers/specs/2026-08-23-envelope-budgets-design.md). Queued
 * behind `serialized`, the same shared mutation gate every other write in
 * this app uses, so a budget write can never race an import commit or a
 * transaction PATCH into a lost update.
 *
 * Returns a router function `(req, res, pathname) => boolean | Promise`,
 * matching the same fall-through contract as the other route modules.
 */
export function createBudgetRoutes(store, serialized) {
  return function handleBudgetRoute(req, res, pathname) {
    if (req.method === 'POST' && pathname === '/api/budgets') {
      return serialized(async () => {
        const raw = await readBody(req);
        const validated = validateBudgetBody(raw);
        if (validated.error) return sendJson(res, 400, { error: validated.error });
        const { categoryId, amount } = validated.body;

        const { categories } = await store.read('categories');
        if (!categories.some((c) => c.id === categoryId)) {
          return sendJson(res, 400, { error: `Unknown category: ${categoryId}` });
        }

        const budgets = await store.read('budgets');
        const entry = { id: randomUUID(), categoryId, amount, effectiveFrom: currentMonthKey() };
        const next = [...budgets, entry];

        await store.backup();
        await store.write('budgets', next);
        return sendJson(res, 200, { budgets: next });
      });
    }
    return false;
  };
}

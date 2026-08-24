import { randomUUID } from 'node:crypto';
import { sendJson, readBody } from '../http.js';
import { currentMonthKey } from '../../lib/budgets.js';
import { NON_ASSIGNABLE } from '../../lib/review.js';

function validateBudgetBody(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Request body must be an object' };
  }
  const hasCategoryId = typeof body.categoryId === 'string' && body.categoryId !== '';
  const hasGroupId = typeof body.groupId === 'string' && body.groupId !== '';
  if (hasCategoryId === hasGroupId) { // both set, or neither
    return { error: 'Exactly one of categoryId or groupId is required' };
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
  // readBody() waits on the client to finish sending its request body — a
  // slow or stalled connection can leave that wait pending indefinitely. It
  // (and the shape validation that needs no store access) must finish
  // BEFORE the request enters `serialized`, or a stalled client wedges the
  // one shared mutation gate every write route queues behind, blocking
  // every other write in the app until that connection times out.
  async function handleCreate(req, res) {
    const validated = validateBudgetBody(await readBody(req));
    if (validated.error) return sendJson(res, 400, { error: validated.error });
    const { categoryId, groupId, amount } = validated.body;

    if (categoryId && NON_ASSIGNABLE.has(categoryId)) {
      return sendJson(res, 400, { error: `${categoryId} cannot be budgeted` });
    }

    return serialized(async () => {
      const { categories, groups } = await store.read('categories');
      if (categoryId && !categories.some((c) => c.id === categoryId)) {
        return sendJson(res, 400, { error: `Unknown category: ${categoryId}` });
      }
      if (groupId) {
        if (!groups.some((g) => g.id === groupId)) {
          return sendJson(res, 400, { error: `Unknown group: ${groupId}` });
        }
        // A group made up entirely of non-assignable categories (the seed
        // "other" group, holding only income/uncategorised) would hit the
        // same negative-spend bug budgeting income/uncategorised directly
        // does — reject it the same way.
        const hasAssignableCategory = categories.some((c) => c.groupId === groupId && !NON_ASSIGNABLE.has(c.id));
        if (!hasAssignableCategory) {
          return sendJson(res, 400, { error: `${groupId} has no assignable categories to budget` });
        }
      }

      const budgets = await store.read('budgets');
      const entry = {
        id: randomUUID(),
        categoryId: categoryId ?? null,
        groupId: groupId ?? null,
        amount,
        effectiveFrom: currentMonthKey()
      };
      const next = [...budgets, entry];

      await store.backup();
      await store.write('budgets', next);
      return sendJson(res, 200, { budgets: next });
    });
  }

  return function handleBudgetRoute(req, res, pathname) {
    if (req.method === 'POST' && pathname === '/api/budgets') {
      return handleCreate(req, res);
    }
    return false;
  };
}

import { sendJson, readBody } from '../http.js';

const TXN_ID_RE = /^\/api\/transactions\/([a-f0-9]{16})$/;

/**
 * Every field is optional (a PATCH may touch just one of them), but any
 * field that IS present must be the right shape — never left to throw
 * further down where a bad value would surface as a confusing 500. The
 * categoryId/group existence checks that need store data live in the
 * caller, since this only validates shape.
 */
function validatePatchShape(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Request body must be an object' };
  }
  if (body.categoryId !== undefined && typeof body.categoryId !== 'string') {
    return { error: 'categoryId must be a string' };
  }
  if (body.excluded !== undefined && typeof body.excluded !== 'boolean') {
    return { error: 'excluded must be a boolean' };
  }
  if (body.note !== undefined && typeof body.note !== 'string') {
    return { error: 'note must be a string' };
  }
  if (body.applyToPast !== undefined && typeof body.applyToPast !== 'boolean') {
    return { error: 'applyToPast must be a boolean' };
  }
  if (body.rememberRule !== undefined && typeof body.rememberRule !== 'boolean') {
    return { error: 'rememberRule must be a boolean' };
  }
  return { body };
}

function validateCategoryBody(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Request body must be an object' };
  }
  if (typeof body.id !== 'string' || body.id === '') return { error: 'A category needs a non-empty id' };
  if (typeof body.label !== 'string' || body.label === '') return { error: 'A category needs a non-empty label' };
  if (typeof body.groupId !== 'string' || body.groupId === '') return { error: 'A category needs a non-empty groupId' };
  return { body };
}

/**
 * Transaction editing and rule learning: PATCH /api/transactions/:id and
 * POST /api/categories. Both are read-modify-write against shared
 * collections (ledger, categories, rules) spanning several `await` points,
 * so both queue behind `serialized` — the SAME gate server/routes/import.js
 * uses for commit/rollback, passed in from server/routes.js rather than
 * built here, so a PATCH can never race an import commit (or another
 * PATCH, or another category POST) into a lost update. See
 * server/mutation-gate.js.
 *
 * Returns a router function `(req, res, pathname) => boolean | Promise`
 * that returns `false` (synchronously) when the request isn't for this
 * router, matching the same fall-through contract as createImportRoutes.
 */
export function createTransactionRoutes(store, serialized) {
  async function handlePatch(req, res, id) {
    const raw = await readBody(req);
    const shapeCheck = validatePatchShape(raw);
    if (shapeCheck.error) return sendJson(res, 400, { error: shapeCheck.error });
    const body = shapeCheck.body;

    const ledger = await store.read('ledger');
    const index = ledger.findIndex((t) => t.id === id);
    if (index === -1) return sendJson(res, 404, { error: 'Transaction not found' });

    if (body.categoryId !== undefined) {
      const { categories } = await store.read('categories');
      const validIds = new Set(categories.map((c) => c.id));
      if (!validIds.has(body.categoryId)) {
        return sendJson(res, 400, { error: `Unknown category: ${body.categoryId}` });
      }
    }

    const updated = { ...ledger[index] };
    if (body.categoryId !== undefined) {
      updated.categoryId = body.categoryId;
      updated.categorySource = 'manual';
    }
    if (body.excluded !== undefined) updated.excluded = Boolean(body.excluded);
    if (body.note !== undefined) updated.note = body.note === '' ? null : body.note;

    const next = [...ledger];
    next[index] = updated;

    let updatedPast = 0;
    if (body.applyToPast === true && body.categoryId !== undefined) {
      const merchant = updated.merchant;
      for (let i = 0; i < next.length; i++) {
        if (i === index) continue;
        const t = next[i];
        // Never let a bulk apply argue with a category the user already
        // set by hand — on this transaction (skipped above by `i ===
        // index`) or on any other row for the same merchant.
        if (t.merchant !== merchant || t.categorySource === 'manual') continue;
        next[i] = { ...t, categoryId: body.categoryId, categorySource: 'manual' };
        updatedPast++;
      }
    }

    // Back up before rewriting the ledger, same discipline as the import
    // path: applyToPast can rewrite every past row for a merchant in one
    // request, which is exactly the kind of bulk rewrite of saved history
    // a backup exists to make recoverable.
    await store.backup();
    await store.write('ledger', next);

    let ruleAdded = false;
    if (body.rememberRule === true && body.categoryId !== undefined) {
      const value = String(updated.merchant).toLowerCase();
      const rules = await store.read('rules');
      // Replace any existing exact rule for this merchant rather than
      // accumulating duplicates — re-correcting the same merchant should
      // leave exactly one exact rule for it, not a growing pile where only
      // the first (now-stale) one is ever actually consulted.
      const without = rules.filter((r) => !(r.match === 'exact' && r.value === value));
      await store.write('rules', [
        { match: 'exact', value, categoryId: body.categoryId },
        ...without
      ]);
      ruleAdded = true;
    }

    return sendJson(res, 200, { transaction: updated, updatedPast, ruleAdded });
  }

  async function handleCreateCategory(req, res) {
    const raw = await readBody(req);
    const validated = validateCategoryBody(raw);
    if (validated.error) return sendJson(res, 400, { error: validated.error });
    const body = validated.body;

    const data = await store.read('categories');
    if (!data.groups.some((g) => g.id === body.groupId)) {
      return sendJson(res, 400, { error: `Unknown group: ${body.groupId}` });
    }
    if (data.categories.some((c) => c.id === body.id)) {
      return sendJson(res, 400, { error: `Category already exists: ${body.id}` });
    }

    const next = {
      ...data,
      categories: [...data.categories, { id: body.id, label: body.label, groupId: body.groupId }]
    };
    await store.write('categories', next);
    return sendJson(res, 200, { categories: next.categories });
  }

  return function handleTransactionRoute(req, res, pathname) {
    const txnMatch = pathname.match(TXN_ID_RE);
    if (req.method === 'PATCH' && txnMatch) {
      return serialized(() => handlePatch(req, res, txnMatch[1]));
    }
    if (req.method === 'POST' && pathname === '/api/categories') {
      return serialized(() => handleCreateCategory(req, res));
    }
    return false;
  };
}

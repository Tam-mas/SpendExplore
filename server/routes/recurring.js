import { sendJson, readBody } from '../http.js';
import { OVERRIDE_DECISIONS } from '../../lib/recurring.js';

const MAX_MERCHANT_LENGTH = 200;

function validateOverrideBody(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Request body must be an object' };
  }
  const { merchant, decision } = body;
  if (typeof merchant !== 'string' || merchant === '') {
    return { error: 'merchant is required' };
  }
  // Merchant names come from bank CSVs. Cap the length so a malformed file
  // cannot append an unbounded string to a file we then read on every request.
  if (merchant.length > MAX_MERCHANT_LENGTH) {
    return { error: `merchant must be ${MAX_MERCHANT_LENGTH} characters or fewer` };
  }
  if (!OVERRIDE_DECISIONS.includes(decision)) {
    return { error: `decision must be one of: ${OVERRIDE_DECISIONS.join(', ')}` };
  }
  return { body: { merchant, decision } };
}

/**
 * POST /api/recurring/override — record (or clear) the user's decision about
 * one merchant. Replaces any prior decision for that merchant rather than
 * appending, because unlike budgets there is no history worth keeping: only
 * the current opinion matters.
 *
 * Returns a router function `(req, res, pathname) => boolean | Promise`,
 * matching the same fall-through contract as the other route modules.
 */
export function createRecurringRoutes(store, serialized) {
  // readBody() and shape validation run BEFORE entering `serialized` — a
  // stalled connection inside the one shared mutation gate would wedge every
  // other write in the app. Same reasoning as server/routes/budgets.js.
  async function handleOverride(req, res) {
    const validated = validateOverrideBody(await readBody(req));
    if (validated.error) return sendJson(res, 400, { error: validated.error });
    const { merchant, decision } = validated.body;

    return serialized(async () => {
      const current = await store.read('recurring');
      const without = current.filter((entry) => entry.merchant !== merchant);
      const next = decision === 'auto' ? without : [...without, { merchant, decision }];

      await store.backup();
      await store.write('recurring', next);
      return sendJson(res, 200, { recurring: next });
    });
  }

  return function handleRecurringRoute(req, res, pathname) {
    if (req.method === 'POST' && pathname === '/api/recurring/override') {
      return handleOverride(req, res);
    }
    return false;
  };
}

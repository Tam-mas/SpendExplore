import { sendJson, readBody } from '../http.js';

const ACCOUNT_ID_RE = /^\/api\/accounts\/([^/]+)$/;
const MAX_LABEL_LENGTH = 60;      // matches server/routes/import.js's MAX_ACCOUNT_ID_LENGTH
const MAX_PERSON_LENGTH = 40;
const CARD_SUFFIX_RE = /^\d{4}$/; // matches lib/merchant-normalise.js's extractCardSuffix output

function validateSettingsPatchBody(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Request body must be an object' };
  }

  let label;
  if (body.label !== undefined) {
    if (typeof body.label !== 'string') return { error: 'label must be a string' };
    label = body.label.trim();
    if (label === '') return { error: 'label cannot be empty' };
    if (label.length > MAX_LABEL_LENGTH) return { error: `label must be ${MAX_LABEL_LENGTH} characters or fewer` };
  }

  let cardOwners;
  if (body.cardOwners !== undefined) {
    // A plain object, never an array — Array.isArray must be checked first,
    // since an array also satisfies `typeof === 'object'`.
    if (body.cardOwners === null || typeof body.cardOwners !== 'object' || Array.isArray(body.cardOwners)) {
      return { error: 'cardOwners must be an object' };
    }
    cardOwners = {};
    for (const [suffix, person] of Object.entries(body.cardOwners)) {
      if (!CARD_SUFFIX_RE.test(suffix)) {
        return { error: `cardOwners keys must be a 4-digit card suffix, got "${suffix}"` };
      }
      if (typeof person !== 'string') return { error: `cardOwners.${suffix} must be a string` };
      const trimmed = person.trim();
      if (trimmed === '') return { error: `cardOwners.${suffix} cannot be empty` };
      if (trimmed.length > MAX_PERSON_LENGTH) {
        return { error: `cardOwners.${suffix} must be ${MAX_PERSON_LENGTH} characters or fewer` };
      }
      cardOwners[suffix] = trimmed;
    }
  }

  return { body: { label, cardOwners } };
}

/**
 * PATCH /api/accounts/:id — rename an account and/or set which person each
 * of its card suffixes belongs to.
 *
 * `cardOwners` is a full replace, not a merge: the client always sends its
 * whole locally-edited map, so there is no partial-update ambiguity to
 * reason about (contrast budgets.json's append-only history, which exists
 * for a reason that doesn't apply here — there is no "what was true at the
 * time" question for a card-to-person mapping, only "what is true now").
 *
 * Returns a router function `(req, res, pathname) => boolean | Promise`,
 * matching the same fall-through contract as the other route modules.
 */
export function createSettingsRoutes(store, serialized) {
  // readBody() and shape validation run BEFORE `serialized` — see
  // server/routes/budgets.js's handleCreate for why a route that awaits the
  // client's body inside the shared mutation gate can wedge every other
  // write in the app behind a stalled connection.
  async function handlePatch(req, res, id) {
    const validated = validateSettingsPatchBody(await readBody(req));
    if (validated.error) return sendJson(res, 400, { error: validated.error });
    const { label, cardOwners } = validated.body;

    return serialized(async () => {
      const accounts = await store.read('accounts');
      const index = accounts.findIndex((a) => a.id === id);
      if (index === -1) return sendJson(res, 404, { error: `Unknown account: ${id}` });

      if (label === undefined && cardOwners === undefined) {
        return sendJson(res, 200, { accounts });
      }

      const next = accounts.map((account, i) => {
        if (i !== index) return account;
        const updated = { ...account };
        if (label !== undefined) updated.label = label;
        if (cardOwners !== undefined) updated.cardOwners = cardOwners;
        return updated;
      });

      await store.backup();
      await store.write('accounts', next);
      return sendJson(res, 200, { accounts: next });
    });
  }

  return function handleSettingsRoute(req, res, pathname) {
    const match = pathname.match(ACCOUNT_ID_RE);
    if (req.method === 'PATCH' && match) {
      return handlePatch(req, res, decodeURIComponent(match[1]));
    }
    return false;
  };
}

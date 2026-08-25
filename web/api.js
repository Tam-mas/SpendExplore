const request = async (path, options) => {
  const res = await fetch(path, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed: ${res.status}`);
  return body;
};

const postJson = (path, payload) =>
  request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });

export const getSnapshot    = () => request('/api/snapshot');
export const previewImport  = (files) => postJson('/api/import/preview', { files });
export const commitImport   = (files) => postJson('/api/import/commit', { files });

export const patchTransaction = (id, payload) =>
  request(`/api/transactions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });

export const bulkCategorise = (payload) => postJson('/api/transactions/bulk', payload);
export const createCategory  = (payload) => postJson('/api/categories', payload);
// `target` is `{ categoryId }` or `{ groupId }` — exactly one of the two.
export const postBudget      = (target, amount) => postJson('/api/budgets', { ...target, amount });

export const postRecurringOverride = (merchant, decision) =>
  postJson('/api/recurring/override', { merchant, decision });

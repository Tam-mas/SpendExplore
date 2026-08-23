const NON_ASSIGNABLE = new Set(['uncategorised', 'income']);

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Turn a snapshot into a merchant-grouped work queue.
 *
 * Grouping by merchant is the point: three coffees from the same shop are one
 * decision, not three. Biggest absolute spend leads, so the decisions that
 * move the totals most come first.
 */
export function buildQueue(snapshot) {
  const transactions = snapshot?.transactions ?? [];
  const unknown = transactions.filter((t) => t.categorySource === 'unknown' && !t.excluded);

  const byMerchant = new Map();
  for (const txn of unknown) {
    let item = byMerchant.get(txn.merchant);
    if (!item) {
      item = { merchant: txn.merchant, ids: [], count: 0, total: 0, dates: [], sampleDescription: '' };
      byMerchant.set(txn.merchant, item);
    }
    item.ids.push(txn.id);
    item.count += 1;
    item.total += txn.amount;
    item.dates.push(txn.date);
    if (!item.sampleDescription) item.sampleDescription = txn.rawDescription ?? '';
  }

  const items = [...byMerchant.values()]
    .map((item) => {
      const dates = [...item.dates].sort();
      return {
        merchant: item.merchant,
        ids: item.ids,
        count: item.count,
        total: round2(item.total),
        dateFrom: dates[0] ?? null,
        dateTo: dates[dates.length - 1] ?? null,
        sampleDescription: item.sampleDescription,
        suggestions: suggestCategories(item.merchant, snapshot)
      };
    })
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));

  return { items, totalRows: unknown.length, totalMerchants: items.length };
}

/**
 * A queue-item-shaped view of ONE merchant, whether it is still pending or
 * was already decided. `buildQueue` only ever lists pending merchants —
 * this is what lets the Review UI page back to one that has been resolved
 * and show what it is currently filed as, so a decision can be corrected.
 */
export function itemForMerchant(snapshot, merchant) {
  const transactions = (snapshot?.transactions ?? []).filter((t) => t.merchant === merchant && !t.excluded);
  if (!transactions.length) return null;

  const dates = transactions.map((t) => t.date).sort();
  const isPending = transactions.some((t) => t.categorySource === 'unknown');

  return {
    merchant,
    ids: transactions.map((t) => t.id),
    count: transactions.length,
    total: round2(transactions.reduce((a, t) => a + t.amount, 0)),
    dateFrom: dates[0] ?? null,
    dateTo: dates[dates.length - 1] ?? null,
    sampleDescription: transactions[0].rawDescription ?? '',
    suggestions: suggestCategories(merchant, snapshot),
    isPending,
    currentCategoryId: isPending ? null : transactions[0].categoryId
  };
}

/**
 * Rank category ids for the number keys.
 *
 * Categories the user has already chosen BY HAND lead — those are the ones
 * they reach for. Then whatever else the ledger already uses, by frequency.
 * Then the rest of the taxonomy, so every category stays reachable.
 */
export function suggestCategories(merchant, snapshot, limit = 9) {
  const transactions = snapshot?.transactions ?? [];
  const all = (snapshot?.categories?.categories ?? [])
    .map((c) => c.id)
    .filter((id) => !NON_ASSIGNABLE.has(id));

  const tally = (predicate) => {
    const counts = new Map();
    for (const txn of transactions) {
      if (!predicate(txn)) continue;
      if (NON_ASSIGNABLE.has(txn.categoryId)) continue;
      counts.set(txn.categoryId, (counts.get(txn.categoryId) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  };

  const handPicked = tally((t) => t.categorySource === 'manual' || t.categorySource === 'bulk');
  const everUsed = tally(() => true);

  const ordered = [];
  for (const id of [...handPicked, ...everUsed, ...all]) {
    if (!ordered.includes(id) && all.includes(id)) ordered.push(id);
  }
  return ordered.slice(0, limit);
}

/**
 * A prompt the user can paste into a Claude conversation.
 *
 * Deliberately carries ONLY merchant names — no amounts, no dates, no account
 * details. The user is pasting this into a chat window, so it should reveal as
 * little about their finances as it possibly can while still being useful.
 */
export function promptForClaude(queue, snapshot) {
  const categories = (snapshot?.categories?.categories ?? []).filter((c) => !NON_ASSIGNABLE.has(c.id));
  const groups = new Map((snapshot?.categories?.groups ?? []).map((g) => [g.id, g.label]));

  const categoryList = categories
    .map((c) => `  ${c.id}  —  ${c.label} (${groups.get(c.groupId) ?? c.groupId})`)
    .join('\n');

  const merchantList = queue.items.map((i) => `  ${i.merchant}`).join('\n');

  return `I have some bank transaction merchant names I need sorted into spending categories.

Merchants:
${merchantList}

Valid category ids — use these exactly:
${categoryList}

Reply with ONLY a JSON array, no commentary, in exactly this shape:

[
  { "merchant": "Example Merchant", "categoryId": "groceries" }
]

Include every merchant listed. If you genuinely cannot tell what a merchant is, omit it rather than guessing.`;
}

/** Pull a JSON array out of a reply that may be wrapped in prose or a code fence. */
function extractJsonArray(text) {
  const trimmed = String(text ?? '').trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1].trim() : trimmed;
  const start = candidate.indexOf('[');
  const end = candidate.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Validate a pasted reply before any of it reaches the ledger.
 *
 * Every categoryId is checked against the real taxonomy — a hallucinated
 * category is reported, never written. Bad entries are skipped individually so
 * one mistake does not throw away the whole batch.
 */
export function parseClaudeResponse(text, snapshot) {
  const valid = new Set((snapshot?.categories?.categories ?? []).map((c) => c.id));
  const parsed = extractJsonArray(text);

  if (parsed === null) {
    return { assignments: [], errors: ['Could not find a JSON array in that text. Paste just the JSON array Claude replied with.'] };
  }
  if (!Array.isArray(parsed)) {
    return { assignments: [], errors: ['That JSON is not an array. Expected a list of { "merchant", "categoryId" } objects.'] };
  }

  const assignments = [];
  const errors = [];
  for (const entry of parsed) {
    if (!entry || typeof entry.merchant !== 'string' || typeof entry.categoryId !== 'string') {
      errors.push(`Skipped an entry missing "merchant" or "categoryId": ${JSON.stringify(entry)}`);
      continue;
    }
    if (NON_ASSIGNABLE.has(entry.categoryId) || !valid.has(entry.categoryId)) {
      errors.push(`Skipped "${entry.merchant}" — "${entry.categoryId}" is not a category in this ledger.`);
      continue;
    }
    assignments.push({ merchant: entry.merchant, categoryId: entry.categoryId });
  }
  return { assignments, errors };
}

const money = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(n).toFixed(2);

// Category and group labels are user-editable (POST /api/categories accepts
// an arbitrary label string), so they are untrusted the same way a bank
// CSV's merchant text is — escape before interpolating into innerHTML.
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

/**
 * Temporary aggregation for Plan 1. Plan 2 replaces this with the real
 * query engine; nothing outside this file depends on it.
 *
 * Pulled out as a pure function (snapshot in, plain data out) so it can be
 * unit-tested against a hand-built snapshot without touching the DOM.
 */
export function aggregateOverview(snapshot) {
  const { transactions, categories } = snapshot;
  const spend = transactions.filter((t) => !t.excluded && t.amount < 0 && t.categoryId !== 'income');

  if (!spend.length) return null;

  const catById = new Map(categories.categories.map((c) => [c.id, c]));
  const groupById = new Map(categories.groups.map((g) => [g.id, g]));

  const byCategory = new Map();
  for (const t of spend) {
    const entry = byCategory.get(t.categoryId) ?? { total: 0, count: 0 };
    entry.total += t.amount;
    entry.count += 1;
    byCategory.set(t.categoryId, entry);
  }

  const byGroup = new Map();
  for (const [categoryId, entry] of byCategory) {
    const groupId = catById.get(categoryId)?.groupId ?? 'other';
    const g = byGroup.get(groupId) ?? { total: 0, count: 0, categories: [] };
    g.total += entry.total;
    g.count += entry.count;
    g.categories.push({ categoryId, ...entry });
    byGroup.set(groupId, g);
  }

  const total = spend.reduce((a, t) => a + t.amount, 0);
  const needsReview = transactions.filter((t) => t.categorySource === 'unknown').length;
  const largest = Math.min(...spend.map((t) => t.amount));
  const groups = [...byGroup.entries()]
    .sort((a, b) => a[1].total - b[1].total)
    .map(([groupId, g]) => ({
      groupId,
      label: groupById.get(groupId)?.label ?? groupId,
      total: g.total,
      count: g.count,
      categories: g.categories
        .sort((a, b) => a.total - b.total)
        .map((c) => ({ ...c, label: catById.get(c.categoryId)?.label ?? c.categoryId }))
    }));
  const widest = Math.abs(groups[0]?.total ?? 1);

  return { total, count: spend.length, largest, needsReview, groups, widest };
}

export function renderOverviewView(root, snapshot) {
  const stats = aggregateOverview(snapshot);

  if (!stats) {
    root.innerHTML = '<p class="empty">No transactions yet — import a CSV to get started.</p>';
    return;
  }

  const { total, count, largest, needsReview, groups, widest } = stats;

  root.innerHTML = `
    <div class="kpis">
      <div class="kpi"><span>Total spend</span><b>${money(total)}</b></div>
      <div class="kpi"><span>Transactions</span><b>${count}</b></div>
      <div class="kpi"><span>Largest single</span><b>${money(largest)}</b></div>
      <div class="kpi"><span>Needs review</span><b class="${needsReview ? 'warn' : ''}">${needsReview}</b></div>
    </div>
    <table>
      <thead>
        <tr><th>Category</th><th class="num">Spend</th><th class="num">Txns</th><th style="width:34%"></th></tr>
      </thead>
      <tbody>
        ${groups.map((g) => `
          <tr class="group-row">
            <td>${escapeHtml(g.label)}</td>
            <td class="num">${money(g.total)}</td>
            <td class="num">${g.count}</td>
            <td><div class="bar" style="width:${(Math.abs(g.total) / widest * 100).toFixed(1)}%"></div></td>
          </tr>
          ${g.categories.map((c) => `
            <tr class="cat-row">
              <td>${escapeHtml(c.label)}</td>
              <td class="num">${money(c.total)}</td>
              <td class="num">${c.count}</td>
              <td></td>
            </tr>`).join('')}
        `).join('')}
      </tbody>
    </table>
  `;
}

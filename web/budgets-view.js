import { escapeHtml, formatMoney } from './charts/scale.js';
import { allBudgetStatuses, currentMonthKey } from '../lib/budgets.js';
import { transactionsForSlice } from '../lib/query/slice-transactions.js';
import { renderDrilldown } from './drilldown-panel.js';
import { postBudget, getSnapshot, patchTransaction } from './api.js';

const STATUS_LABELS = {
  'on-track': 'On track',
  covered: '↻ Covered by rollover',
  over: '⚠ Over'
};

const assignableCategories = (snapshot) =>
  (snapshot?.categories?.categories ?? []).filter((c) => c.id !== 'income' && c.id !== 'uncategorised');

/**
 * Pure render of the Budgets tab: every assignable category, grouped, each
 * showing this month's allocation vs. spend, its three-state status, and
 * the running envelope balance ("Available"). A category with no budget
 * history renders an "Add budget" prompt instead. `state.editing` is the
 * one category currently showing an inline amount input in place of its
 * normal row.
 */
export function renderBudgets(snapshot, state = {}) {
  const month = state.month ?? currentMonthKey();
  const editing = state.editing ?? null;

  const categories = assignableCategories(snapshot);
  if (!categories.length) return '<p class="empty">No categories yet.</p>';

  const groups = snapshot?.categories?.groups ?? [];
  const groupLabel = new Map(groups.map((g) => [g.id, g.label]));
  const statusByCategory = new Map(allBudgetStatuses(snapshot, month).map((s) => [s.categoryId, s]));

  const byGroup = new Map();
  for (const c of categories) {
    const groupId = c.groupId ?? 'other';
    if (!byGroup.has(groupId)) byGroup.set(groupId, []);
    byGroup.get(groupId).push(c);
  }

  const body = [...byGroup.entries()].map(([groupId, cats]) => {
    const catRows = cats.map((c) => {
      const status = statusByCategory.get(c.id);
      const budgeted = Boolean(status?.hasAllocationForMonth);
      const isEditing = editing === c.id;

      if (isEditing) {
        const current = Number(budgeted ? status.allocation : 0) || 0;
        return `
        <tr data-budget-category="${escapeHtml(c.id)}" data-budgeted="${budgeted}">
          <td>${escapeHtml(c.label)}</td>
          <td colspan="3">
            <input type="number" data-budget-input min="0" step="0.01" value="${current}">
          </td>
          <td>
            <button data-budget-action="save" data-category-id="${escapeHtml(c.id)}">Save</button>
            <button data-budget-action="cancel" data-category-id="${escapeHtml(c.id)}">Cancel</button>
          </td>
        </tr>`;
      }

      if (!budgeted) {
        return `
        <tr data-budget-category="${escapeHtml(c.id)}" data-budgeted="false">
          <td>${escapeHtml(c.label)}</td>
          <td colspan="3" class="budget-unset">No budget set</td>
          <td><button data-budget-action="add" data-category-id="${escapeHtml(c.id)}">Add budget</button></td>
        </tr>`;
      }

      return `
      <tr data-budget-category="${escapeHtml(c.id)}" data-budgeted="true">
        <td>${escapeHtml(c.label)}</td>
        <td>${formatMoney(status.allocation)} budgeted · ${formatMoney(status.spend)} spent</td>
        <td><span class="budget-status budget-status-${status.status}">${STATUS_LABELS[status.status]}</span></td>
        <td class="num">${formatMoney(status.balance)}</td>
        <td><button data-budget-action="edit" data-category-id="${escapeHtml(c.id)}">Edit</button></td>
      </tr>`;
    }).join('');

    return `
    <tr class="group-row"><td colspan="5">${escapeHtml(groupLabel.get(groupId) ?? groupId)}</td></tr>
    ${catRows}`;
  }).join('');

  return `
  <table class="viz-table budgets-table">
    <thead><tr><th>Category</th><th>This month</th><th>Status</th><th class="num">Available</th><th></th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

/** The inclusive dateFrom/dateTo for one "YYYY-MM" month. */
function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { dateFrom: `${month}-01`, dateTo: `${month}-${String(lastDay).padStart(2, '0')}` };
}

/** Wire the Budgets tab into a live DOM node. */
export function mountBudgets(root, { snapshot, drilldownRoot } = {}) {
  let current = snapshot;
  let editing = null;
  let drilldown = null; // { label, rows, refetch } | null

  const draw = () => {
    if (drilldown) {
      const bucket = drilldown.refetch();
      drilldown = bucket ? { ...drilldown, rows: bucket.rows, label: bucket.label } : null;
    }
    root.innerHTML = renderBudgets(current, { month: currentMonthKey(), editing });
    if (drilldownRoot) {
      // hideable: false — the session-only hide feature has no meaning here;
      // nothing on this tab reads the excludeIds filter.
      drilldownRoot.innerHTML = renderDrilldown(current, drilldown && { ...drilldown, hideable: false });
      drilldownRoot.classList.toggle('hidden', !drilldown);
    }
  };

  function openDrilldown(categoryId, label) {
    const month = currentMonthKey();
    const { dateFrom, dateTo } = monthRange(month);
    const doFetch = () =>
      transactionsForSlice(current, { filters: { dateFrom, dateTo }, sliceBy: 'category' }, categoryId);
    const bucket = doFetch();
    drilldown = bucket ? { label: `${label} — ${month}`, rows: bucket.rows, refetch: doFetch } : null;
  }

  async function reassign(id, categoryId) {
    await patchTransaction(id, { categoryId });
    current = await getSnapshot();
    draw();
  }

  async function refresh() {
    current = await getSnapshot();
    draw();
  }

  root.addEventListener('click', async (event) => {
    const actionEl = event.target.closest('[data-budget-action]');
    if (actionEl) {
      const action = actionEl.dataset.budgetAction;
      const categoryId = actionEl.dataset.categoryId;
      if (action === 'add' || action === 'edit') {
        editing = categoryId;
        draw();
      } else if (action === 'cancel') {
        editing = null;
        draw();
      } else if (action === 'save') {
        const input = root.querySelector('[data-budget-input]');
        const rawValue = input?.value?.trim() ?? '';
        const amount = Number(rawValue);
        if (rawValue !== '' && Number.isFinite(amount) && amount >= 0) {
          await postBudget(categoryId, amount);
          editing = null;
          await refresh();
        }
      }
      return;
    }

    const row = event.target.closest('[data-budget-category]');
    if (row && row.dataset.budgeted === 'true' && !event.target.closest('[data-budget-input]')) {
      const label = row.querySelector('td')?.textContent?.trim() ?? row.dataset.budgetCategory;
      openDrilldown(row.dataset.budgetCategory, label);
      draw();
    }
  });

  function closeDrilldown() {
    drilldown = null;
    draw();
  }

  if (drilldownRoot) {
    drilldownRoot.addEventListener('click', (event) => {
      if (event.target.closest('[data-drilldown-action="close"]')) closeDrilldown();
    });
    drilldownRoot.addEventListener('change', (event) => {
      const row = event.target.closest('[data-drilldown-id]');
      if (!row) return;
      if (event.target.dataset.drilldownAction === 'recategorise') {
        reassign(row.dataset.drilldownId, event.target.value);
      }
    });
  }

  draw();
  return { redraw: draw, refresh, closeDrilldown };
}

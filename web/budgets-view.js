import { escapeHtml, formatMoney } from './charts/scale.js';
import { allBudgetStatuses, currentMonthKey } from '../lib/budgets.js';

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
        const current = budgeted ? status.allocation : 0;
        return `
        <tr data-budget-category="${escapeHtml(c.id)}">
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
        <tr data-budget-category="${escapeHtml(c.id)}">
          <td>${escapeHtml(c.label)}</td>
          <td colspan="3" class="budget-unset">No budget set</td>
          <td><button data-budget-action="add" data-category-id="${escapeHtml(c.id)}">Add budget</button></td>
        </tr>`;
      }

      return `
      <tr data-budget-category="${escapeHtml(c.id)}">
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

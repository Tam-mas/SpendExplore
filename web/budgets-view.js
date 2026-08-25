import { escapeHtml, formatMoney } from './charts/scale.js';
import { allBudgetStatuses, allGroupBudgetStatuses, currentMonthKey } from '../lib/budgets.js';
import { transactionsForSlice } from '../lib/query/slice-transactions.js';
import { renderDrilldown } from './drilldown-panel.js';
import { postBudget, getSnapshot, patchTransaction } from './api.js';
import { guard } from './errors.js';

const STATUS_LABELS = {
  'on-track': 'On track',
  covered: '↻ Covered by rollover',
  over: '⚠ Over'
};

const assignableCategories = (snapshot) =>
  (snapshot?.categories?.categories ?? []).filter((c) => c.id !== 'income' && c.id !== 'uncategorised');

/**
 * One row of the budgets table, shared by both a category and a group —
 * they render identically (label, allocation/spend, status, available
 * balance, and an Add/Edit/Save/Cancel action), differing only in which
 * data attributes identify the target to the click handler below.
 */
function budgetRow({ scope, id, label, status, isEditing, rowClass = '' }) {
  const dataKey = scope === 'group' ? 'data-budget-group' : 'data-budget-category';
  const idAttr = scope === 'group' ? 'data-group-id' : 'data-category-id';
  const budgeted = Boolean(status?.hasAllocationForMonth);
  const cls = rowClass ? ` class="${rowClass}"` : '';

  if (isEditing) {
    const current = Number(budgeted ? status.allocation : 0) || 0;
    return `
    <tr${cls} ${dataKey}="${escapeHtml(id)}" data-budgeted="${budgeted}">
      <td>${escapeHtml(label)}</td>
      <td colspan="3">
        <input type="number" data-budget-input min="0" step="0.01" value="${current}">
      </td>
      <td>
        <button data-budget-action="save" ${idAttr}="${escapeHtml(id)}">Save</button>
        <button data-budget-action="cancel" ${idAttr}="${escapeHtml(id)}">Cancel</button>
      </td>
    </tr>`;
  }

  if (!budgeted) {
    return `
    <tr${cls} ${dataKey}="${escapeHtml(id)}" data-budgeted="false">
      <td>${escapeHtml(label)}</td>
      <td colspan="3" class="budget-unset">${scope === 'group' ? 'No group budget' : 'No budget set'}</td>
      <td><button data-budget-action="add" ${idAttr}="${escapeHtml(id)}">${scope === 'group' ? 'Add group budget' : 'Add budget'}</button></td>
    </tr>`;
  }

  return `
  <tr${cls} ${dataKey}="${escapeHtml(id)}" data-budgeted="true">
    <td>${escapeHtml(label)}</td>
    <td>${formatMoney(status.allocation)} budgeted · ${formatMoney(status.spend)} spent</td>
    <td><span class="budget-status budget-status-${status.status}">${STATUS_LABELS[status.status]}</span></td>
    <td class="num">${formatMoney(status.balance)}</td>
    <td><button data-budget-action="edit" ${idAttr}="${escapeHtml(id)}">Edit</button></td>
  </tr>`;
}

/**
 * Pure render of the Budgets tab: every assignable category, grouped under
 * an interactive group-header row that carries the GROUP's own budget —
 * independent of, and unaffected by, whatever its individual categories are
 * budgeting. Each row shows this month's allocation vs. spend, its
 * three-state status, and the running envelope balance ("Available"). A
 * target with no budget history renders an "Add budget" prompt instead.
 * `state.editing` is `{ scope: 'category'|'group', id }` for the one row
 * currently showing an inline amount input in place of its normal row, or
 * `null`.
 */
export function renderBudgets(snapshot, state = {}) {
  const month = state.month ?? currentMonthKey();
  const editing = state.editing ?? null;
  const isEditingRow = (scope, id) => editing?.scope === scope && editing.id === id;

  const categories = assignableCategories(snapshot);
  if (!categories.length) return '<p class="empty">No categories yet.</p>';

  const groups = snapshot?.categories?.groups ?? [];
  const groupLabel = new Map(groups.map((g) => [g.id, g.label]));
  const statusByCategory = new Map(allBudgetStatuses(snapshot, month).map((s) => [s.categoryId, s]));
  const statusByGroup = new Map(allGroupBudgetStatuses(snapshot, month).map((s) => [s.groupId, s]));

  const byGroup = new Map();
  for (const c of categories) {
    const groupId = c.groupId ?? 'other';
    if (!byGroup.has(groupId)) byGroup.set(groupId, []);
    byGroup.get(groupId).push(c);
  }

  const body = [...byGroup.entries()].map(([groupId, cats]) => {
    const catRows = cats.map((c) => budgetRow({
      scope: 'category',
      id: c.id,
      label: c.label,
      status: statusByCategory.get(c.id),
      isEditing: isEditingRow('category', c.id)
    })).join('');

    const groupHeaderRow = budgetRow({
      scope: 'group',
      id: groupId,
      label: groupLabel.get(groupId) ?? groupId,
      status: statusByGroup.get(groupId),
      isEditing: isEditingRow('group', groupId),
      rowClass: 'group-row'
    });

    return groupHeaderRow + catRows;
  }).join('');

  return `
  <div class="table-scroll">
  <table class="viz-table budgets-table">
    <thead><tr><th>Category</th><th>This month</th><th>Status</th><th class="num">Available</th><th></th></tr></thead>
    <tbody>${body}</tbody>
  </table>
  </div>`;
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
  // Bumped on every reassign() call; a call only applies its getSnapshot()
  // result if it's still the most recent one when the response lands — see
  // the identical guard in overview-view.js's mountOverview().
  let reassignToken = 0;

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

  /** `scope` is 'category' or 'group' — the drill-down for a group shows
   * every transaction across all of that group's categories this month. */
  function openDrilldown(scope, id, label) {
    const month = currentMonthKey();
    const { dateFrom, dateTo } = monthRange(month);
    const doFetch = () =>
      transactionsForSlice(current, { filters: { dateFrom, dateTo }, sliceBy: scope }, id);
    const bucket = doFetch();
    drilldown = bucket ? { label: `${label} — ${month}`, rows: bucket.rows, refetch: doFetch } : null;
  }

  const reassign = guard(async (id, categoryId) => {
    const token = ++reassignToken;
    await patchTransaction(id, { categoryId });
    const snapshotResult = await getSnapshot();
    if (token !== reassignToken) return; // a newer reassign() has started since; discard this result
    current = snapshotResult;
    draw();
  });

  async function refresh() {
    current = await getSnapshot();
    draw();
  }

  root.addEventListener('click', guard(async (event) => {
    const actionEl = event.target.closest('[data-budget-action]');
    if (actionEl) {
      const action = actionEl.dataset.budgetAction;
      const categoryId = actionEl.dataset.categoryId;
      const groupId = actionEl.dataset.groupId;
      const scope = categoryId ? 'category' : 'group';
      const id = categoryId ?? groupId;
      if (action === 'add' || action === 'edit') {
        editing = { scope, id };
        draw();
      } else if (action === 'cancel') {
        editing = null;
        draw();
      } else if (action === 'save') {
        const input = root.querySelector('[data-budget-input]');
        const rawValue = input?.value?.trim() ?? '';
        const amount = Number(rawValue);
        if (rawValue !== '' && Number.isFinite(amount) && amount >= 0) {
          await postBudget(categoryId ? { categoryId } : { groupId }, amount);
          editing = null;
          await refresh();
        }
      }
      return;
    }

    const categoryRow = event.target.closest('[data-budget-category]');
    const groupRow = event.target.closest('[data-budget-group]');
    const row = categoryRow ?? groupRow;
    if (row && row.dataset.budgeted === 'true' && !event.target.closest('[data-budget-input]')) {
      const label = row.querySelector('td')?.textContent?.trim() ?? row.dataset.budgetCategory ?? row.dataset.budgetGroup;
      if (categoryRow) openDrilldown('category', row.dataset.budgetCategory, label);
      else openDrilldown('group', row.dataset.budgetGroup, label);
      draw();
    }
  }));

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

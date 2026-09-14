import { escapeHtml, formatMoney } from './charts/scale.js';

const assignableCategories = (snapshot) =>
  (snapshot?.categories?.categories ?? []).filter((c) => c.id !== 'income' && c.id !== 'uncategorised');

/**
 * Pure render of the slide-over drill-down panel: the transactions behind
 * one clicked chart mark, each with a category select (re-categorise) and a
 * session-only hide checkbox. `state` is `{ label, rows, excludedIds }` or
 * falsy for "closed" — closed renders an empty string so the caller can
 * always set `root.innerHTML = renderDrilldown(...)` unconditionally.
 */
export function renderDrilldown(snapshot, state) {
  if (!state) return '';
  const { label, rows = [], excludedIds = new Set(), hideable = true, markRecurring = false } = state;
  const categories = assignableCategories(snapshot);

  const options = (currentId) => categories
    .map((c) => `<option value="${escapeHtml(c.id)}"${c.id === currentId ? ' selected' : ''}>${escapeHtml(c.label)}</option>`)
    .join('');

  const sorted = [...rows].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const rowsHtml = sorted.map((t) => {
    const hidden = excludedIds.has(t.id);
    const hideCell = hideable
      ? `<td>
          <label class="drilldown-hide">
            <input type="checkbox" data-drilldown-action="toggle-hide" ${hidden ? 'checked' : ''}>
            Hide
          </label>
        </td>`
      : '';
    // Search results feed this from any transaction, so the "mark recurring"
    // action targets the ROW's merchant, not a merchant already known to be
    // a recurring series (unlike the Recurring tab's own click-to-drilldown).
    const markRecurringCell = markRecurring
      ? `<td><button data-drilldown-action="mark-recurring" data-drilldown-merchant="${escapeHtml(t.merchant)}">Mark recurring</button></td>`
      : '';
    return `
    <tr class="${hidden ? 'drilldown-hidden-row' : ''}" data-drilldown-id="${escapeHtml(t.id)}">
      <td>${escapeHtml(t.date)}</td>
      <td>${escapeHtml(t.merchant)}</td>
      <td class="num">${formatMoney(t.amount)}</td>
      <td><select data-drilldown-action="recategorise">${options(t.categoryId)}</select></td>
      ${hideCell}
      ${markRecurringCell}
    </tr>`;
  }).join('');

  const total = rows.filter((t) => !excludedIds.has(t.id)).reduce((a, t) => a + t.amount, 0);
  const hideNote = hideable
    ? `<p class="viz-note">Hiding a transaction removes it from the charts for this session only — it resets when you reload the page. To exclude one permanently, use the Review tab.</p>`
    : '';
  // Checked only once every row is already hidden — an empty list counts as
  // "not all hidden" (unchecked) rather than vacuously true, so opening an
  // empty slice never shows a pre-ticked control.
  const allHidden = rows.length > 0 && rows.every((t) => excludedIds.has(t.id));
  const hideHeader = hideable
    ? `<th><label class="drilldown-hide"><input type="checkbox" data-drilldown-action="toggle-hide-all" ${allHidden ? 'checked' : ''}> All</label></th>`
    : '';
  const markRecurringHeader = markRecurring ? '<th></th>' : '';

  return `
  <div class="drilldown-panel">
    <header class="drilldown-head">
      <h3>${escapeHtml(label)}</h3>
      <button data-drilldown-action="close" aria-label="Close">✕</button>
    </header>
    <p class="viz-note">${rows.length} transaction${rows.length === 1 ? '' : 's'} · ${formatMoney(total)}</p>
    ${hideNote}
    <div class="table-scroll">
    <table class="viz-table drilldown-table">
      <thead><tr><th>Date</th><th>Merchant</th><th class="num">Amount</th><th>Category</th>${hideHeader}${markRecurringHeader}</tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    </div>
  </div>`;
}

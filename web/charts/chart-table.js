import { formatMoney, escapeHtml, concentrationLine } from './scale.js';

/**
 * Table view. Always available for every panel — it is the accessible relief
 * for the palette's light-mode contrast WARN and for colour-blind readers,
 * so it must never be removed from the chart-type list.
 */
export function renderTable(result, { title = '' } = {}) {
  const rows = result.rows ?? [];
  if (!rows.length) return `<p class="viz-empty">No data for these filters</p>`;

  const body = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.label)}</td>
      <td class="num">${formatMoney(row.value)}</td>
      <td class="num">${row.count}</td>
      <td class="viz-note">${escapeHtml(concentrationLine(row.stats))}</td>
    </tr>`).join('');

  return `
  <table class="viz-table">
    <caption class="viz-caption">${escapeHtml(title)}</caption>
    <thead><tr><th scope="col">Name</th><th scope="col" class="num">Value</th><th scope="col" class="num">Txns</th><th scope="col">Shape</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

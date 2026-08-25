import { formatMeasure, escapeHtml, concentrationLine } from './scale.js';
import { formatDelta, deltaClass, hasBaseline as rowsHaveBaseline } from '../delta.js';

/**
 * Table view. Always available for every panel — it is the accessible relief
 * for the palette's light-mode contrast WARN and for colour-blind readers,
 * so it must never be removed from the chart-type list.
 *
 * That relief obligation is also why the delta appears here as text: the ghost
 * bars on the other charts encode the comparison partly by shape, and this is
 * the view that must state it in words.
 */
export function renderTable(result, { title = '' } = {}) {
  const rows = result.rows ?? [];
  if (!rows.length) return `<p class="viz-empty">No data for these filters</p>`;

  const measure = result.meta?.measure;
  const hasBaseline = rowsHaveBaseline(rows);

  const body = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.label)}</td>
      <td class="num">${formatMeasure(row.value, measure)}</td>
      ${hasBaseline ? `<td class="num ${deltaClass(row.delta)}">${escapeHtml(formatDelta(row.delta, row.deltaPct, measure))}</td>` : ''}
      <td class="num">${row.count}</td>
      <td class="viz-note">${escapeHtml(concentrationLine(row.stats))}</td>
    </tr>`).join('');

  return `
  <table class="viz-table">
    <caption class="viz-caption">${escapeHtml(title)}</caption>
    <thead><tr><th scope="col">Name</th><th scope="col" class="num">Value</th>${hasBaseline ? '<th scope="col" class="num">Δ</th>' : ''}<th scope="col" class="num">Txns</th><th scope="col">Shape</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

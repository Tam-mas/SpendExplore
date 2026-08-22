import { formatMoney, escapeHtml } from './scale.js';

const SIZE = 260;
const RADIUS = 110;
const THICKNESS = 34;
const MAX_SLICES = 7;   // never more than the validated slot count

const polar = (cx, cy, r, angle) => [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];

function arcPath(cx, cy, outer, inner, start, end) {
  const [x1, y1] = polar(cx, cy, outer, start);
  const [x2, y2] = polar(cx, cy, outer, end);
  const [x3, y3] = polar(cx, cy, inner, end);
  const [x4, y4] = polar(cx, cy, inner, start);
  const large = end - start > Math.PI ? 1 : 0;
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${outer} ${outer} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} L${x3.toFixed(2)} ${y3.toFixed(2)} A${inner} ${inner} 0 ${large} 0 ${x4.toFixed(2)} ${y4.toFixed(2)} Z`;
}

/** Fold anything past the seventh slice into a single "Other" slice. */
function capSlices(rows) {
  if (rows.length <= MAX_SLICES) return rows;
  const kept = rows.slice(0, MAX_SLICES - 1);
  const rest = rows.slice(MAX_SLICES - 1);
  const value = rest.reduce((a, r) => a + r.value, 0);
  const count = rest.reduce((a, r) => a + r.count, 0);
  return [...kept, { key: '__other__', label: `Other (${rest.length})`, value, count, total: value, stats: { txnCount: count, median: 0, largest: 0, top3Share: 0 } }];
}

/** Donut — composition. Adjacent-pairlist form, so the categorical hues are safe. */
export function renderDonut(result, { mode = 'light', colourFor, title = '' } = {}) {
  const rows = capSlices(result.rows ?? []);
  if (!rows.length) return `<p class="viz-empty">No data for these filters</p>`;

  const magnitude = rows.reduce((a, r) => a + Math.abs(r.value), 0);
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  let angle = -Math.PI / 2;

  const paths = rows.map((row) => {
    const sweep = magnitude === 0 ? 0 : (Math.abs(row.value) / magnitude) * Math.PI * 2;
    const start = angle;
    const end = angle + sweep;
    angle = end;
    const colour = colourFor ? colourFor(row) : 'currentColor';
    return `<path d="${arcPath(cx, cy, RADIUS, RADIUS - THICKNESS, start, end)}" fill="${colour}" stroke="var(--viz-surface)" stroke-width="2"><title>${escapeHtml(row.label)}: ${formatMoney(row.value)}</title></path>`;
  }).join('');

  const legend = rows.map((row) => {
    const colour = colourFor ? colourFor(row) : 'currentColor';
    return `<li><span class="viz-swatch" style="background:${colour}"></span>${escapeHtml(row.label)} <span class="viz-value">${formatMoney(row.value)}</span></li>`;
  }).join('');

  return `<svg role="img" aria-label="${escapeHtml(title)}" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">${paths}<circle class="viz-donut-hole" cx="${cx}" cy="${cy}" r="${RADIUS - THICKNESS}" fill="var(--viz-surface)"/><text x="${cx}" y="${cy + 6}" text-anchor="middle" class="viz-total">${formatMoney(result.total)}</text></svg><ul class="viz-legend">${legend}</ul>`;
}

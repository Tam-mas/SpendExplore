/** Map 0..domainMax onto 0..rangeMax. Zero domain collapses to zero, never NaN. */
export function linearScale(domainMax, rangeMax) {
  const domain = Math.abs(domainMax);
  return (value) => (domain === 0 ? 0 : (Math.abs(value) / domain) * rangeMax);
}

/** Ascending round tick values covering `max`. */
export function niceTicks(max, count = 4) {
  const magnitude = Math.abs(max);
  if (magnitude === 0) return [0];
  const rawStep = magnitude / count;
  const power = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= rawStep) ?? power * 10;
  const ticks = [];
  for (let t = 0; t <= magnitude + step; t += step) ticks.push(Math.round(t * 100) / 100);
  return ticks;
}

/** Money, grouped, always two decimals, sign leading. */
export function formatMoney(n) {
  const negative = n < 0;
  const body = Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${negative ? '-' : ''}$${body}`;
}

/** Percent with no decimals. */
export const formatPercent = (fraction) => `${Math.round(fraction * 100)}%`;

/**
 * Escape a string for interpolation into markup. Bank descriptions and
 * user-authored category labels are untrusted input.
 */
export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** The concentration sentence — the few-big vs many-small answer, in words. */
export function concentrationLine(stats) {
  if (!stats || stats.txnCount === 0) return '';
  const parts = [
    `${stats.txnCount} transaction${stats.txnCount === 1 ? '' : 's'}`,
    `median ${formatMoney(stats.median)}`,
    `largest ${formatMoney(stats.largest)}`
  ];
  if (stats.txnCount > 3) parts.push(`top 3 = ${formatPercent(stats.top3Share)} of bucket`);
  else parts.push('top 3 = all of bucket');
  return parts.join(' · ');
}

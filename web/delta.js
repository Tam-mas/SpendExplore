import { formatMeasure, escapeHtml } from './charts/scale.js';
import { BASELINE_SHORT_LABELS } from '../lib/query/periods.js';

const ARROW = { up: '▲', down: '▼', flat: '–' };

/** Sub-cent movement is noise, not a change worth an arrow. */
export function deltaDirection(delta) {
  if (delta === null || delta === undefined) return null;
  if (Math.abs(delta) < 0.005) return 'flat';
  return delta > 0 ? 'up' : 'down';
}

/**
 * "▲ 34%" — or "▲ $40.00" when there is no baseline to take a percentage of,
 * because a bucket that did not exist before has no meaningful percentage.
 */
export function formatDelta(delta, deltaPct, measure) {
  const direction = deltaDirection(delta);
  if (!direction) return '';
  if (direction === 'flat') return `${ARROW.flat} no change`;
  const body = deltaPct === null || deltaPct === undefined
    ? formatMeasure(Math.abs(delta), measure)
    : `${Math.round(Math.abs(deltaPct) * 100)}%`;
  return `${ARROW[direction]} ${body}`;
}

/** Up means MORE SPEND, so it takes the warning colour, not a "growth is good" one. */
export function deltaClass(delta) {
  const direction = deltaDirection(delta);
  return direction ? `viz-delta viz-delta-${direction}` : 'viz-delta';
}

export function deltaChip(row = {}, measure = 'sum', mode = 'off') {
  if (row.baseline === null || row.baseline === undefined) return '';
  const text = formatDelta(row.delta, row.deltaPct, measure);
  if (!text) return '';
  const suffix = BASELINE_SHORT_LABELS[mode] ? ` ${BASELINE_SHORT_LABELS[mode]}` : '';
  return `<span class="${deltaClass(row.delta)}">${escapeHtml(text + suffix)}</span>`;
}

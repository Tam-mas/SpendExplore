/**
 * Window arithmetic for period comparison. A "window" is `{ dateFrom, dateTo }`
 * of inclusive ISO dates — exactly the shape lib/query/filter.js already
 * filters on, so a shifted window drops straight into a query spec.
 *
 * All arithmetic is UTC-based, matching lib/query/group-by.js.
 */

export const BASELINE_MODES = Object.freeze(['off', 'prevPeriod', 'trailing3', 'sameLastYear']);

export const BASELINE_LABELS = Object.freeze({
  off: 'No comparison',
  prevPeriod: 'vs previous period',
  trailing3: 'vs 3-period average',
  sameLastYear: 'vs same period last year'
});

/** Compact forms for a KPI chip, where the full label does not fit. */
export const BASELINE_SHORT_LABELS = Object.freeze({
  off: '',
  prevPeriod: 'vs prev',
  trailing3: 'vs 3-per avg',
  sameLastYear: 'vs last year'
});

const pad = (n) => String(n).padStart(2, '0');
const toUTC = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromUTC = (ms) => new Date(ms).toISOString().slice(0, 10);

export const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

export function shiftMonth(key, n) {
  const [y, m] = key.split('-').map(Number);
  const index = y * 12 + (m - 1) + n;
  // Math.floor and the double-modulo both round toward negative infinity, so
  // this stays correct for keys shifted back past year zero of the ledger.
  return `${Math.floor(index / 12)}-${pad(((index % 12) + 12) % 12 + 1)}`;
}

export function monthWindow(key) {
  const [y, m] = key.split('-').map(Number);
  return { dateFrom: `${key}-01`, dateTo: `${key}-${pad(daysInMonth(y, m))}` };
}

export function isMonthAligned(window = {}) {
  const { dateFrom, dateTo } = window;
  if (!dateFrom || !dateTo) return false;
  if (dateFrom.slice(0, 7) !== dateTo.slice(0, 7)) return false;
  const [y, m] = dateFrom.split('-').map(Number);
  return dateFrom.slice(8) === '01' && Number(dateTo.slice(8)) === daysInMonth(y, m);
}

export const addDays = (iso, n) => fromUTC(toUTC(iso) + n * 86400000);

export function addYears(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const year = y + n;
  return `${year}-${pad(m)}-${pad(Math.min(d, daysInMonth(year, m)))}`;
}

/** Inclusive day count: a single-day window is 1, not 0. */
export const daySpan = (window) =>
  Math.round((toUTC(window.dateTo) - toUTC(window.dateFrom)) / 86400000) + 1;

/**
 * Shift a window `n` periods (negative goes back). A month-aligned window
 * shifts by whole calendar months, never by its own day count — otherwise
 * "one period before July" lands on 30 June–30 July rather than on June.
 */
export function shiftWindow(window, n) {
  if (isMonthAligned(window)) return monthWindow(shiftMonth(window.dateFrom.slice(0, 7), n));
  const span = daySpan(window);
  return {
    dateFrom: addDays(window.dateFrom, n * span),
    dateTo: addDays(window.dateTo, n * span)
  };
}

/**
 * The windows a baseline averages over, newest first. Empty when comparison is
 * off or when the current window is unbounded — "All time" has nothing earlier
 * to compare itself against.
 */
export function baselineWindows(window = {}, mode = 'off') {
  if (!BASELINE_MODES.includes(mode) || mode === 'off') return [];
  if (!window.dateFrom || !window.dateTo) return [];

  if (mode === 'prevPeriod') return [shiftWindow(window, -1)];
  if (mode === 'trailing3') return [1, 2, 3].map((n) => shiftWindow(window, -n));
  return [{ dateFrom: addYears(window.dateFrom, -1), dateTo: addYears(window.dateTo, -1) }];
}

import { detectRecurring, applyOverrides } from '../lib/recurring.js';
import { formatMoney, escapeHtml } from './charts/scale.js';

/**
 * Compute the recurring picture for a snapshot: detect, then fold the user's
 * own overrides over the result. Exported so the Overview's KPI tile and this
 * view agree by construction rather than by coincidence.
 */
export function recurringFor(snapshot, options = {}) {
  const detected = detectRecurring(snapshot, options);
  return applyOverrides(detected, snapshot?.recurring ?? [], snapshot, options);
}

const priceCell = (item) => {
  if (item.amountKind === 'variable') {
    return `${formatMoney(item.minAmount)} – ${formatMoney(item.maxAmount)}`;
  }
  return formatMoney(item.typicalAmount);
};

const priceChangeNote = (item) => {
  if (!item.priceChange) return '';
  const { from, to, date } = item.priceChange;
  const direction = to > from ? 'rose' : 'fell';
  return `<p class="recurring-price-change">Price ${direction} from ${formatMoney(from)} to ${formatMoney(to)} on ${escapeHtml(date)}</p>`;
};

function row(item) {
  const merchant = escapeHtml(item.merchant);
  const quiet = item.status === 'dormant'
    ? `<span class="recurring-quiet">${item.missedPeriods} missed</span>`
    : escapeHtml(item.nextExpected);

  return `
    <tr data-recurring-merchant="${merchant}">
      <td>
        ${merchant}
        ${item.confidence === 'medium' ? '<span class="recurring-confidence" title="Fewer occurrences, a skipped period, or a variable amount">likely</span>' : ''}
        ${priceChangeNote(item)}
      </td>
      <td>${escapeHtml(item.cadenceLabel)}</td>
      <td class="num">${priceCell(item)}</td>
      <td class="num">${formatMoney(item.monthlyCost)}</td>
      <td class="num">${formatMoney(item.annualCost)}</td>
      <td>${quiet}</td>
      <td><button data-recurring-action="ignore" data-recurring-merchant="${merchant}">Not recurring</button></td>
    </tr>`;
}

const table = (caption, items) => `
  <table class="recurring-table">
    <caption class="viz-caption">${escapeHtml(caption)}</caption>
    <thead>
      <tr>
        <th scope="col">Merchant</th><th scope="col">Cadence</th>
        <th scope="col" class="num">Amount</th><th scope="col" class="num">Per month</th>
        <th scope="col" class="num">Per year</th><th scope="col">Next</th><th scope="col"></th>
      </tr>
    </thead>
    <tbody>${items.map(row).join('')}</tbody>
  </table>`;

/**
 * Pure render of the Recurring tab. `today` is injected so the output is
 * deterministic under test.
 */
export function renderRecurring(snapshot, { today } = {}) {
  const { series, committedMonthly, committedAnnual } = recurringFor(snapshot, today ? { today } : {});
  if (!series.length) {
    return `<p class="empty">Nothing recurring detected yet — a charge needs to appear at least three times on a consistent cadence before it counts.</p>`;
  }

  const active = series.filter((s) => s.status === 'active');
  const dormant = series.filter((s) => s.status === 'dormant');

  return `
    <div class="kpis">
      <div class="kpi"><span>Committed monthly</span><b>${formatMoney(committedMonthly)}</b></div>
      <div class="kpi"><span>Committed yearly</span><b>${formatMoney(committedAnnual)}</b></div>
      <div class="kpi"><span>Subscriptions</span><b>${active.length} active</b></div>
    </div>
    <p class="viz-note">Committed spend is what leaves your accounts before you decide anything. Click a row to see its transactions.</p>
    ${active.length ? table('Active', active) : ''}
    ${dormant.length ? table('Gone quiet — cancelled, or a payment that failed?', dormant) : ''}`;
}

import { detectRecurring, applyOverrides } from '../lib/recurring.js';
import { formatMoney, escapeHtml } from './charts/scale.js';
import { transactionsForSlice } from '../lib/query/slice-transactions.js';
import { renderDrilldown } from './drilldown-panel.js';
import { postRecurringOverride, patchTransaction, getSnapshot } from './api.js';
import { guard } from './errors.js';

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

function row(item, nextLabel) {
  const merchant = escapeHtml(item.merchant);
  const nextCell = nextLabel === 'Missed'
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
      <td>${nextCell}</td>
      <td><button data-recurring-action="ignore" data-recurring-merchant="${merchant}">Not recurring</button></td>
    </tr>`;
}

// `nextLabel` names the last column: a dormant row shows how long it's been
// quiet, not a date it's overdue for, so it gets its own header rather than
// living under "Next" as if it were still expected.
const table = (caption, items, nextLabel = 'Next') => `
  <table class="recurring-table">
    <caption class="viz-caption">${escapeHtml(caption)}</caption>
    <thead>
      <tr>
        <th scope="col">Merchant</th><th scope="col">Cadence</th>
        <th scope="col" class="num">Amount</th><th scope="col" class="num">Per month</th>
        <th scope="col" class="num">Per year</th><th scope="col">${escapeHtml(nextLabel)}</th><th scope="col"></th>
      </tr>
    </thead>
    <tbody>${items.map((item) => row(item, nextLabel)).join('')}</tbody>
  </table>`;

/**
 * Pure render of the Recurring tab. `today` is injected so the output is
 * deterministic under test.
 *
 * The active series are split into two tables: high-confidence entries (the
 * ones summed into the "Committed monthly"/"Committed yearly" headline
 * tiles above) and medium-confidence "Possibly recurring" entries, which are
 * still detected and listed with their own subtotal but deliberately left
 * out of a number presented as a commitment — see lib/recurring.js's
 * committedTotals(). A `forced: true` override (the user explicitly marking
 * a merchant recurring) is always confidence: 'medium' by construction, so
 * it lands here too, with no special-casing needed.
 */
export function renderRecurring(snapshot, { today } = {}) {
  const {
    series, committedMonthly, committedAnnual, uncertainMonthly, uncertainAnnual
  } = recurringFor(snapshot, today ? { today } : {});
  if (!series.length) {
    return `<p class="empty">Nothing recurring detected yet — a charge needs to appear at least three times on a consistent cadence before it counts.</p>`;
  }

  const active = series.filter((s) => s.status === 'active');
  const high = active.filter((s) => s.confidence === 'high');
  const uncertain = active.filter((s) => s.confidence === 'medium');
  const dormant = series.filter((s) => s.status === 'dormant');

  return `
    <div class="kpis">
      <div class="kpi"><span>Committed monthly</span><b>${formatMoney(committedMonthly)}</b></div>
      <div class="kpi"><span>Committed yearly</span><b>${formatMoney(committedAnnual)}</b></div>
      <div class="kpi"><span>Subscriptions</span><b>${high.length} active</b></div>
    </div>
    <p class="viz-note">Committed spend is what leaves your accounts before you decide anything, counting only the confidently-detected charges above. Click a row to see its transactions.</p>
    ${high.length ? table('Active', high) : ''}
    ${uncertain.length ? `
    <p class="viz-note recurring-uncertain-note">Possibly recurring — fewer occurrences, a skipped period, or a variable amount, so these are not counted above. Subtotal: ${formatMoney(uncertainMonthly)}/month, ${formatMoney(uncertainAnnual)}/year.</p>
    ${table('Possibly recurring', uncertain)}` : ''}
    ${dormant.length ? table('Gone quiet — cancelled, or a payment that failed?', dormant, 'Missed') : ''}`;
}

/**
 * Wire the Recurring tab into a live DOM node. Mirrors mountBudgets: same
 * return shape, same drill-down reuse, and the session-hide checkbox is turned
 * off because nothing on this tab reads the session-only excludeIds filter.
 */
export function mountRecurring(root, { snapshot, drilldownRoot } = {}) {
  let current = snapshot;
  let drilldown = null;
  let reassignToken = 0;

  const drawDrilldown = () => {
    if (drilldown) {
      const bucket = drilldown.refetch();
      drilldown = bucket ? { ...drilldown, rows: bucket.rows, label: bucket.label } : null;
    }
    if (drilldownRoot) {
      drilldownRoot.innerHTML = renderDrilldown(current, drilldown && { ...drilldown, hideable: false });
      drilldownRoot.classList.toggle('hidden', !drilldown);
    }
  };

  const draw = () => {
    root.innerHTML = renderRecurring(current);
    drawDrilldown();
  };

  function openDrilldown(merchant) {
    const doFetch = () => transactionsForSlice(current, { filters: {}, sliceBy: 'merchant' }, merchant);
    const bucket = doFetch();
    drilldown = bucket ? { label: bucket.label, rows: bucket.rows, refetch: doFetch } : null;
    draw();
  }

  function closeDrilldown() {
    drilldown = null;
    draw();
  }

  const ignore = guard(async (merchant) => {
    await postRecurringOverride(merchant, 'ignored');
    current = await getSnapshot();
    draw();
  });

  // Same race guard as the Overview: discard a snapshot that arrives after a
  // newer edit has already started, or a slow response silently reverts it.
  const reassign = guard(async (id, categoryId) => {
    const token = ++reassignToken;
    await patchTransaction(id, { categoryId });
    const result = await getSnapshot();
    if (token !== reassignToken) return;
    current = result;
    draw();
  });

  const refresh = async () => {
    current = await getSnapshot();
    drilldown = null;
    draw();
  };

  draw();

  root.addEventListener('click', guard(async (event) => {
    const ignoreButton = event.target.closest('[data-recurring-action="ignore"]');
    if (ignoreButton) {
      await ignore(ignoreButton.dataset.recurringMerchant);
      return;
    }
    const row = event.target.closest('[data-recurring-merchant]');
    if (row) openDrilldown(row.dataset.recurringMerchant);
  }));

  if (drilldownRoot) {
    drilldownRoot.addEventListener('click', (event) => {
      if (event.target.closest('[data-drilldown-action="close"]')) closeDrilldown();
    });
    drilldownRoot.addEventListener('change', (event) => {
      const row = event.target.closest('[data-drilldown-id]');
      if (row && event.target.dataset.drilldownAction === 'recategorise') {
        reassign(row.dataset.drilldownId, event.target.value);
      }
    });
  }

  return { redraw: draw, refresh, closeDrilldown };
}

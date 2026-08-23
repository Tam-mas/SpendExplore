const money = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(n).toFixed(2);

// Category and group labels are user-editable (POST /api/categories accepts
// an arbitrary label string), so they are untrusted the same way a bank
// CSV's merchant text is — escape before interpolating into innerHTML.
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

/**
 * Temporary aggregation for Plan 1. Plan 2 replaces this with the real
 * query engine; nothing outside this file depends on it.
 *
 * Pulled out as a pure function (snapshot in, plain data out) so it can be
 * unit-tested against a hand-built snapshot without touching the DOM.
 */
export function aggregateOverview(snapshot) {
  const { transactions, categories } = snapshot;
  const spend = transactions.filter((t) => !t.excluded && t.amount < 0 && t.categoryId !== 'income');

  if (!spend.length) return null;

  const catById = new Map(categories.categories.map((c) => [c.id, c]));
  const groupById = new Map(categories.groups.map((g) => [g.id, g]));

  const byCategory = new Map();
  for (const t of spend) {
    const entry = byCategory.get(t.categoryId) ?? { total: 0, count: 0 };
    entry.total += t.amount;
    entry.count += 1;
    byCategory.set(t.categoryId, entry);
  }

  const byGroup = new Map();
  for (const [categoryId, entry] of byCategory) {
    const groupId = catById.get(categoryId)?.groupId ?? 'other';
    const g = byGroup.get(groupId) ?? { total: 0, count: 0, categories: [] };
    g.total += entry.total;
    g.count += entry.count;
    g.categories.push({ categoryId, ...entry });
    byGroup.set(groupId, g);
  }

  const total = spend.reduce((a, t) => a + t.amount, 0);
  const needsReview = transactions.filter((t) => t.categorySource === 'unknown').length;
  const largest = Math.min(...spend.map((t) => t.amount));
  const groups = [...byGroup.entries()]
    .sort((a, b) => a[1].total - b[1].total)
    .map(([groupId, g]) => ({
      groupId,
      label: groupById.get(groupId)?.label ?? groupId,
      total: g.total,
      count: g.count,
      categories: g.categories
        .sort((a, b) => a.total - b.total)
        .map((c) => ({ ...c, label: catById.get(c.categoryId)?.label ?? c.categoryId }))
    }));
  const widest = Math.abs(groups[0]?.total ?? 1);

  return { total, count: spend.length, largest, needsReview, groups, widest };
}

import { createPanel, mount } from './panel.js';
import { renderFilterBar, mountFilterBar, toQueryFilters, readFilterBar } from './filter-bar.js';
import { query } from '../lib/query/query.js';
import { escapeHtml as escapeHtmlFromScale, formatMoney } from './charts/scale.js';
import { transactionsForSlice } from '../lib/query/slice-transactions.js';
import { searchTransactions } from '../lib/query/search-transactions.js';
import { renderDrilldown } from './drilldown-panel.js';
import { patchTransaction, getSnapshot } from './api.js';

const STORAGE_KEY = 'spendexplore.overview.panels';

/** The panel set the Overview opens with. Saved named views are Plan 3. */
export const DEFAULT_PANELS = Object.freeze([
  { id: 'by-group', title: 'Where it went', sliceBy: 'group', measure: 'sum', chartType: 'bar' },
  { id: 'by-category', title: 'By category', sliceBy: 'category', measure: 'sum', chartType: 'bar' },
  { id: 'by-month', title: 'Over time', sliceBy: 'month', measure: 'sum', chartType: 'line' }
]);

function loadPanelConfigs() {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : null;
    return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_PANELS.map((p) => ({ ...p }));
  } catch {
    return DEFAULT_PANELS.map((p) => ({ ...p }));
  }
}

function savePanelConfigs(configs) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(configs));
  } catch { /* storage unavailable — panel state simply does not persist */ }
}

function searchBox(query = '') {
  return `
  <div class="viz-search">
    <input type="search" data-search placeholder="Search transactions (e.g. chem)" value="${escapeHtmlFromScale(query)}" aria-label="Search transactions">
  </div>`;
}

function kpiRow(snapshot, globalFilters) {
  const result = query(snapshot, { filters: globalFilters, sliceBy: 'category', measure: 'sum' });
  const needsReview = (snapshot.transactions ?? []).filter((t) => t.categorySource === 'unknown').length;
  return `
  <div class="kpis">
    <div class="kpi"><span>Total spend</span><b>${formatMoney(result.total)}</b></div>
    <div class="kpi"><span>Transactions</span><b>${result.stats.txnCount}</b></div>
    <div class="kpi"><span>Largest single</span><b>${formatMoney(result.stats.largest)}</b></div>
    <div class="kpi"><span>Needs review</span><b class="${needsReview ? 'warn' : ''}">${needsReview}</b></div>
  </div>`;
}

/**
 * Pure render of the whole Overview: KPIs, filter bar, then the panels.
 *
 * `uiFilters` is the FILTER BAR's own shape (`{ month, accountIds, people,
 * groupIds }`), not a query spec — the bar needs it to mark the active option
 * as selected. It is converted to query shape once, here, so panels and KPIs
 * both see the same thing.
 */
export function renderOverview(snapshot, uiFilters = {}, panelConfigs = DEFAULT_PANELS, extraFilters = {}, hiddenCount = 0, searchQuery = '') {
  if (!(snapshot.transactions ?? []).length) {
    return '<p class="empty">No transactions yet — import a CSV to get started.</p>';
  }
  const queryFilters = { ...toQueryFilters(uiFilters), ...extraFilters };
  const panels = panelConfigs
    .map((config) => createPanel(config).html(snapshot, queryFilters))
    .join('');
  const hiddenBanner = hiddenCount > 0
    ? `<p class="viz-note hidden-banner">${hiddenCount} transaction${hiddenCount === 1 ? '' : 's'} hidden this session · <button data-overview-action="show-all">Show all</button></p>`
    : '';

  return `
    ${kpiRow(snapshot, queryFilters)}
    ${hiddenBanner}
    ${searchBox(searchQuery)}
    ${renderFilterBar(snapshot, uiFilters)}
    ${panels}`;
}

/** Wire the Overview into a live DOM node. */
export function mountOverview(root, { snapshot, drilldownRoot } = {}) {
  let current = snapshot;
  let filters = {};
  let configs = loadPanelConfigs();
  const excludedIds = new Set();
  let drilldown = null; // { label, rows, refetch } | null
  let searchQuery = '';

  const extraFilters = () => (excludedIds.size ? { excludeIds: [...excludedIds] } : {});

  /**
   * Re-render just the slide-over panel, re-deriving its rows from `refetch`
   * every time — a filter-bar change, a panel's own slice change, or a
   * re-categorise while it's open must not leave it showing a stale slice
   * that no longer matches what the charts (or the search box) show.
   */
  const drawDrilldown = () => {
    if (drilldown) {
      const bucket = drilldown.refetch();
      drilldown = bucket ? { ...drilldown, rows: bucket.rows, label: bucket.label } : null;
    }
    if (drilldownRoot) {
      drilldownRoot.innerHTML = renderDrilldown(current, drilldown && { ...drilldown, excludedIds });
      drilldownRoot.classList.toggle('hidden', !drilldown);
    }
  };

  const draw = () => {
    root.innerHTML = renderOverview(current, filters, configs, extraFilters(), excludedIds.size, searchQuery);
    drawDrilldown();
  };

  function openDrilldown(config, key) {
    const doFetch = () => {
      const base = toQueryFilters(filters);
      const spec = { filters: { ...base, ...config.filters }, sliceBy: config.sliceBy };
      return transactionsForSlice(current, spec, key);
    };
    const bucket = doFetch();
    drilldown = bucket ? { label: bucket.label, rows: bucket.rows, refetch: doFetch } : null;
    searchQuery = '';
    draw();
  }

  function closeDrilldown() {
    drilldown = null;
    searchQuery = '';
    draw();
  }

  function toggleHidden(id) {
    if (excludedIds.has(id)) excludedIds.delete(id); else excludedIds.add(id);
    draw();
  }

  async function reassign(id, categoryId) {
    await patchTransaction(id, { categoryId });
    current = await getSnapshot();
    draw();
  }

  /**
   * Live-as-you-type search. This deliberately redraws ONLY the drill-down
   * panel, not `root` — root's markup (including the search `<input>` itself)
   * gets replaced wholesale on every `draw()`, which would recreate the input
   * and drop focus/cursor position after every keystroke.
   */
  function runSearch(term) {
    searchQuery = term;
    const trimmed = term.trim();
    if (!trimmed) {
      drilldown = null;
      drawDrilldown();
      return;
    }
    const doFetch = () => ({
      label: `Search: "${trimmed}"`,
      rows: searchTransactions(current, { filters: toQueryFilters(filters) }, trimmed)
    });
    drilldown = { ...doFetch(), refetch: doFetch };
    drawDrilldown();
  }

  const refresh = async () => {
    current = await getSnapshot();
    drilldown = null;
    searchQuery = '';
    draw();
  };

  draw();

  root.addEventListener('click', (event) => {
    if (event.target.closest('[data-overview-action="show-all"]')) {
      excludedIds.clear();
      draw();
      return;
    }
    const mark = event.target.closest('[data-slice-key]');
    if (mark) {
      const panelId = mark.closest('[data-panel-id]')?.dataset.panelId;
      const config = configs.find((c) => c.id === panelId);
      if (config) openDrilldown(config, mark.dataset.sliceKey);
      return;
    }
  });

  root.addEventListener('input', (event) => {
    if (!event.target.matches?.('[data-search]')) return;
    runSearch(event.target.value);
  });

  root.addEventListener('change', (event) => {
    const target = event.target;
    if (target?.dataset?.filter) {
      filters = readFilterBar(root);
      draw();
      return;
    }
    const control = target?.dataset?.panelControl;
    if (!control) return;

    const panelId = target.closest('[data-panel-id]')?.dataset.panelId;
    const config = configs.find((c) => c.id === panelId);
    if (!config) return;

    const panel = createPanel(config);
    if (control === 'sliceBy') panel.setSlice(target.value);
    else if (control === 'measure') panel.setMeasure(target.value);
    else if (control === 'chartType') panel.setChart(target.value);

    configs = configs.map((c) => (c.id === panelId ? { ...panel.config } : c));
    savePanelConfigs(configs);
    draw();
  });

  if (drilldownRoot) {
    drilldownRoot.addEventListener('click', (event) => {
      if (event.target.closest('[data-drilldown-action="close"]')) closeDrilldown();
    });
    drilldownRoot.addEventListener('change', (event) => {
      const row = event.target.closest('[data-drilldown-id]');
      if (!row) return;
      const id = row.dataset.drilldownId;
      const action = event.target.dataset.drilldownAction;
      if (action === 'recategorise') reassign(id, event.target.value);
      else if (action === 'toggle-hide') toggleHidden(id);
    });
  }

  return { redraw: draw, refresh };
}

export function renderOverviewView(root, snapshot) {
  const stats = aggregateOverview(snapshot);

  if (!stats) {
    root.innerHTML = '<p class="empty">No transactions yet — import a CSV to get started.</p>';
    return;
  }

  const { total, count, largest, needsReview, groups, widest } = stats;

  root.innerHTML = `
    <div class="kpis">
      <div class="kpi"><span>Total spend</span><b>${money(total)}</b></div>
      <div class="kpi"><span>Transactions</span><b>${count}</b></div>
      <div class="kpi"><span>Largest single</span><b>${money(largest)}</b></div>
      <div class="kpi"><span>Needs review</span><b class="${needsReview ? 'warn' : ''}">${needsReview}</b></div>
    </div>
    <table>
      <thead>
        <tr><th>Category</th><th class="num">Spend</th><th class="num">Txns</th><th style="width:34%"></th></tr>
      </thead>
      <tbody>
        ${groups.map((g) => `
          <tr class="group-row">
            <td>${escapeHtml(g.label)}</td>
            <td class="num">${money(g.total)}</td>
            <td class="num">${g.count}</td>
            <td><div class="bar" style="width:${(Math.abs(g.total) / widest * 100).toFixed(1)}%"></div></td>
          </tr>
          ${g.categories.map((c) => `
            <tr class="cat-row">
              <td>${escapeHtml(c.label)}</td>
              <td class="num">${money(c.total)}</td>
              <td class="num">${c.count}</td>
              <td></td>
            </tr>`).join('')}
        `).join('')}
      </tbody>
    </table>
  `;
}

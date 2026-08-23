import { query } from '../lib/query/query.js';
import { applyFilters, buildContext } from '../lib/query/filter.js';
import { SLICES, groupBy } from '../lib/query/group-by.js';
import { MEASURES } from '../lib/query/measures.js';
import { chartsFor, renderChart, defaultChartFor } from './charts/index.js';
import { colourForGroup, colourForCategory, GROUP_SLOTS } from './charts/palette.js';
import { escapeHtml, concentrationLine } from './charts/scale.js';

const SLICE_LABELS = {
  category: 'Category', group: 'Group', merchant: 'Merchant', person: 'Person',
  account: 'Account', weekday: 'Day of week', week: 'Week', month: 'Month',
  amountBand: 'Amount band'
};

const MEASURE_LABELS = {
  sum: 'Total $', count: '# Txns', avg: 'Average', median: 'Median', pctOfTotal: '% of total'
};

/**
 * A row's colour, keyed by ENTITY identity so that filtering out one bucket
 * never repaints the survivors.
 *
 * Category slices step their group's hue; group slices use the group hue
 * directly; every other slice is a single series and takes one stable hue.
 */
export function colourResolver(snapshot, sliceBy, mode = 'light') {
  const categories = snapshot?.categories?.categories ?? [];
  const groupOf = new Map(categories.map((c) => [c.id, c.groupId]));
  const siblings = new Map();
  for (const c of categories) {
    if (!siblings.has(c.groupId)) siblings.set(c.groupId, []);
    siblings.get(c.groupId).push(c.id);
  }

  if (sliceBy === 'group') return (row) => colourForGroup(row.key, mode);
  if (sliceBy === 'category') {
    return (row) => {
      const groupId = groupOf.get(row.key) ?? 'other';
      return colourForCategory(row.key, groupId, siblings.get(groupId) ?? [row.key], mode);
    };
  }
  const single = GROUP_SLOTS['food-drink'][mode] ?? GROUP_SLOTS['food-drink'].light;
  return () => single;
}

const selectFor = (name, options, current) => `
  <label class="viz-control">
    <span class="viz-control-label">${name === 'sliceBy' ? 'Slice by' : name === 'measure' ? 'Measure' : 'Chart'}</span>
    <select data-panel-control="${name}">
      ${options.map((o) => `<option value="${escapeHtml(o.value)}"${o.value === current ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
    </select>
  </label>`;

/**
 * One configurable panel: a slice, a measure, a chart type and its own filters.
 * `html()` is pure — it takes a snapshot and returns markup, so it is testable
 * without a DOM.
 */
export function createPanel(initial = {}) {
  const config = {
    id: initial.id ?? `panel-${Math.random().toString(36).slice(2, 8)}`,
    title: initial.title ?? 'Untitled panel',
    sliceBy: SLICES.includes(initial.sliceBy) ? initial.sliceBy : 'category',
    measure: MEASURES.includes(initial.measure) ? initial.measure : 'sum',
    chartType: initial.chartType ?? null,
    filters: initial.filters ?? {}
  };

  /** Keep the chart type valid whenever the slice or measure changes. */
  const repairChart = () => {
    const valid = chartsFor(config.sliceBy, config.measure).map((c) => c.id);
    if (!config.chartType || !valid.includes(config.chartType)) {
      const preferred = defaultChartFor(config.sliceBy);
      config.chartType = valid.includes(preferred) ? preferred : valid[0];
    }
    return config;
  };
  repairChart();

  const panel = {
    config,
    setSlice(value) { if (SLICES.includes(value)) config.sliceBy = value; return repairChart(); },
    setMeasure(value) { if (MEASURES.includes(value)) config.measure = value; return repairChart(); },
    setChart(value) {
      const valid = chartsFor(config.sliceBy, config.measure).map((c) => c.id);
      if (valid.includes(value)) config.chartType = value;
      return config;
    },

    html(snapshot, globalFilters = {}) {
      const spec = {
        filters: { ...globalFilters, ...config.filters },
        sliceBy: config.sliceBy,
        measure: config.measure
      };
      const result = query(snapshot, spec);
      const colourFor = colourResolver(snapshot, config.sliceBy);

      const options = { mode: 'light', colourFor, title: config.title };
      if (config.chartType === 'dots') {
        // The only chart needing raw amounts. They are derived through the SAME
        // filters as the rest of the panel, then reduced to bare {amount, key,
        // label} points — never a whole transaction record. Dots colour by the
        // transaction's OWN category regardless of the panel's chosen slice, so
        // this always resolves colour via the 'category' slice, not config.sliceBy.
        const ctx = buildContext(snapshot);
        options.points = applyFilters(snapshot.transactions ?? [], spec.filters, ctx)
          .map((t) => ({ amount: t.amount, key: t.categoryId, label: t.merchant }));
        options.colourFor = colourResolver(snapshot, 'category');
      }
      if (config.chartType === 'stacked') {
        // Stacked needs a SECOND dimension the slice-by-month/week query
        // result doesn't carry on its own: each bucket's total broken down
        // by group. Always grouped by GROUP, not category — the app's
        // categorical palette is only validated safe up to 7 colours, which
        // is exactly the group count, and colours by the transaction's own
        // group regardless of config.sliceBy for the same reason Dots does.
        const ctx = buildContext(snapshot);
        const filtered = applyFilters(snapshot.transactions ?? [], spec.filters, ctx);
        const buckets = groupBy(filtered, config.sliceBy, ctx);
        const groupOf = new Map((snapshot?.categories?.categories ?? []).map((c) => [c.id, c.groupId]));
        const groupLabels = new Map((snapshot?.categories?.groups ?? []).map((g) => [g.id, g.label]));

        const totalsByGroup = new Map();
        for (const txn of filtered) {
          const groupId = groupOf.get(txn.categoryId) ?? 'other';
          totalsByGroup.set(groupId, (totalsByGroup.get(groupId) ?? 0) + Math.abs(txn.amount));
        }
        const groupOrder = [...totalsByGroup.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g);

        options.series = groupOrder.map((groupId) => ({
          key: groupId,
          label: groupLabels.get(groupId) ?? groupId,
          values: buckets.map((bucket) =>
            bucket.rows.filter((t) => (groupOf.get(t.categoryId) ?? 'other') === groupId)
              .reduce((a, t) => a + t.amount, 0))
        }));
        options.colourFor = colourResolver(snapshot, 'group');
      }

      const chart = renderChart(config.chartType, result, options);
      const sliceOptions = SLICES.map((s) => ({ value: s, label: SLICE_LABELS[s] ?? s }));
      const measureOptions = MEASURES.map((m) => ({ value: m, label: MEASURE_LABELS[m] ?? m }));
      const chartOptions = chartsFor(config.sliceBy, config.measure).map((c) => ({ value: c.id, label: c.label }));

      return `
      <section class="viz-panel" data-panel-id="${escapeHtml(config.id)}">
        <header class="viz-panel-head">
          <h3>${escapeHtml(config.title)}</h3>
          <div class="viz-controls">
            ${selectFor('sliceBy', sliceOptions, config.sliceBy)}
            ${selectFor('measure', measureOptions, config.measure)}
            ${selectFor('chartType', chartOptions, config.chartType)}
          </div>
        </header>
        <p class="viz-note">${escapeHtml(concentrationLine(result.stats))}</p>
        <div class="viz-plot">${chart}</div>
      </section>`;
    }
  };

  return panel;
}

/**
 * Attach the panel's controls to a live DOM node. Re-renders on any change and
 * notifies the caller so panel state can be persisted.
 */
export function mount(panel, root, { snapshot, globalFilters = {}, onChange } = {}) {
  const draw = () => { root.innerHTML = panel.html(snapshot, globalFilters); };
  draw();

  root.addEventListener('change', (event) => {
    const control = event.target?.dataset?.panelControl;
    if (!control) return;
    if (control === 'sliceBy') panel.setSlice(event.target.value);
    else if (control === 'measure') panel.setMeasure(event.target.value);
    else if (control === 'chartType') panel.setChart(event.target.value);
    draw();
    onChange?.(panel.config);
  });

  return { redraw: draw };
}

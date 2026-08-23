import { escapeHtml } from './charts/scale.js';
import { JOINT } from '../lib/query/filter.js';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const monthLabel = (key) => {
  const [y, m] = key.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
};

/** Every month between the ledger's first and last transaction, newest first. */
function monthsBetween(dates) {
  if (!dates.length) return [];
  const sorted = [...dates].sort();
  const [firstY, firstM] = sorted[0].split('-').map(Number);
  const [lastY, lastM] = sorted.at(-1).split('-').map(Number);

  const out = [];
  for (let y = firstY, m = firstM; y < lastY || (y === lastY && m <= lastM); m++) {
    if (m > 12) { m = 1; y++; }
    out.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  return out.reverse();
}

/** Options for each global filter, derived from the data — never hardcoded. */
export function filterOptions(snapshot) {
  const transactions = snapshot?.transactions ?? [];
  const accounts = snapshot?.accounts ?? [];

  const owners = new Set([JOINT]);
  for (const account of accounts) {
    for (const person of Object.values(account.cardOwners ?? {})) owners.add(person);
  }

  return {
    months: monthsBetween(transactions.map((t) => t.date)).map((value) => ({ value, label: monthLabel(value) })),
    accounts: accounts.map((a) => ({ value: a.id, label: a.label ?? a.id })),
    people: [...owners].map((value) => ({ value, label: value })),
    groups: (snapshot?.categories?.groups ?? []).map((g) => ({ value: g.id, label: g.label }))
  };
}

const select = (name, label, options, current, allLabel) => `
  <label class="viz-control">
    <span class="viz-control-label">${escapeHtml(label)}</span>
    <select data-filter="${name}">
      <option value="">${escapeHtml(allLabel)}</option>
      ${options.map((o) => `<option value="${escapeHtml(o.value)}"${o.value === current ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
    </select>
  </label>`;

/**
 * The global filter bar. Its values are the `filters` half of a query spec, so
 * they compose with each panel's own filters with no special-casing.
 */
export function renderFilterBar(snapshot, filters = {}) {
  const options = filterOptions(snapshot);
  return `
  <div class="viz-filter-bar">
    ${select('month', 'Period', options.months, filters.month ?? '', 'All time')}
    ${select('accountIds', 'Account', options.accounts, (filters.accountIds ?? [])[0] ?? '', 'All accounts')}
    ${select('people', 'Person', options.people, (filters.people ?? [])[0] ?? '', 'Both of us')}
    ${select('groupIds', 'Group', options.groups, (filters.groupIds ?? [])[0] ?? '', 'All groups')}
  </div>`;
}

/** Turn a `month` selection into the dateFrom/dateTo a query spec wants. */
export function toQueryFilters(filters = {}) {
  const { month, accountIds, people, groupIds } = filters;
  const spec = {};
  if (month) {
    const [y, m] = month.split('-').map(Number);
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    spec.dateFrom = `${month}-01`;
    spec.dateTo = `${month}-${String(lastDay).padStart(2, '0')}`;
  }
  if (accountIds?.length) spec.accountIds = accountIds;
  if (people?.length) spec.people = people;
  if (groupIds?.length) spec.groupIds = groupIds;
  return spec;
}

/** Read the live filter bar back into a filters object. */
export function readFilterBar(root) {
  const value = (name) => root.querySelector(`[data-filter="${name}"]`)?.value ?? '';
  const one = (name) => (value(name) ? [value(name)] : []);
  return { month: value('month'), accountIds: one('accountIds'), people: one('people'), groupIds: one('groupIds') };
}

export function mountFilterBar(root, { snapshot, filters = {}, onChange } = {}) {
  root.innerHTML = renderFilterBar(snapshot, filters);
  root.addEventListener('change', (event) => {
    if (!event.target?.dataset?.filter) return;
    onChange?.(readFilterBar(root));
  });
}

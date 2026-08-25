import { getSnapshot } from './api.js';
import { renderImportView } from './import-view.js';
import { mountOverview } from './overview-view.js';
import { mountReview } from './review-view.js';
import { mountBudgets } from './budgets-view.js';
import { mountRecurring } from './recurring-view.js';
import { guard } from './errors.js';

const views = {
  overview: document.querySelector('#view-overview'),
  import: document.querySelector('#view-import'),
  review: document.querySelector('#view-review'),
  budgets: document.querySelector('#view-budgets'),
  recurring: document.querySelector('#view-recurring')
};
const drilldownRoot = document.querySelector('#drilldown');
const budgetsDrilldownRoot = document.querySelector('#budgets-drilldown');
const recurringDrilldownRoot = document.querySelector('#recurring-drilldown');

let overview = null;
let review = null;
let budgets = null;
let recurring = null;
// Guards against two refresh() calls running concurrently — each drives an
// independent chain of per-view getSnapshot() calls, and without this, two
// overlapping calls could resolve out of order with no guarantee the more
// recent one wins.
let refreshing = false;

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const snapshot = await getSnapshot();
    if (overview) await overview.refresh();
    else overview = mountOverview(views.overview, { snapshot, drilldownRoot });
    if (review) await review.refresh();
    else review = mountReview(views.review, { snapshot });
    if (budgets) await budgets.refresh();
    else budgets = mountBudgets(views.budgets, { snapshot, drilldownRoot: budgetsDrilldownRoot });
    if (recurring) await recurring.refresh();
    else recurring = mountRecurring(views.recurring, { snapshot, drilldownRoot: recurringDrilldownRoot });
  } finally {
    refreshing = false;
  }
}

const guardedRefresh = guard(refresh);

function showTab(name) {
  for (const [key, element] of Object.entries(views)) element.classList.toggle('hidden', key !== name);
  for (const button of document.querySelectorAll('#tabs button')) {
    button.classList.toggle('active', button.dataset.tab === name);
  }
  // A drill-down panel is a fixed overlay independent of which tab section
  // is visible — switching tabs must actually close it (reset the owning
  // view's own state), not just rely on the section beneath it being
  // hidden, or the panel keeps floating over whatever tab you switch to.
  overview?.closeDrilldown?.();
  budgets?.closeDrilldown?.();
  recurring?.closeDrilldown?.();
}

document.querySelector('#tabs').addEventListener('click', (event) => {
  const tab = event.target.dataset?.tab;
  if (tab) showTab(tab);
});

renderImportView(views.import, {
  onImported: async () => { await guardedRefresh(); showTab('overview'); }
});

await guardedRefresh();
showTab('overview');

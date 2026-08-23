import { getSnapshot } from './api.js';
import { renderImportView } from './import-view.js';
import { mountOverview } from './overview-view.js';
import { mountReview } from './review-view.js';

const views = {
  overview: document.querySelector('#view-overview'),
  import: document.querySelector('#view-import'),
  review: document.querySelector('#view-review')
};

let review = null;

async function refresh() {
  const snapshot = await getSnapshot();
  mountOverview(views.overview, { snapshot });
  if (review) await review.refresh();
  else review = mountReview(views.review, { snapshot });
}

function showTab(name) {
  for (const [key, element] of Object.entries(views)) element.classList.toggle('hidden', key !== name);
  for (const button of document.querySelectorAll('#tabs button')) {
    button.classList.toggle('active', button.dataset.tab === name);
  }
}

document.querySelector('#tabs').addEventListener('click', (event) => {
  const tab = event.target.dataset?.tab;
  if (tab) showTab(tab);
});

renderImportView(views.import, {
  onImported: async () => { await refresh(); showTab('overview'); }
});

await refresh();
showTab('overview');

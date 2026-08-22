import { previewImport, commitImport } from './api.js';

const money = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(n).toFixed(2);

// Every value interpolated into innerHTML below can originate from data we
// don't control: a bank CSV's merchant/description text, a chosen filename,
// or an ingest() malformed-row reason that echoes the raw cell back. None
// of that is sanitised upstream — it round-trips through JSON exactly as
// read from the file. Escaping HTML metacharacters here is what stops a
// merchant description like `<img src=x onerror=...>` (a real thing bank
// exports contain, deliberately or not) from being parsed as markup instead
// of shown as text.
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

export function renderImportView(root, { onImported }) {
  let pending = [];

  root.innerHTML = `
    <div class="dropzone" id="dropzone">
      Drop bank CSVs here, or click to choose files
      <input type="file" id="filepicker" accept=".csv,text/csv" multiple hidden>
    </div>
    <div id="previews"></div>
  `;

  const dropzone = root.querySelector('#dropzone');
  const picker = root.querySelector('#filepicker');
  const previews = root.querySelector('#previews');

  dropzone.addEventListener('click', () => picker.click());
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('over'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('over'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('over');
    handleFiles([...e.dataTransfer.files]);
  });
  picker.addEventListener('change', () => handleFiles([...picker.files]));

  async function handleFiles(fileList) {
    if (!fileList.length) return;
    previews.innerHTML = '<p class="empty">Reading files…</p>';
    pending = await Promise.all(
      fileList.map(async (f) => ({ filename: f.name, text: await f.text() }))
    );
    try {
      const { previews: cards } = await previewImport(pending);
      renderPreviews(cards);
    } catch (err) {
      previews.innerHTML = `<div class="card warn">Could not read these files: ${escapeHtml(err.message)}</div>`;
    }
  }

  function renderPreviews(cards) {
    previews.innerHTML = cards.map((card) => `
      <div class="card">
        <h3>${escapeHtml(card.filename)}</h3>
        <p>
          Detected <b>${escapeHtml(card.format.dateFormat)}</b> dates,
          spend as <b>${escapeHtml(card.format.spendSign)}</b> amounts
          ${card.format.dateFormatConfidence === 'low'
            ? '<span class="warn">— day/month order could not be confirmed from this file, please check the dates below</span>'
            : ''}
        </p>
        <p>
          <b>${card.summary.rowsRead}</b> rows ·
          <b>${card.summary.added}</b> new ·
          <b>${card.summary.duplicates}</b> already imported ·
          <b>${card.summary.autoCategorised}</b> auto-categorised ·
          <b class="${card.summary.needsReview ? 'warn' : ''}">${card.summary.needsReview}</b> need review
        </p>
        <p>
          ${escapeHtml(card.summary.dateFrom ?? '—')} to ${escapeHtml(card.summary.dateTo ?? '—')} ·
          spend <b>${money(card.summary.totalSpend)}</b> ·
          income <b>${money(card.summary.totalIncome)}</b>
        </p>
        <p><b>Nothing has been saved yet.</b> Review the detected format and totals above before confirming.</p>
        ${card.malformed.length ? `
          <p class="warn">${card.malformed.length} row(s) could not be read and will be skipped:</p>
          <ul>${card.malformed.map((m) => `<li>Line ${m.line}: ${escapeHtml(m.reason)}</li>`).join('')}</ul>
        ` : ''}
        <table>
          <thead><tr><th>Date</th><th>Merchant</th><th>Category</th><th class="num">Amount</th></tr></thead>
          <tbody>
            ${card.sampleTransactions.map((t) => `
              <tr>
                <td>${escapeHtml(t.date)}</td><td>${escapeHtml(t.merchant)}</td>
                <td>${t.categorySource === 'unknown' ? '<span class="warn">needs review</span>' : escapeHtml(t.categoryId)}</td>
                <td class="num">${money(t.amount)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `).join('') + `
      <button class="primary" id="confirm">Confirm and import</button>
      <p class="empty">Nothing has been saved yet.</p>
    `;

    previews.querySelector('#confirm').addEventListener('click', async (e) => {
      e.target.disabled = true;
      e.target.textContent = 'Importing…';
      try {
        const { results } = await commitImport(pending);
        const added = results.reduce((a, r) => a + r.summary.added, 0);
        const review = results.reduce((a, r) => a + r.summary.needsReview, 0);
        previews.innerHTML =
          `<div class="card"><b>${added}</b> transactions imported, ` +
          `<b class="${review ? 'warn' : ''}">${review}</b> need review.</div>`;
        pending = [];
        await onImported();
      } catch (err) {
        previews.innerHTML = `<div class="card warn">Import failed: ${escapeHtml(err.message)}</div>`;
      }
    });
  }
}

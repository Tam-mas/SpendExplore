import { previewImport, commitImport } from './api.js';

const money = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(n).toFixed(2);

// Mirrors server/routes/import.js's MAX_ACCOUNT_ID_LENGTH — the server is
// the real authority (this is only a UX nicety so the field doesn't let you
// type past what will just get rejected), so keep it in sync by hand rather
// than fetching it, which would need a round trip before the field even
// renders.
const MAX_ACCOUNT_ID_LENGTH = 60;

// The credit-card export is the one format this branch added DD Mon YYYY
// sniffing for. Every OTHER format ('YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY')
// is a bank statement, so treating this one dateFormat as the CC signal
// needs no separate "is this a credit card file" flag anywhere else.
const CC_DATE_FORMAT = 'DD Mon YYYY';

// One account applies to the whole batch (the commit route takes a single
// accountId, not one per file), so a hint has to resolve disagreement
// between files rather than just reading the first one. If every file in
// the batch looks like the CC export, prefill 'CC' — but if even one file
// doesn't (e.g. a bank statement dropped alongside a CC statement by
// mistake), guessing CC would be wrong for the others and silently mislabel
// them if the user doesn't notice the prefill. Falling back to 'default'
// in a disagreement is just the STARTING value of an editable field — the
// user can still type anything — so getting it wrong here costs nothing
// but an extra edit, whereas guessing confidently wrong risks going unseen.
const suggestAccountId = (cards) =>
  cards.length > 0 && cards.every((c) => c.format?.dateFormat === CC_DATE_FORMAT) ? 'CC' : 'default';

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
  // `busy` guards against a second drop/pick starting while handleFiles()
  // is still reading/previewing the first batch — without it, whichever
  // batch's preview renders LAST wins the on-screen cards, but the confirm
  // handler used to read a shared outer variable that could have already
  // moved on to a THIRD, still-in-flight batch by the time it was clicked.
  // Passing each batch's files directly into its own renderPreviews() call
  // (instead of through shared state) is what actually fixes that; `busy`
  // just stops the confusing intermediate state from happening at all.
  let busy = false;

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

  dropzone.addEventListener('click', () => { if (!busy) picker.click(); });
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('over'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('over'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('over');
    if (!busy) handleFiles([...e.dataTransfer.files]);
  });
  picker.addEventListener('change', () => { if (!busy) handleFiles([...picker.files]); });

  async function handleFiles(fileList) {
    if (!fileList.length) return;
    busy = true;
    dropzone.classList.add('busy');
    previews.innerHTML = '<p class="empty">Reading files…</p>';
    try {
      const files = await Promise.all(
        fileList.map(async (f) => ({ filename: f.name, text: await f.text() }))
      );
      // The first preview call carries no accountId, purely to learn each
      // file's sniffed format so suggestAccountId() has something to look
      // at. Re-previewing under the suggested account (when it isn't the
      // 'default' the first call already used) keeps preview and commit
      // computing duplicates against the SAME accountId — ingest()'s
      // transaction ids are scoped by account, so a preview run under the
      // wrong one could show a duplicate count that commit then contradicts.
      const first = await previewImport(files);
      const accountId = suggestAccountId(first.previews);
      const { previews: cards } = accountId === 'default'
        ? first
        : await previewImport(files, accountId);
      renderPreviews(cards, files, accountId);
    } catch (err) {
      previews.innerHTML = `<div class="card warn">Could not read these files: ${escapeHtml(err.message)}</div>`;
    } finally {
      busy = false;
      dropzone.classList.remove('busy');
    }
  }

  // `files` is the exact batch that produced `cards` — closed over directly
  // by the confirm handler below, so what gets committed always matches
  // what's on screen, even if another handleFiles() call is already
  // running by the time the user clicks Confirm.
  function renderPreviews(cards, files, accountId) {
    previews.innerHTML = `
      <div class="card">
        <label>
          Account
          <input type="text" id="account-input" value="${escapeHtml(accountId)}"
                 maxlength="${MAX_ACCOUNT_ID_LENGTH}">
        </label>
        <p class="hint">
          Every transaction in this batch is stamped with this one account —
          drop statements from different accounts separately.
        </p>
      </div>
    ` + cards.map((card) => `
      <div class="card">
        <h3>${escapeHtml(card.filename)}</h3>
        ${card.format ? `
        <p>
          Detected <b>${escapeHtml(card.format.dateFormat)}</b> dates,
          spend as <b>${escapeHtml(card.format.spendSign)}</b> amounts
          ${card.format.dateFormatConfidence === 'low'
            ? '<span class="warn">— day/month order could not be confirmed from this file, please check the dates below</span>'
            : ''}
        </p>` : ''}
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

    const accountInput = previews.querySelector('#account-input');
    const confirmBtn = previews.querySelector('#confirm');

    // Re-preview under the edited account rather than just relabelling the
    // cards on screen: duplicate/added counts are computed against the
    // ledger's existing rows for that SPECIFIC account (see the comment in
    // handleFiles), so switching from 'default' to an account with its own
    // import history can change those numbers, not just the label.
    accountInput.addEventListener('change', async () => {
      const value = accountInput.value.trim();
      if (!value) {
        // Empty is caught here, before ever asking the server, so the
        // field's own edit doesn't need a round trip to tell the user what
        // validateImportBody() would reject anyway.
        confirmBtn.disabled = true;
        return;
      }
      confirmBtn.disabled = true;
      accountInput.disabled = true;
      try {
        const { previews: freshCards } = await previewImport(files, value);
        renderPreviews(freshCards, files, value);
      } catch (err) {
        previews.innerHTML = `<div class="card warn">Could not preview under account "${escapeHtml(value)}": ${escapeHtml(err.message)}</div>`;
      }
    });

    confirmBtn.addEventListener('click', async (e) => {
      e.target.disabled = true;
      e.target.textContent = 'Importing…';
      accountInput.disabled = true;
      try {
        const { results } = await commitImport(files, accountId);
        const added = results.reduce((a, r) => a + r.summary.added, 0);
        const review = results.reduce((a, r) => a + r.summary.needsReview, 0);
        previews.innerHTML =
          `<div class="card"><b>${added}</b> transactions imported, ` +
          `<b class="${review ? 'warn' : ''}">${review}</b> need review.</div>`;
        await onImported();
      } catch (err) {
        previews.innerHTML = `<div class="card warn">Import failed: ${escapeHtml(err.message)}</div>`;
      }
    });
  }
}

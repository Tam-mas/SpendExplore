import { buildQueue, itemForMerchant, promptForClaude, parseClaudeResponse } from '../lib/review.js';
import { escapeHtml, formatMoney } from './charts/scale.js';
import { bulkCategorise, patchTransaction, createCategory, getSnapshot } from './api.js';

const labelFor = (snapshot, id) =>
  (snapshot?.categories?.categories ?? []).find((c) => c.id === id)?.label ?? id;

const assignableCategories = (snapshot) =>
  (snapshot?.categories?.categories ?? []).filter((c) => c.id !== 'income' && c.id !== 'uncategorised');

/**
 * The session's stable review order: every merchant that has ever appeared
 * in the pending queue, in the order it first appeared. Only ever grows —
 * an assignment never removes a merchant from it, which is what lets Back
 * return to a merchant after it has been decided.
 */
function growOrder(snapshot, previousOrder = []) {
  const pending = buildQueue(snapshot).items.map((item) => item.merchant);
  const seen = new Set(previousOrder);
  return [...previousOrder, ...pending.filter((merchant) => !seen.has(merchant))];
}

/**
 * Render the queue. Pure — snapshot and state in, markup out — so it is
 * testable in Node with no DOM.
 */
export function renderReview(snapshot, state = {}) {
  const queue = buildQueue(snapshot);
  const order = state.order ?? growOrder(snapshot);
  const index = order.length ? Math.min(Math.max(state.index ?? 0, 0), order.length - 1) : 0;
  const merchant = order[index];
  const item = merchant ? itemForMerchant(snapshot, merchant) : null;

  if (!order.length) {
    return `<div class="review-done">
      <h2>All caught up</h2>
      <p class="viz-note">Nothing to review — every transaction has a category.</p>
    </div>`;
  }

  if (!item) {
    // Every transaction for this merchant was excluded — nothing to show,
    // but Back/Next must still work so the user isn't stranded here.
    return `<div class="review">
      <header class="review-head">
        <button class="review-nav" data-review-action="prev" ${index === 0 ? 'disabled' : ''} aria-label="Back">‹ Back</button>
        <span class="viz-note">${index + 1} of ${order.length}</span>
        <button class="review-nav" data-review-action="next" ${index === order.length - 1 ? 'disabled' : ''} aria-label="Next">Next ›</button>
      </header>
      <p class="viz-note">This merchant was excluded — nothing left to show here.</p>
    </div>`;
  }

  const shortcuts = item.suggestions.map((id, i) => `
    <button class="review-key" data-assign="${escapeHtml(id)}" data-key="${i + 1}">
      <kbd>${i + 1}</kbd> ${escapeHtml(labelFor(snapshot, id))}
    </button>`).join('');

  const options = assignableCategories(snapshot)
    .map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.label)}</option>`).join('');

  const pasteFeedback = state.pasteError
    ? `<p class="review-error">${escapeHtml(state.pasteError)}</p>`
    : state.pasteResult
      ? `<p class="review-ok">${escapeHtml(state.pasteResult)}</p>`
      : '';

  const statusNote = item.isPending
    ? `<p class="viz-note">Assigning remembers this merchant for future imports. Past transactions are left alone.</p>`
    : `<p class="viz-note">Currently filed as <b>${escapeHtml(labelFor(snapshot, item.currentCategoryId))}</b>. Pick a different category to change it — past transactions are left alone.</p>`;

  return `
  <div class="review">
    <header class="review-head">
      <button class="review-nav" data-review-action="prev" ${index === 0 ? 'disabled' : ''} aria-label="Back">‹ Back</button>
      <span class="viz-note">${index + 1} of ${order.length}${queue.totalRows ? ` · ${queue.totalRows} transaction${queue.totalRows === 1 ? '' : 's'} still to place` : ''}</span>
      <button class="review-nav" data-review-action="next" ${index === order.length - 1 ? 'disabled' : ''} aria-label="Next">Next ›</button>
    </header>

    <section class="review-card">
      <h2>${escapeHtml(item.merchant)}</h2>
      <p class="review-meta">
        <b>${formatMoney(item.total)}</b> ·
        ${item.count} transaction${item.count === 1 ? '' : 's'} ·
        ${escapeHtml(item.dateFrom ?? '')}${item.dateTo !== item.dateFrom ? ' to ' + escapeHtml(item.dateTo ?? '') : ''}
      </p>
      <p class="review-raw">${escapeHtml(item.sampleDescription)}</p>

      <div class="review-keys">${shortcuts}</div>

      <div class="review-actions">
        <label class="viz-control">
          <span class="viz-control-label">All categories</span>
          <select data-review-action="search">
            <option value="">Choose…</option>
            ${options}
          </select>
        </label>
        <button data-review-action="new-category"><kbd>n</kbd> New category</button>
        <button data-review-action="exclude"><kbd>x</kbd> Exclude</button>
        <button data-review-action="skip"><kbd>s</kbd> Skip</button>
      </div>
      ${statusNote}
    </section>

    <details class="review-claude">
      <summary>Stuck? Ask Claude</summary>
      <p class="viz-note">Copies the merchant names only — no amounts, dates or account details.</p>
      <button data-review-action="copy-prompt">Copy ${queue.items.length} merchant names for Claude</button>
      <textarea data-review-paste rows="5" placeholder="Paste Claude's JSON reply here"></textarea>
      <button data-review-action="apply-paste">Apply pasted JSON</button>
      ${pasteFeedback}
    </details>
  </div>`;
}

/** Wire the queue to the live DOM. */
export function mountReview(root, { snapshot, onChanged } = {}) {
  let current = snapshot;
  let state = { index: 0, order: growOrder(current) };

  const draw = () => { root.innerHTML = renderReview(current, state); };

  const refresh = async () => {
    current = await getSnapshot();
    state.order = growOrder(current, state.order);
    state.index = state.order.length ? Math.min(state.index, state.order.length - 1) : 0;
    draw();
    onChanged?.(current);
  };

  const currentItem = () => {
    const merchant = state.order[state.index];
    return merchant ? itemForMerchant(current, merchant) : null;
  };

  const advance = () => {
    state.index = state.order.length ? Math.min(state.index + 1, state.order.length - 1) : 0;
  };

  async function assign(categoryId) {
    const item = currentItem();
    if (!item) return;
    await bulkCategorise({ ids: item.ids, categoryId, rememberRule: true, applyToPast: false });
    advance();
    await refresh();
  }

  async function excludeGroup() {
    const item = currentItem();
    if (!item) return;
    for (const id of item.ids) await patchTransaction(id, { excluded: true });
    advance();
    await refresh();
  }

  root.addEventListener('click', async (event) => {
    const assignTo = event.target.closest('[data-assign]')?.dataset.assign;
    if (assignTo) return assign(assignTo);

    const action = event.target.closest('[data-review-action]')?.dataset.reviewAction;
    if (!action) return;

    if (action === 'skip' || action === 'next') {
      advance();
      draw();
    } else if (action === 'prev') {
      state.index = Math.max(0, state.index - 1);
      draw();
    } else if (action === 'exclude') {
      await excludeGroup();
    } else if (action === 'new-category') {
      const label = prompt('New category name?');
      if (!label) return;
      const groups = current.categories.groups.map((g) => g.label).join(', ');
      const groupLabel = prompt(`Which group? (${groups})`);
      const group = current.categories.groups.find(
        (g) => g.label.toLowerCase() === String(groupLabel).toLowerCase());
      if (!group) return;
      const id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      await createCategory({ id, label, groupId: group.id });
      await assign(id);
    } else if (action === 'copy-prompt') {
      const text = promptForClaude(buildQueue(current), current);
      await navigator.clipboard.writeText(text);
      state.pasteResult = 'Copied. Paste it into Claude, then paste the JSON reply below.';
      state.pasteError = null;
      draw();
    } else if (action === 'apply-paste') {
      const text = root.querySelector('[data-review-paste]')?.value ?? '';
      const { assignments, errors } = parseClaudeResponse(text, current);
      if (!assignments.length) {
        state.pasteError = errors[0] ?? 'Nothing to apply.';
        state.pasteResult = null;
        return draw();
      }
      const queue = buildQueue(current);
      let applied = 0;
      let skippedMerchants = 0;
      for (const { merchant, categoryId } of assignments) {
        const item = queue.items.find((i) => i.merchant === merchant);
        if (!item) { skippedMerchants++; continue; }
        await bulkCategorise({ ids: item.ids, categoryId, rememberRule: true, applyToPast: false });
        applied++;
      }
      const parts = [`Applied ${applied} of ${assignments.length}.`];
      if (skippedMerchants > 0) parts.push(`${skippedMerchants} merchant${skippedMerchants === 1 ? ' was' : 's were'} not in the queue.`);
      if (errors.length > 0) parts.push(`${errors.length} error${errors.length === 1 ? '' : 's'}.`);
      state.index = 0;
      state.pasteResult = parts.join(' ');
      state.pasteError = null;
      await refresh();
    }
  });

  root.addEventListener('change', (event) => {
    if (event.target.dataset?.reviewAction === 'search' && event.target.value) {
      assign(event.target.value);
    }
  });

  // Keyboard shortcuts, ignored while the user is typing into a field.
  const onKey = (event) => {
    if (root.classList.contains('hidden')) return;
    const tag = event.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    // Navigation must work even when the current slot has nothing left to
    // show (every transaction for that merchant got excluded) — otherwise
    // the user is stranded with no way to move off it.
    if (event.key === 'ArrowRight' || event.key === 's') { advance(); draw(); return; }
    if (event.key === 'ArrowLeft') { state.index = Math.max(0, state.index - 1); draw(); return; }

    const item = currentItem();
    if (!item) return;

    if (/^[1-9]$/.test(event.key)) {
      const id = item.suggestions[Number(event.key) - 1];
      if (id) { event.preventDefault(); assign(id); }
    } else if (event.key === 'x') { excludeGroup(); }
    else if (event.key === 'n') { root.querySelector('[data-review-action="new-category"]')?.click(); }
    else if (event.key === '/') { event.preventDefault(); root.querySelector('[data-review-action="search"]')?.focus(); }
  };
  document.addEventListener('keydown', onKey);

  draw();
  return { redraw: draw, refresh };
}

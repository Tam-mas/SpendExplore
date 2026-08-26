import { escapeHtml } from './charts/scale.js';
import { getThemePreference, setThemePreference } from './theme.js';
import { patchAccount, getSnapshot } from './api.js';
import { guard } from './errors.js';

const THEME_OPTIONS = [
  { value: 'system', label: 'Match system' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
];

/**
 * Every distinct card suffix seen on this account's own transactions,
 * sorted. Deliberately data-derived rather than free-text entry — you can
 * only name a card that has actually charged something, which is both the
 * common case and the one that can't typo a suffix into a mapping nothing
 * will ever match.
 */
export function cardSuffixesForAccount(snapshot, accountId) {
  const suffixes = new Set();
  for (const txn of snapshot?.transactions ?? []) {
    if (txn.accountId === accountId && txn.cardSuffix) suffixes.add(txn.cardSuffix);
  }
  return [...suffixes].sort();
}

function themeControl(current) {
  const options = THEME_OPTIONS.map(({ value, label }) => `
    <label class="settings-theme-option">
      <input type="radio" name="theme" value="${value}"${value === current ? ' checked' : ''}>
      ${escapeHtml(label)}
    </label>`).join('');
  return `
  <section class="settings-section">
    <h3>Appearance</h3>
    <div class="settings-theme-options">${options}</div>
  </section>`;
}

function accountSection(snapshot, account) {
  const suffixes = cardSuffixesForAccount(snapshot, account.id);
  const cardOwners = account.cardOwners ?? {};

  const rows = suffixes.length
    ? suffixes.map((suffix) => `
      <label class="settings-card-row">
        <span>•• ${escapeHtml(suffix)}</span>
        <input type="text" data-card-suffix="${escapeHtml(suffix)}" placeholder="Whose card is this?" value="${escapeHtml(cardOwners[suffix] ?? '')}">
      </label>`).join('')
    : '<p class="settings-empty-note">No card numbers seen yet for this account — they’ll appear here once you import a statement carrying them.</p>';

  return `
  <section class="settings-account" data-account-id="${escapeHtml(account.id)}">
    <label class="settings-label-row">
      <span>Account name</span>
      <input type="text" data-account-label value="${escapeHtml(account.label ?? account.id)}">
    </label>
    ${rows}
    <button data-settings-action="save" data-account-id="${escapeHtml(account.id)}">Save</button>
    <span class="settings-save-status" data-save-status></span>
  </section>`;
}

/**
 * Pure render of the Settings tab: the OS-vs-explicit theme choice, plus one
 * section per account for renaming it and naming the person behind each of
 * its observed card suffixes. `state.theme` is the current preference
 * ('system'|'light'|'dark'), read by the caller from web/theme.js so this
 * function stays a pure function of its arguments, like every other view's
 * render.
 */
export function renderSettings(snapshot, state = {}) {
  const theme = state.theme ?? 'system';
  const accounts = snapshot?.accounts ?? [];

  const accountsHtml = accounts.length
    ? accounts.map((account) => accountSection(snapshot, account)).join('')
    : '<p class="empty">No accounts yet — they appear automatically the first time you import a statement.</p>';

  return `
  ${themeControl(theme)}
  <section class="settings-section">
    <h3>Accounts</h3>
    <p class="viz-note">Name each card so charts can split spending by person, not just by card number.</p>
    ${accountsHtml}
  </section>`;
}

/** Wire the Settings tab into a live DOM node. */
export function mountSettings(root, { snapshot } = {}) {
  let current = snapshot;

  const draw = () => {
    root.innerHTML = renderSettings(current, { theme: getThemePreference() });
  };

  const save = guard(async (accountId) => {
    const section = root.querySelector(`[data-account-id="${CSS.escape(accountId)}"]`);
    if (!section) return;
    const label = section.querySelector('[data-account-label]')?.value ?? '';
    const cardOwners = {};
    for (const input of section.querySelectorAll('[data-card-suffix]')) {
      const suffix = input.dataset.cardSuffix;
      const value = input.value.trim();
      if (value) cardOwners[suffix] = value;
    }
    await patchAccount(accountId, { label, cardOwners });
    current = await getSnapshot();
    draw();
    const status = root.querySelector(`[data-account-id="${CSS.escape(accountId)}"] [data-save-status]`);
    if (status) {
      status.textContent = 'Saved';
      setTimeout(() => { if (status.isConnected) status.textContent = ''; }, 2000);
    }
  });

  async function refresh() {
    current = await getSnapshot();
    draw();
  }

  draw();

  root.addEventListener('click', (event) => {
    const button = event.target.closest('[data-settings-action="save"]');
    if (button) save(button.dataset.accountId);
  });

  root.addEventListener('change', (event) => {
    if (event.target.name === 'theme') setThemePreference(event.target.value);
  });

  return { redraw: draw, refresh };
}

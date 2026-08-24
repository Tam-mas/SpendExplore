// A single place for every view to surface a failed request instead of
// leaving the UI silently stale. `guard()` is the normal entry point — wrap
// any async event handler with it so a rejection always ends up here rather
// than as an unhandled promise rejection or a stuck-looking screen.

let banner = null;
let hideTimer = null;

function getBanner() {
  if (!banner) banner = document.querySelector('#error-banner');
  return banner;
}

export function showError(message) {
  const el = getBanner();
  if (!el) return; // no banner mounted (e.g. a test environment) — nothing to do
  el.textContent = message || 'Something went wrong';
  el.classList.remove('hidden');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => el.classList.add('hidden'), 6000);
}

/** Wrap an async function so a rejection shows a message instead of throwing. */
export function guard(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      showError(err?.message ?? 'Something went wrong');
      return undefined;
    }
  };
}

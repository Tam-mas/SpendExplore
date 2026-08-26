/**
 * The user's explicit theme choice, layered on top of the OS setting that
 * `prefers-color-scheme` already drives everywhere in web/style.css.
 *
 * Storing 'system' as "no key at all" (rather than writing the literal
 * string) means an install that never opens Settings behaves exactly as it
 * did before this file existed — the OS decides, with nothing to migrate.
 */
const THEME_KEY = 'spendexplore.theme';
const THEMES = Object.freeze(['light', 'dark', 'system']);

/** Fired on `window` whenever the explicit preference changes, so any
 * already-mounted view that bakes colour into rendered markup (chart SVGs;
 * plain CSS-token consumers need no help) knows to redraw. */
export const THEME_CHANGE_EVENT = 'spendexplore:theme-changed';

/** 'light' | 'dark' | 'system'. Never throws — a private window, a cleared
 * site data store, or a stale/garbage stored value all fall back to 'system'. */
export function getThemePreference() {
  try {
    const stored = globalThis.localStorage?.getItem(THEME_KEY);
    return THEMES.includes(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function setThemePreference(pref) {
  if (!THEMES.includes(pref)) return;
  try {
    if (pref === 'system') globalThis.localStorage?.removeItem(THEME_KEY);
    else globalThis.localStorage?.setItem(THEME_KEY, pref);
  } catch {
    // Storage unavailable — the choice simply doesn't persist across reloads,
    // same trade-off every other localStorage-backed preference in this app makes.
  }
  applyThemeAttribute();
  globalThis.window?.dispatchEvent?.(new Event(THEME_CHANGE_EVENT));
}

/**
 * Stamp (or clear) `data-theme` on the root element. web/style.css keys its
 * explicit overrides off this attribute; 'system' means no attribute at all,
 * which is what lets `prefers-color-scheme` keep deciding unopposed.
 *
 * Safe to call from a non-browser environment (Node's test runner, which has
 * no `document`) — every access is optional-chained.
 */
export function applyThemeAttribute() {
  const pref = getThemePreference();
  const root = globalThis.document?.documentElement;
  if (!root) return;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
}

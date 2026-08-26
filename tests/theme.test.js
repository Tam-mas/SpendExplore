import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getThemePreference, setThemePreference, applyThemeAttribute, THEME_CHANGE_EVENT } from '../web/theme.js';

/** A minimal in-memory localStorage, since Node's test runner has none. */
function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k)
  };
}

test('defaults to system when no preference has ever been stored', () => {
  assert.equal(globalThis.localStorage, undefined, 'this project has no global localStorage under node --test');
  assert.equal(getThemePreference(), 'system');
});

test('setThemePreference persists light and dark, and getThemePreference reads them back', () => {
  const original = globalThis.localStorage;
  globalThis.localStorage = fakeStorage();
  try {
    setThemePreference('dark');
    assert.equal(getThemePreference(), 'dark');
    setThemePreference('light');
    assert.equal(getThemePreference(), 'light');
  } finally {
    globalThis.localStorage = original;
  }
});

test('setThemePreference(\'system\') clears the stored key rather than writing the literal string', () => {
  const original = globalThis.localStorage;
  const storage = fakeStorage();
  globalThis.localStorage = storage;
  try {
    setThemePreference('dark');
    assert.equal(storage.getItem('spendexplore.theme'), 'dark');
    setThemePreference('system');
    assert.equal(storage.getItem('spendexplore.theme'), null);
    assert.equal(getThemePreference(), 'system');
  } finally {
    globalThis.localStorage = original;
  }
});

test('an unrecognised stored value falls back to system rather than throwing', () => {
  const original = globalThis.localStorage;
  globalThis.localStorage = fakeStorage();
  try {
    globalThis.localStorage.setItem('spendexplore.theme', 'sepia');
    assert.equal(getThemePreference(), 'system');
  } finally {
    globalThis.localStorage = original;
  }
});

test('setThemePreference rejects a value outside the three allowed themes, silently', () => {
  const original = globalThis.localStorage;
  globalThis.localStorage = fakeStorage();
  try {
    setThemePreference('dark');
    setThemePreference('rainbow');
    assert.equal(getThemePreference(), 'dark', 'a garbage preference must not overwrite a valid stored one');
  } finally {
    globalThis.localStorage = original;
  }
});

test('a throwing localStorage (private-browsing Safari) is tolerated, never thrown through', () => {
  const original = globalThis.localStorage;
  globalThis.localStorage = {
    getItem() { throw new Error('SecurityError'); },
    setItem() { throw new Error('SecurityError'); },
    removeItem() { throw new Error('SecurityError'); }
  };
  try {
    assert.equal(getThemePreference(), 'system');
    assert.doesNotThrow(() => setThemePreference('dark'));
  } finally {
    globalThis.localStorage = original;
  }
});

test('applyThemeAttribute is a no-op under Node, which has no document', () => {
  assert.equal(globalThis.document, undefined);
  assert.doesNotThrow(() => applyThemeAttribute());
});

test('THEME_CHANGE_EVENT is a namespaced string, not something generic enough to collide', () => {
  assert.equal(THEME_CHANGE_EVENT, 'spendexplore:theme-changed');
});

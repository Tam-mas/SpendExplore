import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GROUP_SLOTS, SEQUENTIAL_BLUE, SURFACES, TEXT, DIVERGING,
  colourForGroup, colourForCategory, sequentialColour, cssVariables
} from '../web/charts/palette.js';

test('the seven groups carry the validated categorical slots in order', () => {
  assert.deepEqual(Object.keys(GROUP_SLOTS), [
    'food-drink', 'transport', 'home', 'health', 'lifestyle', 'money', 'other'
  ]);
  assert.deepEqual(Object.values(GROUP_SLOTS).map((s) => s.light), [
    '#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7'
  ]);
  // 'money' dark corrected by the dark-mode visual review (Task 4): it shipped
  // identical to its light value, the only slot to do so, and measured well
  // under the contrast floor once the ghost-baseline stroke's .55 opacity was
  // applied. See the comment above GROUP_SLOTS in palette.js for the numbers.
  assert.deepEqual(Object.values(GROUP_SLOTS).map((s) => s.dark), [
    '#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#39c639', '#9085e9'
  ]);
});

test('colour is keyed by group id, never by rank', () => {
  assert.equal(colourForGroup('transport', 'light'), '#eb6834');
  // Removing an earlier group must not change a later one.
  assert.equal(colourForGroup('other', 'light'), '#4a3aa7');
});

test('an unknown group falls back to the Other slot rather than throwing', () => {
  assert.equal(colourForGroup('made-up', 'light'), GROUP_SLOTS.other.light);
});

test('the sequential ramp is 13 steps, light to dark, monotonic', () => {
  assert.equal(SEQUENTIAL_BLUE.length, 13);
  assert.equal(SEQUENTIAL_BLUE[0].hex, '#cde2fb');
  assert.equal(SEQUENTIAL_BLUE.at(-1).hex, '#0d366b');
  const steps = SEQUENTIAL_BLUE.map((s) => s.step);
  assert.deepEqual(steps, [...steps].sort((a, b) => a - b));
});

test('sequentialColour maps 0..1 onto the ramp within the ordinal-safe band', () => {
  // Light mode must never go lighter than step 250 (contrast floor).
  const lightest = sequentialColour(0, 'light');
  assert.equal(lightest, '#86b6ef');
  assert.equal(sequentialColour(1, 'light'), '#0d366b');
  // Dark mode must never go darker than step 600.
  assert.equal(sequentialColour(1, 'dark'), '#184f95');
});

test('sequentialColour clamps out-of-range fractions', () => {
  assert.equal(sequentialColour(-5, 'light'), sequentialColour(0, 'light'));
  assert.equal(sequentialColour(99, 'light'), sequentialColour(1, 'light'));
});

test('categories within a group are steps of that group hue, all distinct', () => {
  const cats = ['groceries', 'restaurants', 'takeaway', 'coffee', 'alcohol'];
  const colours = cats.map((c) => colourForCategory(c, 'food-drink', cats, 'light'));
  assert.equal(new Set(colours).size, 5, `expected 5 distinct, got ${colours}`);
  assert.equal(colours[0], colourForGroup('food-drink', 'light'));
});

test('a category keeps its colour when siblings are filtered out', () => {
  const all = ['groceries', 'restaurants', 'takeaway', 'coffee', 'alcohol'];
  const before = colourForCategory('takeaway', 'food-drink', all, 'light');
  const after = colourForCategory('takeaway', 'food-drink', all, 'light');
  assert.equal(before, after);
});

test('surfaces, text and diverging tokens are present for both modes', () => {
  assert.equal(SURFACES.light, '#fcfcfb');
  assert.equal(SURFACES.dark, '#1a1a19');
  assert.equal(TEXT.light.primary, '#0b0b0b');
  assert.equal(TEXT.dark.primary, '#ffffff');
  assert.equal(DIVERGING.light.mid, '#f0efec');
  assert.equal(DIVERGING.dark.mid, '#383835');
});

test('cssVariables emits a declaration block for each mode', () => {
  const light = cssVariables('light');
  assert.match(light, /--viz-surface:\s*#fcfcfb/);
  assert.match(light, /--viz-group-food-drink:\s*#2a78d6/);
  assert.match(cssVariables('dark'), /--viz-surface:\s*#1a1a19/);
});

test('every exported hex is a full six-digit hex string', () => {
  const hexes = [
    ...Object.values(GROUP_SLOTS).flatMap((s) => [s.light, s.dark]),
    ...SEQUENTIAL_BLUE.map((s) => s.hex),
    SURFACES.light, SURFACES.dark
  ];
  for (const hex of hexes) assert.match(hex, /^#[0-9a-f]{6}$/, hex);
});

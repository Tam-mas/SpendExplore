/**
 * Colour tokens for SpendExplore charts.
 *
 * These hexes come from the dataviz reference palette and were validated with
 * its own validator for exactly this 7-slot set:
 *   light, adjacent pairs — PASS (worst CVD ΔE 9.1, worst normal-vision 19.6)
 *   dark,  adjacent pairs — PASS (contrast >= 3:1 on all 7)
 *   light, ALL pairs      — FAIL (normal-vision 12.9, below the 15 floor)
 *
 * Consequences, which the chart modules must respect:
 *  - Only adjacent-pairlist forms (bar, stacked, line, donut) may use the
 *    7 categorical hues.
 *  - Treemap is an all-pairs form, so it uses the SEQUENTIAL ramp keyed to
 *    magnitude instead. Dot plot is a single series and uses one hue.
 *  - Three light-mode hues sit below 3:1 contrast, so every chart ships
 *    direct labels and a Table view is always available. That is the
 *    required relief; it is not optional.
 *
 * DO NOT substitute other hexes without re-running the validator.
 */

/** The 7 taxonomy groups map 1:1 onto the 7 categorical slots, in this order. */
export const GROUP_SLOTS = Object.freeze({
  'food-drink': { light: '#2a78d6', dark: '#3987e5' },
  transport:    { light: '#eb6834', dark: '#d95926' },
  home:         { light: '#1baf7a', dark: '#199e70' },
  health:       { light: '#eda100', dark: '#c98500' },
  lifestyle:    { light: '#e87ba4', dark: '#d55181' },
  money:        { light: '#008300', dark: '#008300' },
  other:        { light: '#4a3aa7', dark: '#9085e9' }
});

export const SEQUENTIAL_BLUE = Object.freeze([
  { step: 100, hex: '#cde2fb' }, { step: 150, hex: '#b7d3f6' },
  { step: 200, hex: '#9ec5f4' }, { step: 250, hex: '#86b6ef' },
  { step: 300, hex: '#6da7ec' }, { step: 350, hex: '#5598e7' },
  { step: 400, hex: '#3987e5' }, { step: 450, hex: '#2a78d6' },
  { step: 500, hex: '#256abf' }, { step: 550, hex: '#1c5cab' },
  { step: 600, hex: '#184f95' }, { step: 650, hex: '#104281' },
  { step: 700, hex: '#0d366b' }
]);

export const SURFACES = Object.freeze({ light: '#fcfcfb', dark: '#1a1a19' });

export const TEXT = Object.freeze({
  light: { primary: '#0b0b0b', secondary: '#52514e' },
  dark:  { primary: '#ffffff', secondary: '#c3c2b7' }
});

export const DIVERGING = Object.freeze({
  light: { low: '#2a78d6', mid: '#f0efec', high: '#e34948' },
  dark:  { low: '#3987e5', mid: '#383835', high: '#e66767' }
});

// Ordinal-safe window into the ramp: on light the lightest usable step is 250
// (2.06:1 on the light surface); on dark the darkest usable step is 600.
const ORDINAL_BAND = { light: [3, 12], dark: [0, 10] };

const clamp01 = (n) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

export function colourForGroup(groupId, mode = 'light') {
  const slot = GROUP_SLOTS[groupId] ?? GROUP_SLOTS.other;
  return slot[mode] ?? slot.light;
}

/**
 * Map 0..1 onto the sequential ramp, staying inside the mode's contrast-safe
 * band. 0 is the lightest usable step, 1 the darkest.
 */
export function sequentialColour(fraction, mode = 'light') {
  const [lo, hi] = ORDINAL_BAND[mode] ?? ORDINAL_BAND.light;
  const index = lo + Math.round(clamp01(fraction) * (hi - lo));
  return SEQUENTIAL_BLUE[index].hex;
}

/**
 * A category's colour: its group's hue, stepped by the category's fixed
 * position within that group. Keyed by identity, not by rank in a result set,
 * so filtering never repaints the survivors.
 */
export function colourForCategory(categoryId, groupId, categoriesInGroup, mode = 'light') {
  const base = colourForGroup(groupId, mode);
  const index = categoriesInGroup.indexOf(categoryId);
  if (index <= 0) return base;

  // Step the group hue toward the surface for each subsequent category.
  const total = Math.max(categoriesInGroup.length - 1, 1);
  return mixToward(base, SURFACES[mode] ?? SURFACES.light, (index / total) * 0.55);
}

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const rgbToHex = (rgb) =>
  '#' + rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');

/** Blend `hex` toward `target` by `amount` (0..1). Used for within-group steps. */
export function mixToward(hex, target, amount) {
  const a = hexToRgb(hex);
  const b = hexToRgb(target);
  return rgbToHex(a.map((v, i) => v + (b[i] - v) * clamp01(amount)));
}

/**
 * A `:root`-ready custom-property block for one mode.
 *
 * Nothing calls this today — web/style.css hand-types the same --viz-*
 * values instead, so the two can drift out of sync undetected. Kept rather
 * than deleted: tests/charts-palette.test.js pins its output on purpose,
 * and it's the more maintainable path (inject this into a <style> block at
 * load time) if that drift ever needs fixing. Not fixed here — out of scope
 * for this pass.
 */
export function cssVariables(mode = 'light') {
  const lines = [
    `--viz-surface: ${SURFACES[mode]};`,
    `--viz-text-primary: ${TEXT[mode].primary};`,
    `--viz-text-secondary: ${TEXT[mode].secondary};`,
    `--viz-diverging-low: ${DIVERGING[mode].low};`,
    `--viz-diverging-mid: ${DIVERGING[mode].mid};`,
    `--viz-diverging-high: ${DIVERGING[mode].high};`,
    ...Object.entries(GROUP_SLOTS).map(([id, slot]) => `--viz-group-${id}: ${slot[mode]};`)
  ];
  return lines.join('\n  ');
}

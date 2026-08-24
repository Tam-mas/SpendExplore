import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASELINE_MODES, daysInMonth, shiftMonth, monthWindow, isMonthAligned,
  addDays, addYears, daySpan, shiftWindow, baselineWindows
} from '../lib/query/periods.js';

const AUGUST = { dateFrom: '2026-08-01', dateTo: '2026-08-31' };

test('BASELINE_MODES lists exactly the four supported modes', () => {
  assert.deepEqual([...BASELINE_MODES], ['off', 'prevPeriod', 'trailing3', 'sameLastYear']);
});

test('daysInMonth handles short months and leap Februaries', () => {
  assert.equal(daysInMonth(2026, 8), 31);
  assert.equal(daysInMonth(2026, 6), 30);
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2024, 2), 29);
});

test('shiftMonth crosses year boundaries in both directions', () => {
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-01', -13), '2024-12');
  assert.equal(shiftMonth('2026-11', 2), '2027-01');
  assert.equal(shiftMonth('2026-08', 0), '2026-08');
});

test('monthWindow spans the whole calendar month', () => {
  assert.deepEqual(monthWindow('2026-08'), AUGUST);
  assert.deepEqual(monthWindow('2024-02'), { dateFrom: '2024-02-01', dateTo: '2024-02-29' });
});

test('isMonthAligned accepts only a complete calendar month', () => {
  assert.equal(isMonthAligned(AUGUST), true);
  assert.equal(isMonthAligned({ dateFrom: '2026-08-01', dateTo: '2026-08-30' }), false);
  assert.equal(isMonthAligned({ dateFrom: '2026-08-02', dateTo: '2026-08-31' }), false);
  assert.equal(isMonthAligned({ dateFrom: '2026-07-01', dateTo: '2026-08-31' }), false);
  assert.equal(isMonthAligned({}), false);
});

test('addDays and daySpan agree, and daySpan counts both ends', () => {
  assert.equal(addDays('2026-08-30', 3), '2026-09-02');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(daySpan({ dateFrom: '2026-08-01', dateTo: '2026-08-01' }), 1);
  assert.equal(daySpan({ dateFrom: '2026-08-01', dateTo: '2026-08-07' }), 7);
});

test('addYears clamps 29 February onto a non-leap year', () => {
  assert.equal(addYears('2024-02-29', -1), '2023-02-28');
  assert.equal(addYears('2026-08-15', -1), '2025-08-15');
});

test('shiftWindow moves a month-aligned window by whole months, not by day count', () => {
  // July has 31 days and June has 30. A naive day-span shift would land on
  // 2026-06-30..2026-07-30, which is not June.
  assert.deepEqual(
    shiftWindow({ dateFrom: '2026-07-01', dateTo: '2026-07-31' }, -1),
    { dateFrom: '2026-06-01', dateTo: '2026-06-30' }
  );
});

test('shiftWindow moves a non-aligned window by its own inclusive day span', () => {
  assert.deepEqual(
    shiftWindow({ dateFrom: '2026-08-10', dateTo: '2026-08-16' }, -1),
    { dateFrom: '2026-08-03', dateTo: '2026-08-09' }
  );
});

test('baselineWindows returns one window for prevPeriod and three for trailing3', () => {
  assert.deepEqual(baselineWindows(AUGUST, 'prevPeriod'),
    [{ dateFrom: '2026-07-01', dateTo: '2026-07-31' }]);

  const three = baselineWindows(AUGUST, 'trailing3');
  assert.equal(three.length, 3);
  assert.deepEqual(three[0], { dateFrom: '2026-07-01', dateTo: '2026-07-31' });
  assert.deepEqual(three[2], { dateFrom: '2026-05-01', dateTo: '2026-05-31' });
});

test('baselineWindows shifts a full year back for sameLastYear', () => {
  assert.deepEqual(baselineWindows(AUGUST, 'sameLastYear'),
    [{ dateFrom: '2025-08-01', dateTo: '2025-08-31' }]);
});

test('baselineWindows is empty when off, unknown, or when the window is unbounded', () => {
  assert.deepEqual(baselineWindows(AUGUST, 'off'), []);
  assert.deepEqual(baselineWindows(AUGUST, 'nonsense'), []);
  assert.deepEqual(baselineWindows({}, 'trailing3'), []);
  assert.deepEqual(baselineWindows({ dateFrom: '2026-08-01' }, 'trailing3'), []);
});

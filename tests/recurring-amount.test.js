import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amountProfile } from '../lib/recurring.js';

test('a constant amount profiles as fixed', () => {
  const profile = amountProfile([-16.99, -16.99, -16.99]);
  assert.equal(profile.kind, 'fixed');
  assert.equal(profile.typical, 16.99);
  assert.equal(profile.step, null);
});

test('tiny variation still profiles as fixed', () => {
  // A few cents of rounding is not a price change.
  assert.equal(amountProfile([-16.99, -17.0, -16.99]).kind, 'fixed');
});

test('a single sustained rise profiles as stepped and reports the change', () => {
  const profile = amountProfile([-16.99, -16.99, -18.99, -18.99]);
  assert.equal(profile.kind, 'stepped');
  assert.equal(profile.step.from, 16.99);
  assert.equal(profile.step.to, 18.99);
  assert.equal(profile.step.index, 2);
  // The typical cost is what it costs NOW, not the average of the old and new.
  assert.equal(profile.typical, 18.99);
});

test('a price DROP is reported as a step too', () => {
  const profile = amountProfile([-22.0, -22.0, -15.0, -15.0]);
  assert.equal(profile.kind, 'stepped');
  assert.equal(profile.step.from, 22);
  assert.equal(profile.step.to, 15);
});

test('a fluctuating bill profiles as variable with no step', () => {
  const profile = amountProfile([-180, -260, -195, -240]);
  assert.equal(profile.kind, 'variable');
  assert.equal(profile.step, null);
  assert.equal(profile.min, 180);
  assert.equal(profile.max, 260);
  // A variable series' typical cost is its median, not its latest value.
  assert.equal(profile.typical, 217.5);
});

test('two runs that each fluctuate are variable, not stepped', () => {
  // Only a clean step between two stable runs counts as a price change.
  assert.equal(amountProfile([-180, -260, -300, -420]).kind, 'variable');
});

test('a step needs at least two readings on each side', () => {
  // One high final charge is an anomaly, not an established new price.
  assert.equal(amountProfile([-16.99, -16.99, -16.99, -49.0]).kind, 'variable');
});

test('amountProfile is empty-safe', () => {
  const profile = amountProfile([]);
  assert.equal(profile.kind, 'variable');
  assert.equal(profile.typical, 0);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { matchRule, categoriseTransaction } from '../lib/categorise.js';

const load = async (name) =>
  JSON.parse(await readFile(new URL(`../data/seed/${name}.json`, import.meta.url), 'utf8'));

test('seed categories form a valid two-level taxonomy', async () => {
  const { groups, categories } = await load('categories');
  const groupIds = new Set(groups.map((g) => g.id));
  assert.ok(groups.length >= 7);
  for (const c of categories) {
    assert.ok(groupIds.has(c.groupId), `category ${c.id} references unknown group ${c.groupId}`);
  }
  assert.ok(categories.some((c) => c.id === 'uncategorised'));
  assert.ok(categories.some((c) => c.id === 'income'));
  assert.ok(!categories.some((c) => c.id === 'excluded'), 'exclusion is a flag, not a category');
});

test('every seed rule points at a real category', async () => {
  const { categories } = await load('categories');
  const ids = new Set(categories.map((c) => c.id));
  for (const rule of await load('rules')) {
    assert.ok(ids.has(rule.categoryId), `rule "${rule.value}" -> unknown category ${rule.categoryId}`);
    assert.ok(['exact', 'contains', 'regex'].includes(rule.match));
  }
});

test('seed rules categorise the real sample merchants', async () => {
  const rules = await load('rules');
  const expected = {
    'Coles': 'groceries',
    'Aldi Stores': 'groceries',
    'Ww Metro': 'groceries',
    "Dan Murphy's": 'alcohol',
    'Myki Payments': 'public-transport',
    'Transport Nsw Etoll': 'tolls-parking',
    'Liberty Oil': 'fuel',
    'Chemist Warehouse': 'pharmacy',
    'Ovo Energy': 'energy',
    'Amaysim Mobile': 'internet-phone',
    'Netflix.com': 'subscriptions',
    'Didi Mobility Austral': 'rideshare-taxi',
    'Mcdonalds Brunswick': 'takeaway'
  };
  for (const [merchant, categoryId] of Object.entries(expected)) {
    assert.equal(matchRule(merchant, rules), categoryId, `${merchant} should be ${categoryId}`);
  }
});

test('matching is case-insensitive', () => {
  const rules = [{ match: 'exact', value: 'coles', categoryId: 'groceries' }];
  assert.equal(matchRule('COLES', rules), 'groceries');
  assert.equal(matchRule('Coles', rules), 'groceries');
});

test('first matching rule wins', () => {
  const rules = [
    { match: 'exact', value: 'coles express', categoryId: 'fuel' },
    { match: 'contains', value: 'coles', categoryId: 'groceries' }
  ];
  assert.equal(matchRule('Coles Express', rules), 'fuel');
  assert.equal(matchRule('Coles', rules), 'groceries');
});

test('unmatched merchant returns null', () => {
  assert.equal(matchRule('Sunshine Deli', []), null);
});

test('an invalid regex rule is skipped rather than throwing', () => {
  const rules = [
    { match: 'regex', value: '([unclosed', categoryId: 'groceries' },
    { match: 'exact', value: 'coles', categoryId: 'groceries' }
  ];
  assert.equal(matchRule('Coles', rules), 'groceries');
});

test('spend with no rule is uncategorised', () => {
  const txn = { amount: -22.39, merchant: 'Sunshine Deli' };
  assert.deepEqual(categoriseTransaction(txn, [], new Set()),
    { categoryId: 'uncategorised', categorySource: 'unknown' });
});

test('spend with a rule is categorised from it', () => {
  const rules = [{ match: 'exact', value: 'coles', categoryId: 'groceries' }];
  assert.deepEqual(categoriseTransaction({ amount: -64.15, merchant: 'Coles' }, rules, new Set()),
    { categoryId: 'groceries', categorySource: 'rule' });
});

test('a positive amount from a merchant with prior spend is a refund', () => {
  const rules = [{ match: 'exact', value: 'coles', categoryId: 'groceries' }];
  const result = categoriseTransaction({ amount: 40, merchant: 'Coles' }, rules, new Set(['coles']));
  assert.deepEqual(result, { categoryId: 'groceries', categorySource: 'rule' });
});

test('a positive amount from a merchant with no prior spend is income', () => {
  const rules = [{ match: 'exact', value: 'acme payroll', categoryId: 'groceries' }];
  const result = categoriseTransaction({ amount: 4200, merchant: 'Acme Payroll' }, rules, new Set());
  assert.deepEqual(result, { categoryId: 'income', categorySource: 'rule' });
});

// --- Additional tests over the actual seed data (not hand-picked examples) ---

test('no seed rule is unreachable: no rule is shadowed by an earlier, more general rule', async () => {
  const rules = await load('rules');
  const shadowed = [];

  for (let i = 0; i < rules.length; i++) {
    const earlier = rules[i];
    // Only a 'contains' rule can universally subsume a later rule: any
    // string that satisfies the later rule's match automatically contains
    // the earlier rule's value too, once the earlier value is a substring
    // of the later one.
    if (earlier.match !== 'contains') continue;
    const earlierValue = earlier.value.toLowerCase();

    for (let j = i + 1; j < rules.length; j++) {
      const later = rules[j];
      if (later.match !== 'contains' && later.match !== 'exact') continue;
      const laterValue = later.value.toLowerCase();

      if (laterValue.includes(earlierValue)) {
        shadowed.push(
          `rule #${j} "${later.value}" -> ${later.categoryId} can never fire; ` +
          `rule #${i} "${earlier.value}" -> ${earlier.categoryId} always matches first`
        );
      }
    }
  }

  assert.deepEqual(shadowed, []);
});

test('every seed rule value is lowercase', async () => {
  const rules = await load('rules');
  const notLowercase = rules
    .filter((r) => r.value !== r.value.toLowerCase())
    .map((r) => r.value);
  assert.deepEqual(notLowercase, []);
});

test('seed category ids are unique', async () => {
  const { categories } = await load('categories');
  const ids = categories.map((c) => c.id);
  assert.deepEqual(ids, [...new Set(ids)]);
});

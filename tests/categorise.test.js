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

test('amount of exactly zero is treated as spend, not income', () => {
  // A $0 transaction (fee waiver, balance check, etc.) is not a deposit, so
  // it must not take the income branch, which only exists to stop a real
  // salary/refund deposit being netted against a spending category. With
  // amount 0 there is nothing to net, so it falls to the ordinary rule/
  // uncategorised path like any other non-positive amount.
  const result = categoriseTransaction({ amount: 0, merchant: 'Sunshine Deli' }, [], new Set());
  assert.deepEqual(result, { categoryId: 'uncategorised', categorySource: 'unknown' });
});

test('a positive amount from a merchant with prior spend but no matching rule is uncategorised, not income', () => {
  // Prior spend at this merchant means a positive amount is a refund of
  // that spend, not a fresh deposit — but if no rule recognises the
  // merchant at all, there is no category to refund into, so it still
  // falls through to uncategorised rather than being reclassified as income.
  const result = categoriseTransaction({ amount: 15, merchant: 'Sunshine Deli' }, [], new Set(['sunshine deli']));
  assert.deepEqual(result, { categoryId: 'uncategorised', categorySource: 'unknown' });
});

// --- Regression coverage for the short-token false-positive fix ---
// Several seed rules used to be bare `contains` substrings short enough to
// hit inside an unrelated longer word (e.g. "iga" inside "Newsagency",
// "atm" inside "Batman"). Fixed by converting them to word-boundary regex
// rules. Each case below pins BOTH halves — the false positive is gone AND
// the genuine merchant still matches — so a future simplification can't
// silently regress one while appearing to fix the other.
test('short-token rules no longer produce false positives on unrelated merchants', async () => {
  const rules = await load('rules');
  // None of these merchants share a genuine word with any seed rule, so the
  // correct result is null, not merely "not the old wrong category" — a
  // weaker assertion could pass while the merchant lands on some other
  // wrong category by coincidence.
  const noLongerMatch = [
    'Cardigan Street Newsagency',  // was: "iga" inside "Newsagency" -> groceries
    'Aldinga Beach Newsagency',    // was: "aldi" inside "Aldinga" -> groceries
    'The Eagle Hotel Fitzroy',     // was: "agl" inside "Eagle" -> energy
    'Nagle College Fees',          // was: "agl" inside "Nagle" -> energy
    'Batman Avenue Carpark',       // was: "atm" inside "Batman" -> cash
    'Shellharbour Council Rates',  // was: "shell" inside "Shellharbour" -> fuel
    'Opals Down Under',            // was: "opal" inside "Opals" -> public-transport
    'Accidental Damage Cover'      // was: "dental" inside "Accidental" -> doctors
  ];
  for (const merchant of noLongerMatch) {
    assert.equal(matchRule(merchant, rules), null, `${merchant} should not match any rule`);
  }
});

test('short-token rules still match the genuine merchant they exist for', async () => {
  const rules = await load('rules');
  const stillMatches = {
    'IGA Coburg': 'groceries',
    'Aldi Stores': 'groceries',
    'AGL Energy': 'energy',
    'Wdl Atm Nab': 'cash',
    'BP': 'fuel',        // whole-string match: the old trailing-space guard on "bp " could never match this
    'BP Coburg': 'fuel',
    'Ola Cabs': 'rideshare-taxi',
    'Shell Coburg': 'fuel',
    'Opal Top Up': 'public-transport',
    'Bright Smiles Dental': 'doctors'
  };
  for (const [merchant, categoryId] of Object.entries(stillMatches)) {
    assert.equal(matchRule(merchant, rules), categoryId, `${merchant} should still be ${categoryId}`);
  }
});

// --- Additional tests over the actual seed data (not hand-picked examples) ---

// Extract the literal token a rule matches on, for reachability comparison.
// 'contains'/'exact' rules match literally on their (lower-cased) value. A
// 'regex' rule can only be reasoned about here if it has the simple
// `\bTOKEN\b` shape every seed regex rule uses — any string satisfying
// `\bTOKEN\b` necessarily contains TOKEN as a plain substring too, so an
// earlier 'contains' rule for TOKEN (or a substring of TOKEN) would already
// have matched first. A regex outside that shape is left un-reasoned-about
// (returns null) rather than guessed at.
function coreLiteral(rule) {
  if (rule.match === 'contains' || rule.match === 'exact') return rule.value.toLowerCase();
  if (rule.match === 'regex') {
    const m = /^\\b([a-z0-9 .'-]+)\\b$/i.exec(rule.value);
    return m ? m[1].toLowerCase() : null;
  }
  return null;
}

test('no seed rule is unreachable: no rule is shadowed by an earlier, more general rule', async () => {
  const rules = await load('rules');
  const shadowed = [];

  for (let i = 0; i < rules.length; i++) {
    const earlier = rules[i];
    // Only a 'contains' rule can universally subsume a later rule: any
    // string that satisfies the later rule's match automatically contains
    // the earlier rule's value too, once the earlier value is a substring
    // of the later one. A 'regex' earlier rule is stricter than plain
    // `contains` (it requires word boundaries), so it can never be assumed
    // to universally subsume anything and is excluded as a shadow source.
    if (earlier.match !== 'contains') continue;
    const earlierValue = earlier.value.toLowerCase();

    for (let j = i + 1; j < rules.length; j++) {
      const later = rules[j];
      const laterValue = coreLiteral(later);
      if (laterValue === null) continue;

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

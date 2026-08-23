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

// --- Regression coverage: 'contains' is word-boundary-aware ---
// 'contains' used to be a plain character-sequence substring test, which
// meant a short rule value could match inside an unrelated longer word
// ("iga" inside "Newsagency", "coles" inside "Nicoles Hairdressing").
// Patching individual values to 'regex' as each new case turned up was
// whack-a-mole -- every future rule reopens the hole. The structural fix
// (in lib/categorise.js) makes 'contains' itself test \b<value>\b, so the
// whole class of embedded-substring mis-categorisation is impossible by
// construction rather than patched case by case. These two table-driven
// tests pin both directions against the real seed data, so a future
// simplification can't silently regress one while appearing to fix the
// other.
test('contains rules do not match a rule value embedded inside a longer, unrelated word', async () => {
  const rules = await load('rules');
  const noMatch = [
    'Nicoles Hairdressing',          // "coles" inside "Nicoles"
    'Targeting Solutions Agency',    // "target" inside "Targeting"
    'Amazonite Crystals',            // "amazon" inside "Amazonite"
    'Fruition Financial Planning',   // "fruit" inside "Fruition"
    'Cardigan Street Newsagency',    // "iga" inside "Newsagency"
    'Aldinga Beach Newsagency',      // "aldi" inside "Aldinga"
    'The Eagle Hotel Fitzroy',       // "agl" inside "Eagle"
    'Nagle College Fees',            // "agl" inside "Nagle"
    'Batman Avenue Carpark',         // "atm" inside "Batman"
    'Staff Cafeteria Levy',          // "cafe" inside "Cafeteria"
    'Shellharbour Council Rates',    // "shell" inside "Shellharbour"
    'Opals Down Under',              // "opal" inside "Opals"
    'Accidental Damage Cover'        // "dental" inside "Accidental"
  ];
  for (const merchant of noMatch) {
    assert.equal(matchRule(merchant, rules), null, `${merchant} should not match any rule`);
  }
});

test('contains rules still match the whole word or phrase they exist for', async () => {
  const rules = await load('rules');
  const expected = {
    'Coles': 'groceries',
    'Coles Express': 'fuel',                 // ordering still holds: specific before general
    'IGA Coburg': 'groceries',
    'AGL Energy': 'energy',
    'Atm Nab': 'cash',
    'BP Coburg': 'fuel',
    'BP': 'fuel',                            // whole-string match: no trailing-space guard needed now
    'Ola Cabs': 'rideshare-taxi',
    'Aldi Stores': 'groceries',
    'Netflix.com': 'subscriptions',
    'Ww Metro': 'groceries',
    "Dan Murphy's": 'alcohol',
    'Transport Nsw Etoll': 'tolls-parking',
    'Uber Eats': 'takeaway',
    'Uber': 'rideshare-taxi',
    'Amazon Prime': 'subscriptions',
    'Amazon': 'shopping',
    'Chemist Warehouse': 'pharmacy',
    'Ovo Energy': 'energy',
    'Amaysim Mobile': 'internet-phone',
    'Google Cloud': 'subscriptions',
    'Liberty Oil': 'fuel',
    'Mcdonalds': 'takeaway',
    'Myki Payments': 'public-transport',
    'Bergy Bandroom': 'entertainment',
    'Ten Square Cafe': 'coffee',
    'Dat Thanh Bakery': 'groceries',
    'Mnm Fruit': 'groceries',
    'City Diagnostics': 'doctors',
    'Shell Coburg': 'fuel',
    'Opal Top Up': 'public-transport',
    'Bright Smiles Dental': 'doctors'
  };
  for (const [merchant, categoryId] of Object.entries(expected)) {
    assert.equal(matchRule(merchant, rules), categoryId, `${merchant} should be ${categoryId}`);
  }
});

test('a negated whole word (e.g. "Non-Medical") still matches -- a known limitation, not a boundary bug', async () => {
  // Word-boundary matching fixes "medical" appearing MID-WORD ("biomedical",
  // with no separator at all). It cannot fix "medical" appearing as its own
  // grammatically real word that happens to be negated by a prefix: a
  // hyphen is not a \w character, so \bmedical\b is satisfied by
  // "Non-Medical" exactly as it would be by "Non Medical" with a space.
  // Distinguishing an affirmed word from a negated one is a natural-language
  // problem, not a token-boundary problem -- no `contains`/`regex` rule
  // shape can generically tell "Medical" from "Non-Medical" without a
  // one-off pattern for this specific phrase, which is exactly the
  // whack-a-mole this fix moved away from. Documented here as an accepted
  // limitation (like format-sniff's two-digit-year gap) rather than left
  // silently unverified.
  const rules = await load('rules');
  assert.equal(matchRule('Non-Medical Homecare Services', rules), 'doctors');
});

// --- Additional tests over the actual seed data (not hand-picked examples) ---

test('no seed rule is unreachable: no rule is shadowed by an earlier, more general rule', async () => {
  const rules = await load('rules');
  // Tag every rule with its own index as a stand-in categoryId, then ask
  // the real matchRule which rule actually wins when a merchant is exactly
  // that rule's own value. If some earlier rule (index < j) wins instead,
  // rule j can never fire for its own defining example -- it is
  // unreachable. This reuses matchRule's real matching semantics directly
  // (whatever they are) instead of re-deriving them by hand, so it stays
  // correct automatically if matching semantics change again, and needs no
  // per-match-type special-casing now that every seed rule is 'contains'.
  const indexed = rules.map((r, idx) => ({ ...r, categoryId: idx }));
  const unreachable = [];

  rules.forEach((rule, j) => {
    const winner = matchRule(rule.value, indexed);
    if (winner !== j) {
      unreachable.push(
        `rule #${j} "${rule.value}" -> ${rule.categoryId} is unreachable; ` +
        `rule #${winner} "${rules[winner].value}" -> ${rules[winner].categoryId} matches first`
      );
    }
  });

  assert.deepEqual(unreachable, []);
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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseMerchant, extractCardSuffix } from '../lib/merchant-normalise.js';

const CASES = [
  ['COLES 0592 COBURG VI AUS Card xx4321 Value Date: 14/08/2026', 'Coles'],
  ['COLES 0592               COBURG       AU', 'Coles'],
  ["DAN MURPHY'S    3609 COBURG VI AUS Card xx4321 Value Date: 18/08/2026", "Dan Murphy's"],
  ['MYKI PAYMENTS MELBOURNE  AUS Card xx8765 Value Date: 21/08/2026', 'Myki Payments'],
  ['WW METRO        3438 MELBOURNE VI AUS Card xx4321 Value Date: 19/08/2026', 'Ww Metro'],
  ['ALDI STORES           PRESTON      VICAU', 'Aldi Stores'],
  ['SQ *BERGY BANDROOM          Brunswick AU', 'Bergy Bandroom'],
  ['SMP*DAT THANH BAKERY  0      COBURG03 AU', 'Dat Thanh Bakery'],
  ['LSP*3 Ravens Thornbury AU AUS Card xx4321 Value Date: 06/08/2026', '3 Ravens'],
  ['TRANSPORT NSW ETOLL      PARRAMATTA   AU', 'Transport Nsw Etoll'],
  ['CHEMIST WAREHOUSE PRESTON VI AUS Card xx4321 Value Date: 03/08/2026', 'Chemist Warehouse'],
  ['Direct Debit 604135 OVO ENERGY PTY L OVO4477613290', 'Ovo Energy'],
  ['Netflix.com Melbourne VI AUS Card xx8765 Value Date: 29/07/2026', 'Netflix.com'],
  ['Wdl ATM NAB NAB ATM            94 SYDNEY R    AU', 'Atm Nab'],
  ['AMAYSIM MOBILE PTY LTD', 'Amaysim Mobile'],
  ['Google CLOUD WK2PZP Sydney AU AUS Card xx4321 Value Date: 02/08/2026', 'Google Cloud'],
  ['LIBERTY OIL COBURG  COBURG            AU', 'Liberty Oil'],
  ['DIDI MOBILITY AUSTRAL Melbourne AU AUS Card xx4321 Value Date: 16/08/2026', 'Didi Mobility Austral']
];

for (const [raw, expected] of CASES) {
  test(`normalises: ${raw.slice(0, 34)}`, () => {
    assert.equal(normaliseMerchant(raw), expected);
  });
}

test('collapses all Coles variants to one merchant', () => {
  const variants = [
    'COLES 0592 COBURG VI AUS Card xx4321 Value Date: 14/08/2026',
    'COLES 0592               COBURG       AU',
    'COLES 0592 COBURG VI AUS Card xx4321 Value Date: 29/07/2026'
  ];
  assert.equal(new Set(variants.map(normaliseMerchant)).size, 1);
});

test('never returns an empty string', () => {
  assert.equal(normaliseMerchant('   '), 'Unknown');
  assert.equal(normaliseMerchant('AU AUS'), 'Unknown');
});

test('extracts the card suffix', () => {
  assert.equal(extractCardSuffix('COLES 0592 AUS Card xx4321 Value Date: 14/08/2026'), '4321');
  assert.equal(extractCardSuffix('MYKI PAYMENTS Card xx8765'), '8765');
  assert.equal(extractCardSuffix('AMAYSIM MOBILE PTY LTD'), null);
});

// --- Additional tests beyond the mandated 18, covering behaviour the
// mandated set leaves unpinned. ---

test('a merchant genuinely named after a suburb keeps its name (not trimmed by TRAILING_NOISE)', () => {
  // "Coburg Bakery" is a hypothetical shop whose own name is a suburb that
  // also appears in TRAILING_NOISE. Trailing-noise trimming must only ever
  // remove tokens from the END of the string, so a shop actually called
  // "Coburg Bakery" (bakery is the last, non-noise token) is untouched.
  assert.equal(normaliseMerchant('COBURG BAKERY Melbourne VI AUS Card xx4321 Value Date: 01/08/2026'), 'Coburg Bakery');
});

test('extractCardSuffix returns null when there is no card token at all', () => {
  assert.equal(extractCardSuffix('Direct Debit 604135 OVO ENERGY PTY L OVO4477613290'), null);
});

test('extractCardSuffix returns null for an empty or whitespace-only string', () => {
  assert.equal(extractCardSuffix(''), null);
  assert.equal(extractCardSuffix('   '), null);
});

// --- Fix wave: four defects found in the reference implementation, ratified
// for fixing even though they touch the plan's own reference code. ---

// Fix 1, half A: a brand name that looks like a reference code (all-caps
// alphanumeric, 5+ chars, digit + letter) must survive when it LEADS the
// description — reference codes only ever trail the merchant name.
test('a leading digit+letter brand name is not mistaken for a reference code', () => {
  assert.equal(normaliseMerchant('7ELEVEN COBURG VI AUS Card xx4321'), '7ELEVEN');
  assert.equal(normaliseMerchant('13CABS Melbourne VI AUS Card xx4321'), '13CABS');
});

// Fix 1, half B: a genuine trailing reference code appended by the payment
// terminal is still stripped. Pinned separately from half A so a future
// simplification (e.g. reverting to a blind whole-string regex) can't
// satisfy one half while silently breaking the other.
test('a genuine trailing reference code is still stripped', () => {
  assert.equal(
    normaliseMerchant('Google CLOUD WK2PZP Sydney AU AUS Card xx4321 Value Date: 02/08/2026'),
    'Google Cloud'
  );
  assert.equal(
    normaliseMerchant('SMP*DAT THANH BAKERY  0      COBURG03 AU'),
    'Dat Thanh Bakery'
  );
});

// Fix 2: the token cap was raised from 3 to 4 so long legitimate names keep
// their most identifying word instead of being truncated away.
test('the token cap keeps a 4-word merchant name intact', () => {
  assert.equal(
    normaliseMerchant('THE ROYAL MELBOURNE HOTEL Melbourne VI AUS'),
    'The Royal Melbourne Hotel'
  );
});

// Fix 3: de-duplication only applies when at least 2 tokens survive it, so
// an intentionally repeated brand name isn't collapsed to a single word.
test('an intentionally repeated brand name is not collapsed by de-duplication', () => {
  assert.equal(normaliseMerchant('BAR BAR Melbourne VI AUS'), 'Bar Bar');
});

// Fix 4: normaliseMerchant must be idempotent — re-running it on its own
// output must not change the result. This specific case failed pre-fix
// because raising tokens to fill the cap exposed a TRAILING_NOISE word
// ("Melbourne") at the new end, which only got trimmed on the second pass.
test('normaliseMerchant is idempotent for a case where capping used to expose trailing noise', () => {
  const once = normaliseMerchant('THE ROYAL MELBOURNE HOTEL Melbourne VI AUS');
  assert.equal(normaliseMerchant(once), once);
});

test('normaliseMerchant is idempotent for all 18 mandated raw descriptions', () => {
  for (const [raw] of CASES) {
    const once = normaliseMerchant(raw);
    assert.equal(normaliseMerchant(once), once, `not idempotent for: ${raw}`);
  }
});

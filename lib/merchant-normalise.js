const CARD_SUFFIX_RE = /\bCard\s+xx(\d{4})\b/i;

// Applied in order. Each strips a layer of bank noise from the raw description.
const STRIP_PATTERNS = [
  /\bValue Date:.*$/i,              // trailing settlement date
  /\bCard\s+xx\d{4}\b/i,            // card identifier
  /^Direct Debit\s+\d+\s*/i,        // direct debit prefix + biller number
  /^(?:Wdl|Dep)\s+/i,               // withdrawal / deposit prefix
  /^(?:SQ|SMP|LSP|SP|PAYPAL|PP)\s*\*\s*/i, // payment gateway prefixes
  /\b[A-Z]{3}\d{6,}\b/g,            // biller reference codes e.g. OVO4477613290
  /\b(?:PTY\s+L(?:TD)?|P\/L|LIMITED|LTD|INC)\b/gi // company suffixes
];

// Terminal/reference codes: 5+ uppercase alphanumerics containing at least
// one digit AND one letter, e.g. WK2PZP, COBURG03. These are appended by the
// payment terminal and always TRAIL the merchant name in bank descriptions
// ("Google CLOUD WK2PZP", "DAT THANH BAKERY 0 COBURG03"). Some real merchant
// names look exactly like this too (7ELEVEN, 13CABS) — but a brand name is
// always the LEADING token, never a later one, so this is applied
// positionally over tokens rather than as a blind match over the whole
// string: the first content token is exempt, every later token is checked.
const REFERENCE_CODE_RE = /^(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{5,}$/;

// Location noise removed token-by-token from the END of the string only, so a
// merchant genuinely named after a place (e.g. "Coburg Bakery") keeps its name.
// Note `vi` as well as `vic` — CommBank abbreviates Victoria both ways.
const TRAILING_NOISE = new Set([
  'au', 'aus', 'australia',
  'vi', 'vic', 'nsw', 'qld', 'wa', 'sa', 'tas', 'nt', 'act',
  'vicau', 'nswau', 'qldau', 'waau', 'saau', 'tasau', 'ntau', 'actau',
  'melbourne', 'sydney', 'brisbane', 'perth', 'adelaide', 'hobart', 'canberra', 'darwin',
  'coburg', 'preston', 'thornbury', 'brunswick', 'docklands', 'parramatta',
  'greenwich', 'dandenong', 'balwyn', 'north', 'bella', 'vista', 'r'
]);

function titleCase(text) {
  return text
    .split(' ')
    .map((word) => {
      if (word === '') return word;
      if (/^\d/.test(word)) return word;             // keep "3 Ravens" numeric
      if (word.includes('.')) {                       // keep "Netflix.com"
        return word[0].toUpperCase() + word.slice(1).toLowerCase();
      }
      return word[0].toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

/** Extract the last four digits of the card used, or null. */
export function extractCardSuffix(rawDescription) {
  const match = String(rawDescription ?? '').match(CARD_SUFFIX_RE);
  return match ? match[1] : null;
}

/**
 * Reduce a raw bank description to a stable, human-readable merchant name.
 * All six Coles description variants in a statement collapse to "Coles".
 */
export function normaliseMerchant(rawDescription) {
  let s = String(rawDescription ?? '');

  for (const pattern of STRIP_PATTERNS) s = s.replace(pattern, ' ');

  s = s.replace(/[‘’]/g, "'");
  s = s.replace(/\s+/g, ' ').trim();

  let tokens = s.split(' ').filter(Boolean);

  // Strip trailing reference codes positionally: never the first content
  // token (a brand name that looks like a code, e.g. 7ELEVEN/13CABS, always
  // leads), but any later token is fair game.
  tokens = tokens.filter((tok, idx) => idx === 0 || !REFERENCE_CODE_RE.test(tok));

  // Drop trailing location/country noise and bare store numbers.
  while (tokens.length) {
    const last = tokens[tokens.length - 1].toLowerCase().replace(/[^a-z0-9']/g, '');
    if (TRAILING_NOISE.has(last) || /^\d{1,6}$/.test(last) || last === '') tokens.pop();
    else break;
  }

  // Drop interior store numbers (COLES 0592 COBURG -> COLES COBURG) but keep a
  // leading number, which is usually part of the name (3 Ravens).
  tokens = tokens.filter((tok, idx) => idx === 0 || !/^\d{3,6}$/.test(tok));

  // Re-run trailing cleanup now that store numbers are gone.
  while (tokens.length) {
    const last = tokens[tokens.length - 1].toLowerCase().replace(/[^a-z0-9']/g, '');
    if (TRAILING_NOISE.has(last) || /^\d{1,6}$/.test(last) || last === '') tokens.pop();
    else break;
  }

  // Banks repeat the merchant name inside one description
  // ("ATM NAB NAB ATM"). Keep the first occurrence of each token, but only
  // apply de-duplication when at least two tokens survive it — otherwise an
  // intentionally repeated brand name ("BAR BAR") would collapse to one word.
  const seen = new Set();
  const deduped = tokens.filter((tok) => {
    const key = tok.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (deduped.length >= 2) tokens = deduped;

  // Cap length: bank descriptions pad with detail the merchant name never needs.
  if (tokens.length > 4) tokens = tokens.slice(0, 4);

  // Re-run trailing-noise trim after capping: truncation can expose a
  // TRAILING_NOISE token at the new end that was previously interior (not
  // trailing) before the cap removed what followed it. Skipping this step
  // would make the function non-idempotent — re-normalising its own output
  // could strip further noise the first pass missed.
  while (tokens.length) {
    const last = tokens[tokens.length - 1].toLowerCase().replace(/[^a-z0-9']/g, '');
    if (TRAILING_NOISE.has(last) || /^\d{1,6}$/.test(last) || last === '') tokens.pop();
    else break;
  }

  const result = titleCase(tokens.join(' ')).trim();
  return result === '' ? 'Unknown' : result;
}

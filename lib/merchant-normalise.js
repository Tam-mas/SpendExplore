const CARD_SUFFIX_RE = /\bCard\s+xx(\d{4})\b/i;

// Applied in order. Each strips a layer of bank noise from the raw description.
// Note: entries anchored at the start of the string (source begins with `^`)
// are treated specially below — see `strippedFromFront` in normaliseMerchant.
// This is detected structurally rather than by naming individual patterns,
// so a future front-anchored addition here can't silently reopen the
// reference-code leak fixed below without anyone touching that logic.
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
// always the LEADING token of the raw description, never a later one, so
// this is applied positionally over tokens rather than as a blind match
// over the whole string: the first content token is exempt, UNLESS some
// front-anchored bank prefix (Direct Debit, Wdl/Dep, a payment-gateway
// marker, ...) was stripped ahead of it — in that case token 0 is only
// "leading" because unrelated noise was removed in front of it, not because
// it's genuinely the first content token, so it gets the same treatment as
// every later token. See `strippedFromFront` in normaliseMerchant.
//
// Case-sensitive on purpose (no `i` flag): titleCase() only ever produces
// mixed-case output, so an already-normalised string can never re-match
// this pattern on a second pass. That is load-bearing for idempotency — do
// not add the `i` flag.
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

// Drop trailing location/country noise and bare store numbers, one token at
// a time, from the END of the token list only. Mutates nothing — returns a
// new trimmed array — and is safe to call repeatedly (idempotent on its own
// output), which is why it is called from three separate points below.
function trimTrailingNoise(tokens) {
  const trimmed = tokens.slice();
  while (trimmed.length) {
    const last = trimmed[trimmed.length - 1].toLowerCase().replace(/[^a-z0-9']/g, '');
    if (TRAILING_NOISE.has(last) || /^\d{1,6}$/.test(last) || last === '') trimmed.pop();
    else break;
  }
  return trimmed;
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

  // Any STRIP_PATTERNS entry anchored at the start of the string (its
  // regex source begins with `^`) removes bank prefix noise — a Direct
  // Debit biller number, a Wdl/Dep marker, a payment-gateway tag, or any
  // future addition of the same shape. Whenever one of those actually
  // matches, whatever token ends up at index 0 afterwards is only
  // "leading" because that noise was stripped in front of it — it is not
  // necessarily the genuine first content token of the raw description.
  // Track that with a single flag, computed structurally from every
  // front-anchored pattern rather than by naming specific ones, so a new
  // front-anchored pattern added later can't silently reopen the
  // reference-code leak this flag exists to prevent.
  let strippedFromFront = false;
  for (const pattern of STRIP_PATTERNS) {
    if (pattern.source.startsWith('^') && pattern.test(s)) strippedFromFront = true;
    s = s.replace(pattern, ' ');
  }

  s = s.replace(/[‘’]/g, "'");
  s = s.replace(/\s+/g, ' ').trim();

  let tokens = s.split(' ').filter(Boolean);

  // Strip trailing reference codes positionally: never the first content
  // token (a brand name that looks like a code, e.g. 7ELEVEN/13CABS, always
  // leads) — unless a front-anchored bank prefix was stripped ahead of it,
  // in which case token 0 is not genuinely leading and gets the same
  // treatment as every later token.
  tokens = tokens.filter((tok, idx) =>
    (idx === 0 && !strippedFromFront) || !REFERENCE_CODE_RE.test(tok)
  );

  tokens = trimTrailingNoise(tokens);

  // Drop interior store numbers (COLES 0592 COBURG -> COLES COBURG) but keep a
  // leading number, which is usually part of the name (3 Ravens).
  tokens = tokens.filter((tok, idx) => idx === 0 || !/^\d{3,6}$/.test(tok));

  // Re-run trailing cleanup now that store numbers are gone.
  tokens = trimTrailingNoise(tokens);

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
  tokens = trimTrailingNoise(tokens);

  const result = titleCase(tokens.join(' ')).trim();
  return result === '' ? 'Unknown' : result;
}

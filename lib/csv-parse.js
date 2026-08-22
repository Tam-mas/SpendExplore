/**
 * Parse CSV text into rows of raw string fields.
 * Handles quoted fields, embedded commas and newlines, escaped quotes ("")
 * and both LF and CRLF line endings. Does not interpret headers or types.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let seenAnyChar = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') { inQuotes = true; seenAnyChar = true; continue; }
    if (ch === ',') { row.push(field); field = ''; seenAnyChar = true; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') {
      row.push(field);
      if (seenAnyChar) rows.push(row);
      row = []; field = ''; seenAnyChar = false;
      continue;
    }
    field += ch;
    if (ch.trim() !== '') seenAnyChar = true;
  }

  row.push(field);
  if (seenAnyChar) rows.push(row);
  return rows;
}

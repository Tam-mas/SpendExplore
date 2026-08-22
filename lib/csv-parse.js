/**
 * Parse CSV text into rows of raw string fields.
 * Handles quoted fields, embedded commas and newlines, escaped quotes ("")
 * and both LF and CRLF line endings. Does not interpret headers or types.
 * A bare `"` mid-field (not at the start of a field) is treated as a literal
 * character rather than a quote-open, matching Excel's behaviour.
 * Strips a single leading UTF-8 BOM, since Excel-exported bank CSVs commonly
 * carry one and it would otherwise corrupt the first header/field.
 * Lone CR (classic Mac) line endings are not treated as row breaks — only
 * LF and CRLF are supported; this is a documented limitation, not a bug.
 */
export function parseCsv(text) {
  if (text.startsWith('﻿')) text = text.slice(1);

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

    if (ch === '"') {
      if (field === '') { inQuotes = true; }
      else { field += ch; }
      seenAnyChar = true;
      continue;
    }
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

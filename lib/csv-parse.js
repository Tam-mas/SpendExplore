/**
 * Parse CSV text into records that carry each row's fields plus the 1-based
 * physical source line on which that record STARTS. This is the one real
 * parser; `parseCsv` below is a thin projection onto `fields` for callers
 * that only need `string[][]`.
 *
 * Handles quoted fields, embedded commas and newlines, escaped quotes ("")
 * and both LF and CRLF line endings. Does not interpret headers or types.
 * A bare `"` mid-field (not at the start of a field) is treated as a literal
 * character rather than a quote-open, matching Excel's behaviour.
 * Strips a single leading UTF-8 BOM, since Excel-exported bank CSVs commonly
 * carry one and it would otherwise corrupt the first header/field.
 * Lone CR (classic Mac) line endings are not treated as row breaks — only
 * LF and CRLF are supported; this is a documented limitation, not a bug.
 *
 * A record's `line` is the physical line its first character sits on, even
 * when the record itself spans several physical lines because a quoted
 * field contains an embedded newline. Fully blank (or whitespace-only)
 * physical lines between records are dropped and do not become records of
 * their own, but they still count when tracking where the NEXT record
 * starts.
 */
export function parseCsvWithLines(text) {
  if (text.startsWith('﻿')) text = text.slice(1);

  const records = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let seenAnyChar = false;
  let line = 1;
  let rowStartLine = 1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        if (ch === '\n') line++;
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
      if (seenAnyChar) records.push({ fields: row, line: rowStartLine });
      row = []; field = ''; seenAnyChar = false;
      line++;
      rowStartLine = line;
      continue;
    }
    field += ch;
    if (ch.trim() !== '') seenAnyChar = true;
  }

  row.push(field);
  if (seenAnyChar) records.push({ fields: row, line: rowStartLine });
  return records;
}

/** Parse CSV text into rows of raw string fields, discarding line numbers. */
export function parseCsv(text) {
  return parseCsvWithLines(text).map((record) => record.fields);
}

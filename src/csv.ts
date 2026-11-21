/**
 * RFC 4180 CSV: a small, zero-dependency parser and serializer.
 *
 * - Fields may be quoted with `"`; quotes inside quoted fields are doubled.
 * - Quoted fields may contain the delimiter, `\r`, and `\n`.
 * - Rows end in `\r\n` or `\n` (both accepted; {@link stringifyCsv} writes `\r\n`).
 * - A leading UTF-8 BOM is ignored; a trailing newline does not add an empty row.
 *
 * @module
 */

/** Options for {@link parseCsv}. */
export interface ParseCsvOptions {
  /** Field delimiter. Default `","`. */
  delimiter?: string;
}

/** Thrown for malformed CSV (an unterminated quoted field). */
export class CsvParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvParseError";
  }
}

/** Parse CSV text into rows of fields. */
export function parseCsv(text: string, options: ParseCsvOptions = {}): string[][] {
  const delimiter = options.delimiter ?? ",";
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let fieldStarted = false;
  let i = 0;
  const endField = () => {
    row.push(field);
    field = "";
    fieldStarted = false;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  while (i < input.length) {
    const c = input[i] as string;
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"' && !fieldStarted && field === "") {
      quoted = true;
      fieldStarted = true;
      i++;
      continue;
    }
    if (input.startsWith(delimiter, i)) {
      endField();
      i += delimiter.length;
      continue;
    }
    if (c === "\r" && input[i + 1] === "\n") {
      endRow();
      i += 2;
      continue;
    }
    if (c === "\n" || c === "\r") {
      endRow();
      i++;
      continue;
    }
    field += c;
    fieldStarted = true;
    i++;
  }
  if (quoted) throw new CsvParseError("Unterminated quoted field");
  if (field !== "" || fieldStarted || row.length > 0) endRow();
  return rows;
}

/**
 * Parse CSV with a header row into records keyed by header. Blank lines are
 * skipped; missing trailing fields read as `""`.
 */
export function parseCsvRecords(
  text: string,
  options: ParseCsvOptions = {},
): { headers: string[]; records: Record<string, string>[] } {
  const rows = parseCsv(text, options).filter((r) => !(r.length === 1 && r[0] === ""));
  const [head, ...body] = rows;
  if (!head) return { headers: [], records: [] };
  const headers = head.map((h) => h.trim());
  const records = body.map((r) => {
    const record: Record<string, string> = {};
    headers.forEach((h, idx) => {
      record[h] = r[idx] ?? "";
    });
    return record;
  });
  return { headers, records };
}

/** A value {@link stringifyCsv} can write. `null`/`undefined` become empty fields. */
export type CsvValue = string | number | boolean | null | undefined;

/** Quote a field when it contains the delimiter, a quote, or a line break. */
export function csvField(value: CsvValue, delimiter = ","): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return s.includes(delimiter) || /["\r\n]/.test(s) || /^\s|\s$/.test(s)
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

/** Serialize rows to CSV (`\r\n` line endings, trailing newline). */
export function stringifyCsv(rows: readonly (readonly CsvValue[])[], delimiter = ","): string {
  return rows.map((r) => r.map((v) => csvField(v, delimiter)).join(delimiter) + "\r\n").join("");
}

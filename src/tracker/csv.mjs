import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Generalized CSV tracker adapter for ApplyKit.
 *
 * Each user owns one tracker file. Rows are keyed by a stable URL column
 * (default "Job URL"). The parser is RFC-4180-style: it correctly handles
 * quoted fields, escaped quotes (""), and newlines inside quoted fields.
 *
 * This is a person-agnostic refactor of the source CsvAdapter — the column
 * schema is declared here rather than implied by one user's spreadsheet.
 */

export const TRACKER_COLUMNS = [
  "Company",
  "Job Title",
  "Location",
  "Status",
  "Source URL",
  "Job URL",
  "Materials Directory",
  "Fit Score",
  "Band",
  "Date Added",
  "Date Applied",
  "Follow Up Notes",
];

export const STATUS_VALUES = [
  "Discovered",
  "Evaluated",
  "Ready to Apply",
  "Applied",
  "Responded",
  "Interview",
  "Offer",
  "Rejected",
  "Discarded",
];

export class CsvTracker {
  /**
   * @param {object} [options]
   * @param {string} [options.path] - tracker file path
   * @param {string} [options.keyColumn] - unique key column (default "Job URL")
   * @param {string[]} [options.columns] - header schema (default TRACKER_COLUMNS)
   */
  constructor(options = {}) {
    this.path = options.path || process.env.APPLYKIT_TRACKER || "tracker.csv";
    this.keyColumn = options.keyColumn || "Job URL";
    this.columns = options.columns || TRACKER_COLUMNS;
  }

  /** Create the tracker file with a header row if it does not exist. */
  bootstrap() {
    if (existsSync(this.path)) return false;
    const dir = path.dirname(this.path);
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.path, `${this.columns.map(escapeField).join(",")}\n`, "utf8");
    return true;
  }

  /** @returns {string[]} header columns from the file (or the configured schema) */
  getHeaders() {
    if (!existsSync(this.path)) return [...this.columns];
    const text = readFileSync(this.path, "utf8");
    const { headers } = parseRecords(text);
    return headers.length ? headers : [...this.columns];
  }

  /** @returns {object[]} all rows as objects keyed by header */
  readAll() {
    if (!existsSync(this.path)) return [];
    const text = readFileSync(this.path, "utf8");
    const { headers, rows } = parseRecords(text);
    return rows.map((row) =>
      Object.fromEntries(headers.map((header, i) => [header, row[i] ?? ""])),
    );
  }

  /**
   * Append a row. Skips (returns false) when a row with the same key already
   * exists. Creates the file with headers if missing.
   * @param {object} row
   * @returns {boolean} true if appended
   */
  appendRow(row) {
    this.bootstrap();
    const text = readFileSync(this.path, "utf8");
    const { headers, rows } = parseRecords(text);
    const keyIndex = headers.indexOf(this.keyColumn);
    const keyValue = row[this.keyColumn] ?? "";

    if (keyIndex >= 0 && keyValue && rows.some((existing) => existing[keyIndex] === keyValue)) {
      return false;
    }

    const values = headers.map((header) => row[header] ?? "");
    writeFileSync(this.path, `${text.trimEnd()}\n${values.map(escapeField).join(",")}\n`, "utf8");
    return true;
  }

  /**
   * Update the first row matching `keyValue` in the key column.
   * @param {string} keyValue
   * @param {object} updates - column -> value
   * @returns {boolean} true if a row was updated
   */
  updateRow(keyValue, updates) {
    if (!existsSync(this.path)) return false;
    const text = readFileSync(this.path, "utf8");
    const { headers, rows } = parseRecords(text);
    const keyIndex = headers.indexOf(this.keyColumn);
    if (keyIndex < 0) return false;

    let found = false;
    for (const row of rows) {
      if (row[keyIndex] === keyValue) {
        for (const [col, value] of Object.entries(updates)) {
          const idx = headers.indexOf(col);
          if (idx >= 0) row[idx] = value;
        }
        found = true;
        break;
      }
    }
    if (!found) return false;

    const out = [
      headers.map(escapeField).join(","),
      ...rows.map((row) => row.map(escapeField).join(",")),
    ].join("\n") + "\n";
    writeFileSync(this.path, out, "utf8");
    return true;
  }
}

/**
 * Record-aware CSV tokenizer (RFC-4180-style). A newline inside a quoted field
 * is treated as field data, not a record boundary. Escaped quotes ("") decode
 * to a single quote. A trailing newline produces no spurious empty row.
 *
 * @param {string} text
 * @returns {{ headers: string[], rows: string[][] }}
 */
export function parseRecords(text) {
  const records = [];
  let record = [];
  let current = "";
  let inQuotes = false;
  let sawAny = false;

  const endField = () => {
    record.push(current);
    current = "";
  };
  const endRecord = () => {
    endField();
    if (sawAny) records.push(record);
    record = [];
    sawAny = false;
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
      sawAny = true;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      sawAny = true;
    } else if (char === ",") {
      endField();
      sawAny = true;
    } else if (char === "\n") {
      endRecord();
    } else if (char === "\r" && text[i + 1] === "\n") {
      // CRLF: drop the CR; the following LF closes the record.
    } else {
      current += char;
      sawAny = true;
    }
  }

  if (sawAny || record.length > 0 || current !== "") {
    endField();
    records.push(record);
  }

  return {
    headers: records.length > 0 ? records[0] : [],
    rows: records.slice(1),
  };
}

export function escapeField(value) {
  let s = String(value ?? "");
  // OWASP CSV-injection mitigation: a value beginning with a formula trigger
  // (= + - @) or a control char (tab/CR) is prefixed with a single quote so a
  // spreadsheet treats it as text, not a formula. The tracker holds externally
  // sourced data (scraped company/title/location) and user notes, and is meant
  // to be opened in Excel/Sheets.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

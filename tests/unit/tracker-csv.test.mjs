import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { CsvTracker, parseRecords, escapeField, TRACKER_COLUMNS } from "../../src/tracker/csv.mjs";

let dir;
let csvPath;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "applykit-csv-"));
  csvPath = path.join(dir, "tracker.csv");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("CsvTracker", () => {
  it("bootstraps a header-only file", () => {
    const t = new CsvTracker({ path: csvPath });
    assert.equal(t.bootstrap(), true);
    assert.equal(t.bootstrap(), false); // idempotent
    assert.deepEqual(t.getHeaders(), TRACKER_COLUMNS);
    assert.deepEqual(t.readAll(), []);
  });

  it("appends rows and dedupes by key column", () => {
    const t = new CsvTracker({ path: csvPath });
    assert.equal(t.appendRow({ Company: "Acme", "Job URL": "https://a/1" }), true);
    assert.equal(t.appendRow({ Company: "Acme2", "Job URL": "https://a/1" }), false); // dup key
    assert.equal(t.appendRow({ Company: "Beta", "Job URL": "https://a/2" }), true);
    const rows = t.readAll();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].Company, "Acme");
  });

  it("updates a row by key", () => {
    const t = new CsvTracker({ path: csvPath });
    t.appendRow({ Company: "Acme", "Job URL": "https://a/1", Status: "Discovered" });
    assert.equal(t.updateRow("https://a/1", { Status: "Applied", "Fit Score": "4.2" }), true);
    assert.equal(t.updateRow("https://nope", { Status: "X" }), false);
    const row = t.readAll()[0];
    assert.equal(row.Status, "Applied");
    assert.equal(row["Fit Score"], "4.2");
  });

  it("round-trips quoted fields with commas and newlines", () => {
    const t = new CsvTracker({ path: csvPath });
    const notes = 'line1\nline2, with comma and "quotes"';
    t.appendRow({ Company: "Acme, Inc.", "Job URL": "https://a/1", "Follow Up Notes": notes });
    const row = t.readAll()[0];
    assert.equal(row.Company, "Acme, Inc.");
    assert.equal(row["Follow Up Notes"], notes);
  });

  it("neutralizes spreadsheet formula-injection payloads", () => {
    const t = new CsvTracker({ path: csvPath });
    t.appendRow({ Company: "=HYPERLINK(\"http://evil\",\"x\")", "Job URL": "https://a/1" });
    t.appendRow({ Company: "@SUM(A1:A9)", "Job URL": "https://a/2" });
    t.appendRow({ Company: "+1+1", "Job URL": "https://a/3" });
    t.appendRow({ Company: "-2+3", "Job URL": "https://a/4" });

    // On disk, each dangerous leading char is neutralized with a leading quote.
    const raw = readFileSync(csvPath, "utf8");
    for (const line of raw.split("\n").slice(1).filter(Boolean)) {
      assert.doesNotMatch(line, /^(=|@|\+|-)/, `raw line must not start with a formula trigger: ${line}`);
    }
    // Round-trip still yields the (neutralized) values without data loss of meaning.
    const rows = t.readAll();
    assert.equal(rows.length, 4);
    assert.ok(rows[0].Company.includes("HYPERLINK"));
  });
});

describe("parseRecords / escapeField", () => {
  it("treats a trailing newline without producing an empty row", () => {
    const { headers, rows } = parseRecords("a,b\n1,2\n");
    assert.deepEqual(headers, ["a", "b"]);
    assert.equal(rows.length, 1);
  });

  it("decodes escaped quotes", () => {
    const { rows } = parseRecords('a\n"he said ""hi"""\n');
    assert.equal(rows[0][0], 'he said "hi"');
  });

  it("escapeField only quotes when needed", () => {
    assert.equal(escapeField("plain"), "plain");
    assert.equal(escapeField("a,b"), '"a,b"');
    assert.equal(escapeField('a"b'), '"a""b"');
  });

  it("readAll on a missing file returns []", () => {
    const t = new CsvTracker({ path: path.join(dir, "missing.csv") });
    assert.deepEqual(t.readAll(), []);
  });
});

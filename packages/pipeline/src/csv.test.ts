import { describe, expect, test } from "vitest";
import { csvCell, csvRow, CSV_BOM, BUSINESS_COLUMNS } from "./csv";

describe("csvCell", () => {
  test("passes a plain value through unquoted", () => {
    expect(csvCell("Cafe")).toBe("Cafe");
  });

  test("quotes a value containing a comma", () => {
    // Dubai addresses are full of commas; unquoted they shift every later
    // column and the file opens misaligned.
    expect(csvCell("Shop 2, Marina Walk")).toBe('"Shop 2, Marina Walk"');
  });

  test("doubles an embedded quote, per RFC 4180", () => {
    expect(csvCell('The "Best" Cafe')).toBe('"The ""Best"" Cafe"');
  });

  test("quotes a value containing a newline", () => {
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  test("renders an array as a semicolon list", () => {
    expect(csvCell(["a", "b"])).toBe("a; b");
  });

  test("renders undefined and null as empty", () => {
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(null)).toBe("");
  });
});

describe("csvRow", () => {
  test("joins cells with commas and ends the line", () => {
    expect(csvRow(["a", "b,c"])).toBe('a,"b,c"\n');
  });
});

describe("CSV_BOM", () => {
  test("is the UTF-8 byte order mark", () => {
    // Without it, Arabic business names open as mojibake in Excel.
    expect(CSV_BOM).toBe("﻿");
  });
});

describe("BUSINESS_COLUMNS", () => {
  test("includes the fields an outreach list actually needs", () => {
    for (const column of ["title", "phoneE164", "website", "l2", "area"]) {
      expect(BUSINESS_COLUMNS).toContain(column);
    }
  });
});

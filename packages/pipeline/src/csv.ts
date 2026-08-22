/**
 * CSV writing, shared by the export and leads CLIs.
 *
 * Extracted rather than duplicated: two copies of quoting rules drift, and the
 * failure mode is a file that opens misaligned in Excel — which is where these
 * files get used.
 */

/**
 * UTF-8 byte order mark.
 *
 * Excel on a default Windows install does not detect UTF-8 without it, so every
 * Arabic business name renders as mojibake.
 */
export const CSV_BOM = "﻿";

export const BUSINESS_COLUMNS = [
  "placeId",
  "title",
  "l1",
  "l2",
  "l3",
  "area",
  "address",
  "phoneE164",
  "phoneRaw",
  "phoneType",
  "website",
  "domain",
  "rating",
  "reviews",
  "lat",
  "lng",
  "accessibility",
  "payments",
  "services",
] as const;

/** RFC 4180 quoting. Required: addresses contain commas, titles contain quotes. */
export function csvCell(value: unknown): string {
  if (value === undefined || value === null) return "";
  const text = Array.isArray(value) ? value.join("; ") : String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function csvRow(values: readonly unknown[]): string {
  return values.map(csvCell).join(",") + "\n";
}

/**
 * Export your crawl.
 *
 *   pnpm export --format csv     > dubai.csv
 *   pnpm export --format json
 *   pnpm export --format ndjson
 *   pnpm export --format csv --category Pharmacies --area deira
 *
 * WHY THIS IS ALLOWED, when ADR 0002 forbids redistributing the dataset.
 *
 * The distinction is whose crawl it is. This repository ships the machine, not
 * the data: you point it at a city, spend your own SearchApi credits, and the
 * result is yours to take. Exporting it is not redistribution — nobody is
 * handing you someone else's dataset.
 *
 * The line that must not be crossed is a download button on a hosted
 * deployment. That would be publishing a copy of Google's data to the world,
 * which is exactly what ADR 0002 exists to prevent. Export belongs in the CLI,
 * where it is the operator taking their own output.
 */
import { createWriteStream, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Business } from "@directory/core";
import { BUSINESS_COLUMNS, CSV_BOM, csvRow } from "../csv";

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};

const format = (flag("--format") ?? "csv").toLowerCase();
const category = flag("--category");
const area = flag("--area");
const out = flag("--out");

const root = new URL("../../../../", import.meta.url);
const source = fileURLToPath(new URL("data/out/businesses.json", root));

let businesses: Business[];
try {
  businesses = JSON.parse(readFileSync(source, "utf8")) as Business[];
} catch {
  console.error(
    "No data/out/businesses.json.\n" +
      "Run `pnpm crawl --yes` then `pnpm load`, or `pnpm load --from-archive`\n" +
      "to rebuild from responses you have already fetched.\n",
  );
  process.exit(1);
}

if (category) {
  const needle = category.toLowerCase();
  businesses = businesses.filter(
    (b) => b.l2?.toLowerCase() === needle || b.l3?.toLowerCase() === needle,
  );
}
if (area) {
  const needle = area.toLowerCase();
  businesses = businesses.filter((b) => b.area.toLowerCase() === needle);
}

const stream = out ? createWriteStream(out) : process.stdout;

function write(line: string) {
  stream.write(line);
}

if (format === "csv") {
  write(CSV_BOM);
  write(csvRow(BUSINESS_COLUMNS));
  for (const b of businesses) {
    write(csvRow(BUSINESS_COLUMNS.map((c) => b[c as keyof Business])));
  }
} else if (format === "ndjson") {
  for (const b of businesses) write(JSON.stringify(b) + "\n");
} else if (format === "json") {
  write(JSON.stringify(businesses, null, 2) + "\n");
} else {
  console.error(`Unknown --format "${format}". Use csv, json, or ndjson.\n`);
  process.exit(1);
}

if (out) {
  stream.end();
  console.error(
    `Exported ${businesses.length.toLocaleString()} businesses as ${format} to ${out}\n`,
  );
} else {
  // Progress goes to stderr so `pnpm export > file.csv` stays clean.
  console.error(
    `\nExported ${businesses.length.toLocaleString()} businesses as ${format}.\n`,
  );
}

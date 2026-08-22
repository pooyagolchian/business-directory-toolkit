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
import {
  dropSuppressed,
  parseSuppressionList,
  type Business,
} from "@directory/core";
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

/**
 * Re-filter suppressed businesses at read time, the same way leads.ts does.
 *
 * TAKEDOWN.md promises a place_id is removed the same day as a takedown
 * request, but `data/out/businesses.json` is only re-filtered the next time
 * `pnpm load` runs — so between a takedown and the next load, that business
 * is still sitting in the file on disk. `pnpm leads` already re-filters at
 * read time to close exactly this window; `pnpm export` did not, so it could
 * write a removed business's name, phone, and address into a CSV an operator
 * shares, even though the load step had already dropped it from every other
 * output. A missing or malformed list fails the run rather than silently
 * exporting unfiltered — the same reasoning as leads.ts: continuing without
 * suppression is exactly the moment it would go unnoticed.
 */
const suppressionPath = fileURLToPath(
  new URL("data/suppression-list.json", root),
);
let suppressed: Set<string>;
try {
  suppressed = parseSuppressionList(readFileSync(suppressionPath, "utf8"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === "ENOENT") {
    console.error(
      "\ndata/suppression-list.json is missing. This file IS tracked in git\n" +
        "(`git ls-files data/` confirms every clone and fork has it), so its\n" +
        "absence means something is wrong with this checkout — not that no\n" +
        "takedowns exist yet. Exporting without it risks writing a removed\n" +
        "business into a CSV an operator shares. Restore the file — an empty\n" +
        "`[]` is the correct state when there are no takedowns — before running\n" +
        "this again.\n",
    );
  } else {
    console.error(
      `\ndata/suppression-list.json could not be loaded: ${(error as Error).message}\n` +
        "A malformed takedown list is a hard stop rather than an empty one.\n",
    );
  }
  process.exit(1);
}
const withheld = dropSuppressed(businesses, suppressed);
businesses = withheld.kept;

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

// The withheld count prints unconditionally, including "0 withheld" — same
// reasoning as leads.ts: a line that only appears when there is something to
// hide would read as the filter mattering only when it bites.
const withheldLine = `${withheld.removed.toLocaleString()} withheld by the suppression list (takedown requests).`;

if (out) {
  stream.end();
  console.error(
    `Exported ${businesses.length.toLocaleString()} businesses as ${format} to ${out}\n${withheldLine}\n`,
  );
} else {
  // Progress goes to stderr so `pnpm export > file.csv` stays clean.
  console.error(
    `\nExported ${businesses.length.toLocaleString()} businesses as ${format}.\n${withheldLine}\n`,
  );
}

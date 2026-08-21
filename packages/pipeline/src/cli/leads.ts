/**
 * Find and rank prospects from your own crawl.
 *
 *   pnpm leads --list-signals
 *   pnpm leads --signal no-website --category Restaurants --min-reviews 20
 *   pnpm leads --signal weak-reputation --format csv --out leads.csv
 *
 * Reads data/out/businesses.json. No network, no credits.
 *
 * Exactly one --signal is accepted. Scores are comparable only within a
 * signal: a no-website score and a weak-reputation score describe different
 * products sold to different buyers, so ranking them together is meaningless.
 */
import { createWriteStream, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  corpusPrior,
  findLeads,
  parseSuppressionList,
  LEAD_SIGNALS,
  type Business,
  type LeadSignal,
} from "@directory/core";
import { BUSINESS_COLUMNS, CSV_BOM, csvRow } from "../csv";

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};

if (argv.includes("--list-signals")) {
  console.log(`\nAvailable signals:\n`);
  console.log(`  no-website        No website listed — web design, agencies`);
  console.log(
    `  weak-reputation   Rated under 3.8 with 20+ reviews — reputation management`,
  );
  console.log(
    `  low-visibility    Fewer than 10 reviews — local SEO, review generation`,
  );
  console.log(
    `  no-hours          No opening hours listed — listing management\n`,
  );
  process.exit(0);
}

const signal = flag("--signal") as LeadSignal | undefined;
if (!signal || !LEAD_SIGNALS.includes(signal)) {
  console.error(
    `\n--signal is required and must be one of: ${LEAD_SIGNALS.join(", ")}\n` +
      `Run \`pnpm leads --list-signals\` for what each one means.\n`,
  );
  process.exit(1);
}

const root = new URL("../../../../", import.meta.url);

let businesses: Business[];
try {
  businesses = JSON.parse(
    readFileSync(
      fileURLToPath(new URL("data/out/businesses.json", root)),
      "utf8",
    ),
  ) as Business[];
} catch {
  console.error(
    "No data/out/businesses.json. Run `pnpm crawl --yes` then `pnpm load`,\n" +
      "or `pnpm load --from-archive` to rebuild from responses already fetched.\n",
  );
  process.exit(1);
}

// Suppression is not optional. A missing list is an empty list, never a reason
// to skip the check.
let suppressed = new Set<string>();
try {
  suppressed = parseSuppressionList(
    readFileSync(
      fileURLToPath(new URL("data/suppression-list.json", root)),
      "utf8",
    ),
  );
} catch {
  suppressed = new Set<string>();
}

const result = findLeads(businesses, {
  signal,
  // Built from the WHOLE corpus, not the filtered subset: a prior that
  // rescales per query makes scores incomparable between runs.
  prior: corpusPrior(businesses),
  suppressed,
  ...(flag("--category") ? { category: flag("--category") } : {}),
  ...(flag("--area") ? { area: flag("--area") } : {}),
  ...(flag("--min-reviews")
    ? { minReviews: Number(flag("--min-reviews")) }
    : {}),
  ...(flag("--min-rating") ? { minRating: Number(flag("--min-rating")) } : {}),
  ...(flag("--limit") ? { limit: Number(flag("--limit")) } : {}),
});

const format = (flag("--format") ?? "table").toLowerCase();
const out = flag("--out");
const stream = out ? createWriteStream(out) : process.stdout;

if (format === "csv") {
  stream.write(CSV_BOM);
  stream.write(csvRow([...BUSINESS_COLUMNS, "signal", "score", "reason"]));
  for (const lead of result.leads) {
    stream.write(
      csvRow([
        ...BUSINESS_COLUMNS.map((c) => lead.business[c as keyof Business]),
        lead.signal,
        lead.score.toFixed(3),
        lead.reason,
      ]),
    );
  }
} else if (format === "json") {
  stream.write(JSON.stringify(result.leads, null, 2) + "\n");
} else {
  for (const lead of result.leads.slice(0, 40)) {
    stream.write(
      `${lead.score.toFixed(2).padStart(5)}  ${(lead.business.phoneRaw ?? "no phone").padEnd(16)} ` +
        `${(lead.business.title ?? "").slice(0, 44).padEnd(46)} ${lead.reason}\n`,
    );
  }
}

if (out) stream.end();

// Everything below goes to stderr so `pnpm leads --format csv > file.csv` stays clean.
//
// The withheld count prints unconditionally, including "0 withheld" — the
// point of reporting it at all is that the takedown filter is visibly
// working, not silently trusted. A line that only appears when there is
// something to hide would read as the filter mattering only when it bites.
console.error(`
${result.leads.length.toLocaleString()} leads · signal "${signal}" · ${result.considered.toLocaleString()} businesses considered
${result.suppressed.toLocaleString()} withheld by the suppression list (takedown requests).

These are business listings, not permission to contact. Unsolicited commercial
messaging is regulated in the UAE — check the rules that apply before you use
this list.
`);

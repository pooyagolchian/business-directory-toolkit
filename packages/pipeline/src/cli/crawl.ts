/**
 * Stage 1 — run the crawl.
 *
 *   pnpm crawl --dry-run     show exactly what would be requested. Spends nothing.
 *   pnpm crawl --yes         run it. SPENDS SEARCHAPI CREDITS.
 *   pnpm crawl --yes --budget 200 --only downtown
 *
 * --yes is required on purpose. A crawl is the only irreversible spend in this
 * project, and an accidental `pnpm crawl` should never be able to burn 1,250
 * credits.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runCrawl } from "../fetch.js";
import { buildCrawlPlan, loadCity } from "../plan.js";
import { createSearchApiClient } from "../searchapi.js";

const argv = process.argv.slice(2);
const has = (flag: string) => argv.includes(flag);
const value = (flag: string) => {
  const i = argv.indexOf(flag);
  return i === -1 ? undefined : argv[i + 1];
};

const dryRun = has("--dry-run");
const confirmed = has("--yes");
const only = value("--only");
const budget = Number(value("--budget") ?? 2_000);

const root = new URL("../../../../", import.meta.url);
const outDir = fileURLToPath(new URL("data/out/", root));
const rawDir = fileURLToPath(new URL("data/raw/", root));

/**
 * Adding a city is the toolkit's main extension point, so a wrong id must
 * teach rather than dump a stack trace.
 */
function loadCityOrExit(id: string) {
  try {
    return loadCity(id);
  } catch (error) {
    console.error(
      `\n${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }
}

const city = loadCityOrExit(value("--city") ?? "dubai");
let tiles = city.tiles;
if (only) tiles = tiles.filter((t) => t.id === only);
if (tiles.length === 0) {
  console.error(`No tile matched --only ${only}`);
  process.exit(1);
}

const plan = buildCrawlPlan(tiles, city.categories);

console.log(`
Crawl — ${city.name}
=====
Tiles              ${tiles.length}${only ? ` (--only ${only})` : ""}
Jobs (page 1)      ${plan.estimate.initialRequests.toLocaleString()}
Worst case         ${plan.estimate.maxRequests.toLocaleString()} requests
Budget cap         ${budget.toLocaleString()} requests
Estimated yield    ~${plan.estimate.estimatedUniqueBusinesses.toLocaleString()} raw results
`);

if (dryRun) {
  console.log("--dry-run: nothing was requested and nothing was spent.\n");
  process.exit(0);
}

if (!confirmed) {
  console.error(
    `Refusing to spend credits without --yes.\n` +
      `Run \`pnpm crawl --dry-run\` first, then \`pnpm crawl --yes\`.\n`,
  );
  process.exit(1);
}

const apiKey = process.env.SEARCH_API_KEY;
if (!apiKey) {
  console.error("SEARCH_API_KEY is not set. Copy .env.example to .env.\n");
  process.exit(1);
}

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const client = createSearchApiClient(apiKey);

console.log(`Run ${runId} starting…\n`);

const outcome = await runCrawl(plan.jobs, client, {
  budget,
  onProgress: (issued, cap) => {
    if (issued % 25 === 0) {
      process.stdout.write(`  ${issued}/${cap} requests\r`);
    }
  },
  // Archive every raw response before parsing. Locally this is the filesystem;
  // in Lambda the same hook writes to S3. Either way, re-running the later
  // stages must never require re-spending credits.
  onRaw: (params, response) => {
    const file = `${rawDir}${runId}/${params.tileId}/${params.q.replace(/\W+/g, "-")}-p${params.page}.json`;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(response));
  },
});

mkdirSync(outDir, { recursive: true });
writeFileSync(
  `${outDir}raw-records.json`,
  JSON.stringify(outcome.records, null, 2),
);

const uniqueYield = outcome.requestsIssued
  ? (outcome.records.length / outcome.requestsIssued).toFixed(1)
  : "0";

console.log(`
Done
====
Requests issued    ${outcome.requestsIssued.toLocaleString()}  (= credits spent)
Unique businesses  ${outcome.records.length.toLocaleString()}
Duplicates skipped ${outcome.duplicatesSkipped.toLocaleString()}
Unique per request ${uniqueYield}   (probe predicted ~17.5)
Errors             ${outcome.errors.length}
Stopped on budget  ${outcome.stoppedOnBudget ? "YES — widen --budget for full depth" : "no"}

Raw archived to    data/raw/${runId}/
Records written to data/out/raw-records.json

Next: pnpm classify
`);

if (outcome.errors.length > 0) {
  console.log("Failed requests:");
  for (const error of outcome.errors.slice(0, 10)) {
    console.log(
      `  ${error.params.tileId}/${error.params.q} p${error.params.page}: ${error.message}`,
    );
  }
  if (outcome.errors.length > 10) {
    console.log(`  …and ${outcome.errors.length - 10} more`);
  }
}

/**
 * Stage 0 — build the crawl plan. Makes no API calls and spends nothing.
 *
 *   pnpm plan                    plan the default city
 *   pnpm plan --city dubai       plan a specific city
 *   pnpm plan --list             show every city config in the repo
 *   pnpm plan --json             write the plan to data/out/crawl-plan.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { availableCities, buildCrawlPlan, loadCity } from "../plan.js";

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};

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

if (argv.includes("--list")) {
  console.log(`\nCity configs in this repo:\n`);
  for (const id of availableCities()) {
    const entry = loadCity(id);
    console.log(
      `  ${id.padEnd(14)} ${entry.name} — ${entry.tiles.length} tiles, ${entry.categories.length} categories`,
    );
  }
  console.log(`\nAdd data/cities/<id>.json to crawl somewhere new.\n`);
  process.exit(0);
}

const cityConfig = loadCityOrExit(flag("--city") ?? "dubai");
const plan = buildCrawlPlan(cityConfig.tiles, cityConfig.categories);

const byDensity = (d: string) =>
  cityConfig.tiles.filter((t) => t.density === d).length;
const byTier = (t: string) =>
  cityConfig.categories.filter((c) => c.tier === t).length;

const CREDIT_PER_REQUEST = 1;
const BUDGET_TARGET = 2_000;

console.log(`
Crawl plan — ${cityConfig.name}
${"=".repeat(13 + cityConfig.name.length)}

Tiles       ${cityConfig.tiles.length}  (dense ${byDensity("dense")}, medium ${byDensity("medium")}, sparse ${byDensity("sparse")})
Categories  ${cityConfig.categories.length}  (broad ${byTier("broad")}, standard ${byTier("standard")}, niche ${byTier("niche")})

Requests
  up front (page 1 only)     ${plan.estimate.initialRequests.toLocaleString()}
  worst case (all pages)     ${plan.estimate.maxRequests.toLocaleString()}
  planned budget             ${BUDGET_TARGET.toLocaleString()}

Credits
  up front                   ${(plan.estimate.initialRequests * CREDIT_PER_REQUEST).toLocaleString()}
  worst case                 ${(plan.estimate.maxRequests * CREDIT_PER_REQUEST).toLocaleString()}

Yield estimate
  at 17.5 unique/request     ~${plan.estimate.estimatedUniqueBusinesses.toLocaleString()} before cross-category dedup

Note: worst case assumes every pair paginates to its cap. Adaptive pagination
stops early on thin or duplicate-heavy pages, so the real figure lands between
the two. The fetcher enforces a hard budget cap regardless.
`);

if (plan.estimate.maxRequests > BUDGET_TARGET) {
  console.log(
    `⚠  Worst case exceeds the ${BUDGET_TARGET.toLocaleString()} budget by ` +
      `${(plan.estimate.maxRequests - BUDGET_TARGET).toLocaleString()} requests. ` +
      `The fetcher will stop at the cap; widen the budget deliberately if you want full depth.\n`,
  );
}

if (argv.includes("--json")) {
  mkdirSync(new URL("../../../../data/out/", import.meta.url), {
    recursive: true,
  });
  const out = new URL("../../../../data/out/crawl-plan.json", import.meta.url);
  writeFileSync(out, JSON.stringify(plan, null, 2));
  console.log(`Wrote ${plan.jobs.length} jobs to data/out/crawl-plan.json`);
}

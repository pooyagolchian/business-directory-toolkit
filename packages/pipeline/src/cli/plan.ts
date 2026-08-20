/**
 * Stage 0 — build the crawl plan. Makes no API calls and spends nothing.
 *
 *   pnpm plan            print the budget report
 *   pnpm plan --json     write the plan to data/out/crawl-plan.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { buildCrawlPlan, loadCategories, loadTiles } from "../plan.js";

const tiles = loadTiles();
const categories = loadCategories();
const plan = buildCrawlPlan(tiles, categories);

const byDensity = (d: string) => tiles.filter((t) => t.density === d).length;
const byTier = (t: string) => categories.filter((c) => c.tier === t).length;

const CREDIT_PER_REQUEST = 1;
const BUDGET_TARGET = 2_000;

console.log(`
Crawl plan — Directory from Scratch
===================================

Tiles       ${tiles.length}  (dense ${byDensity("dense")}, medium ${byDensity("medium")}, sparse ${byDensity("sparse")})
Categories  ${categories.length}  (broad ${byTier("broad")}, standard ${byTier("standard")}, niche ${byTier("niche")})

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

if (process.argv.includes("--json")) {
  mkdirSync(new URL("../../../../data/out/", import.meta.url), {
    recursive: true,
  });
  const out = new URL("../../../../data/out/crawl-plan.json", import.meta.url);
  writeFileSync(out, JSON.stringify(plan, null, 2));
  console.log(`Wrote ${plan.jobs.length} jobs to data/out/crawl-plan.json`);
}

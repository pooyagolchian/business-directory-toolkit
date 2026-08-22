/**
 * Stage 0 — build the crawl plan. Makes no API calls and spends nothing.
 *
 *   pnpm plan                    plan the default city
 *   pnpm plan --city dubai       plan a specific city
 *   pnpm plan --list             show every city config in the repo
 *   pnpm plan --list --all       list generated configs individually too
 *   pnpm plan --list --verified  only cities someone has actually crawled
 *   pnpm plan --json             write the plan to data/out/crawl-plan.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { verificationState } from "@directory/core";
import type { CityConfig } from "@directory/core";
import { availableCities, buildCrawlPlan, loadCity } from "../plan";

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

/**
 * How a config is described in --list.
 *
 * A verified city shows what the crawl actually cost and found, because those
 * numbers are the reason to trust its tiles. A generated one shows where it
 * came from and when, because that is all anyone can honestly say about it.
 */
function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function describe(id: string, city: CityConfig): string {
  const base = `  ${id.padEnd(14)} ${city.name} — ${count(city.tiles.length, "tile", "tiles")}, ${count(city.categories.length, "category", "categories")}`;
  const v = city.verification;
  if (v?.status === "verified") {
    return `${base}\n${" ".repeat(17)}${v.requests.toLocaleString()} requests → ${v.uniqueBusinesses.toLocaleString()} found, ${v.inCity.toLocaleString()} in city (${v.crawledAt})`;
  }
  if (v?.status === "generated") {
    return `${base}\n${" ".repeat(17)}${v.source}, generated ${v.generatedAt}`;
  }
  return base;
}

/** Above this, a group collapses to a count unless --all is passed. */
const COLLAPSE_ABOVE = 10;

if (argv.includes("--list")) {
  const verifiedOnly = argv.includes("--verified");
  const listAll = argv.includes("--all");

  const entries = availableCities().map((id) => ({ id, city: loadCity(id) }));
  const groups = [
    {
      state: "verified" as const,
      head: "verified — crawled, with measured numbers",
    },
    {
      state: "generated" as const,
      head: "generated — from open data, never crawled",
    },
    {
      state: "unknown" as const,
      head: "unverified — no provenance recorded",
    },
  ]
    .map((g) => ({
      ...g,
      cities: entries.filter((e) => verificationState(e.city) === g.state),
    }))
    .filter((g) => g.cities.length > 0)
    .filter((g) => !verifiedOnly || g.state === "verified");

  console.log(`\nCity configs in this repo:\n`);

  // Headings only earn their space once there is more than one kind of config.
  // A repository with a single hand-tuned city should read exactly as it did
  // before provenance existed.
  const showHeadings = groups.length > 1;

  for (const group of groups) {
    if (showHeadings) console.log(`  ${group.head}`);
    // Verified configs always list in full: they are the ones carrying
    // evidence, and there will never be many. Generated ones collapse, because
    // a registry of a thousand would otherwise bury them.
    const expand =
      group.state === "verified" ||
      listAll ||
      group.cities.length <= COLLAPSE_ABOVE;
    if (expand) {
      for (const { id, city } of group.cities) console.log(describe(id, city));
    } else {
      console.log(
        `  ${count(group.cities.length, "config", "configs")} — pass --all to list them.`,
      );
    }
    console.log("");
  }

  if (groups.length === 0) {
    console.log(`  none\n`);
  }

  console.log(`Add data/cities/<id>.json to crawl somewhere new.\n`);
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

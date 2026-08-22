/**
 * Generate and validate city configs. Touches OpenStreetMap and nothing else,
 * so it spends no SearchApi credits — see ADR 0014.
 *
 *   pnpm cities generate --name "Lisbon"              write data/cities/lisbon.json
 *   pnpm cities generate --name "Lisbon" --dry-run    print it, write nothing
 *   pnpm cities generate --name "Lisbon" --budget 800 fit a tighter budget
 *   pnpm cities generate --name "Lisbon" --id lisboa  override the derived id
 *   pnpm cities generate --name "Lisbon" --force      overwrite an existing config
 *   pnpm cities validate                              check every config in the repo
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseCategoryMap, verificationState } from "@directory/core";
import type { CityConfig } from "@directory/core";
import { availableCities, buildCrawlPlan, loadCity } from "../plan";
import { createOsmClient } from "../osm";
import { generateCityConfig } from "../cities";

const argv = process.argv.slice(2);
const command = argv[0];
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};
const has = (name: string): boolean => argv.includes(name);

const repoUrl = (path: string) =>
  new URL(`../../../../${path}`, import.meta.url);

function die(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function usage(): never {
  die(
    `Usage:\n` +
      `  pnpm cities generate --name "Lisbon" [--budget 2000] [--id lisbon] [--dry-run] [--force]\n` +
      `  pnpm cities validate`,
  );
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function tally(city: CityConfig): string {
  const d = (k: string) => city.tiles.filter((t) => t.density === k).length;
  const t = (k: string) => city.categories.filter((c) => c.tier === k).length;
  return (
    `  tiles         ${String(city.tiles.length).padEnd(4)}(dense ${d("dense")}, medium ${d("medium")}, sparse ${d("sparse")})\n` +
    `  categories    ${String(city.categories.length).padEnd(4)}(broad ${t("broad")}, standard ${t("standard")}, niche ${t("niche")})`
  );
}

// ---------------------------------------------------------------------------

if (command === "validate") {
  const ids = availableCities();
  let bad = 0;

  for (const id of ids) {
    try {
      const city = loadCity(id);
      const plan = buildCrawlPlan(city.tiles, city.categories);
      // A config can pass every structural check and still plan zero jobs:
      // PAGE_CAP gives sparse tiles no pages for standard or niche, so an
      // all-sparse city with no broad category spends nothing, finds nothing,
      // and looks like a working config until the crawl finishes empty.
      if (plan.jobs.length === 0) {
        console.error(`  ✗ ${id.padEnd(14)} valid, but plans ZERO jobs.`);
        bad++;
        continue;
      }
      console.log(
        `  ✓ ${id.padEnd(14)} ${verificationState(city).padEnd(9)} ` +
          `${count(city.tiles.length, "tile", "tiles")}, ` +
          `${count(city.categories.length, "category", "categories")}, ` +
          `${plan.estimate.maxRequests.toLocaleString()} requests worst case`,
      );
    } catch (error) {
      console.error(
        `  ✗ ${id.padEnd(14)} ${error instanceof Error ? error.message : String(error)}`,
      );
      bad++;
    }
  }

  console.log(
    `\n${count(ids.length - bad, "config", "configs")} valid` +
      (bad ? `, ${bad} broken` : "") +
      `.\n`,
  );
  process.exit(bad ? 1 : 0);
}

if (command !== "generate") usage();

const name = flag("--name");
if (!name) usage();

const budget = Number(flag("--budget") ?? 2000);
if (!Number.isFinite(budget) || budget < 1) {
  die(
    `--budget must be a positive number of requests; got ${flag("--budget")}.`,
  );
}

const categoryMap = parseCategoryMap(
  readFileSync(repoUrl("data/category-map.json"), "utf8"),
  "data/category-map.json",
);

console.log(`\nResolving ${JSON.stringify(name)} against OpenStreetMap…`);

const client = createOsmClient({
  onRequest: (kind, cached) =>
    console.log(`  ${cached ? "cached" : "fetched"}  ${kind}`),
});

let result;
try {
  result = await generateCityConfig({
    name,
    budget,
    client,
    categoryMap,
    today: new Date().toISOString().slice(0, 10),
    // Spread rather than assigned: the tsconfig sets exactOptionalPropertyTypes,
    // so an explicit `id: undefined` is a different thing from an absent id.
    ...(flag("--id") ? { id: flag("--id")! } : {}),
  });
} catch (error) {
  die(error instanceof Error ? error.message : String(error));
}

const { city, dropped, candidatesConsidered, survivors, skipped } = result;
const plan = buildCrawlPlan(city.tiles, city.categories);
const file = `data/cities/${city.id}.json`;

console.log(`
${city.name} (${city.countryCode}) — generated from OpenStreetMap
${"=".repeat(42 + city.name.length + city.countryCode.length)}

  candidates    ${candidatesConsidered} place nodes → ${survivors} after spacing${skipped ? ` (${skipped} skipped: no Latin name)` : ""}
${tally(city)}
  dropped       ${dropped.length} tiles the ${budget.toLocaleString()} budget could not afford
  boxes         ${count(city.boundingBoxes.length, "bounding box", "bounding boxes")}
  names         ${city.cityNames.join(", ")}

  requests      up front ${plan.estimate.initialRequests.toLocaleString()} · worst case ${plan.estimate.maxRequests.toLocaleString()} · budget ${budget.toLocaleString()}
  credits       ${plan.estimate.maxRequests.toLocaleString()} at worst, one per request
`);

if (dropped.length) {
  const byDensity = (k: string) =>
    dropped.filter((t) => t.density === k).length;
  console.log(
    `  Dropped to fit: dense ${byDensity("dense")}, medium ${byDensity("medium")}, sparse ${byDensity("sparse")}.\n` +
      `  Raise --budget to keep more.\n`,
  );
}

console.log(
  `  UNVERIFIED. Nobody has crawled this city, and these tiles are derived\n` +
    `  from open data rather than measured. To verify it:\n\n` +
    `    pnpm crawl --city ${city.id} --dry-run\n` +
    `    pnpm crawl --city ${city.id} --yes\n\n` +
    `  then open a PR flipping verification.status to "verified" with the\n` +
    `  requests, uniqueBusinesses and inCity you actually measured.\n`,
);

if (has("--dry-run")) {
  console.log(JSON.stringify(city, null, 2));
  console.log(`\nDry run — nothing written.\n`);
  process.exit(0);
}

if (existsSync(repoUrl(file)) && !has("--force")) {
  die(
    `${file} already exists.\n\n` +
      `Refusing to overwrite it. data/cities/dubai.json is hand-tuned and\n` +
      `carries measured crawl numbers; replacing it with a generated config\n` +
      `would silently discard evidence. Pass --force if that is what you want.`,
  );
}

writeFileSync(repoUrl(file), `${JSON.stringify(city, null, 2)}\n`);
console.log(`Wrote ${file}\n`);

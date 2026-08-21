/**
 * Measure real search demand per category, using SearchApi's
 * `google_autocomplete` engine.
 *
 *   pnpm demand --dry-run   show the request count and credit cost
 *   pnpm demand --yes       spend credits and write data/demand.json
 *
 * WHY THIS EXISTS
 *
 * The crawl tells us SUPPLY — how many spas exist in Dubai. It says nothing
 * about DEMAND — how many people look for one, or which neighbourhood they
 * attach to the query. Ranking a directory by supply is guessing.
 *
 * Google's autocomplete is ordered by actual query popularity, so asking it
 * "spa in dubai …" returns the qualifiers people really type, in the order they
 * really type them. For ~80 categories that is ~80 requests.
 *
 * This is what decides which of the ~2,000 possible area x category pages are
 * worth building. Generating every combination and hoping is the default
 * approach to programmatic SEO; selecting combinations from measured demand is
 * both cheaper and far more likely to rank.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Business } from "@directory/core";
import { loadCity } from "../plan.js";

const ENDPOINT = "https://www.searchapi.io/api/v1/search";

export interface DemandSuggestion {
  query: string;
  /** 0 = most popular. Google returns autocomplete in popularity order. */
  rank: number;
  /** Area id this suggestion mentions, when it maps onto one of our tiles. */
  area?: string;
}

export interface CategoryDemand {
  category: string;
  seed: string;
  suggestions: DemandSuggestion[];
  /** Areas people actually attach to this category, most-searched first. */
  areasInDemand: string[];
}

/** Match a suggestion against the city's neighbourhoods. */
export function matchArea(
  suggestion: string,
  tiles: Array<{ id: string; name: string }>,
): string | undefined {
  const haystack = suggestion.toLowerCase();
  let best: { id: string; length: number } | undefined;
  for (const tile of tiles) {
    const name = tile.name.toLowerCase();
    // Longest name wins, so "dubai marina" beats a bare "dubai".
    if (haystack.includes(name) && (!best || name.length > best.length)) {
      best = { id: tile.id, length: name.length };
    }
  }
  return best?.id;
}

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const confirmed = argv.includes("--yes");
const cityId =
  argv.indexOf("--city") === -1
    ? "dubai"
    : (argv[argv.indexOf("--city") + 1] ?? "dubai");

const city = loadCity(cityId);
const root = new URL("../../../../", import.meta.url);
const businessesPath = fileURLToPath(new URL("data/out/businesses.json", root));

let businesses: Business[];
try {
  businesses = JSON.parse(readFileSync(businessesPath, "utf8")) as Business[];
} catch {
  console.error("No data/out/businesses.json. Run `pnpm load` first.\n");
  process.exit(1);
}

const categories = [
  ...new Set(businesses.map((b) => b.l2).filter(Boolean)),
] as string[];

console.log(`
Search demand — ${city.name}
${"=".repeat(16 + city.name.length)}

Categories to probe   ${categories.length}
Requests              ${categories.length}  (1 per category)
Credits               ${categories.length}

Autocomplete is ordered by real query popularity, so this measures what people
actually search for — not what the crawl happened to find.
`);

if (dryRun) {
  console.log("--dry-run: nothing was requested and nothing was spent.\n");
  console.log("Sample seeds:");
  for (const c of categories.slice(0, 5)) {
    console.log(`  "${c.toLowerCase()} in ${city.name.toLowerCase()}"`);
  }
  console.log();
  process.exit(0);
}

if (!confirmed) {
  console.error("Refusing to spend credits without --yes.\n");
  process.exit(1);
}

const apiKey = process.env.SEARCH_API_KEY;
if (!apiKey) {
  console.error("SEARCH_API_KEY is not set.\n");
  process.exit(1);
}

async function autocomplete(seed: string): Promise<string[]> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("engine", "google_autocomplete");
  url.searchParams.set("q", seed);
  url.searchParams.set("gl", city.countryCode.toLowerCase());
  url.searchParams.set("hl", "en");

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for "${seed}"`);

  const data = (await response.json()) as {
    suggestions?: Array<{ value?: string }>;
  };
  return (data.suggestions ?? [])
    .map((s) => s.value)
    .filter((v): v is string => typeof v === "string");
}

const results: CategoryDemand[] = [];
const errors: string[] = [];

for (const [index, category] of categories.entries()) {
  const seed = `${category.toLowerCase()} in ${city.name.toLowerCase()}`;
  process.stdout.write(
    `  ${index + 1}/${categories.length} ${category.padEnd(24)}\r`,
  );

  try {
    const values = await autocomplete(seed);
    const suggestions: DemandSuggestion[] = values.map((query, rank) => {
      const entry: DemandSuggestion = { query, rank };
      const area = matchArea(query, city.tiles);
      if (area) entry.area = area;
      return entry;
    });

    const areasInDemand = [
      ...new Set(
        suggestions.filter((s) => s.area).map((s) => s.area as string),
      ),
    ];

    results.push({ category, seed, suggestions, areasInDemand });
  } catch (error) {
    errors.push(
      `${category}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

mkdirSync(fileURLToPath(new URL("data/out/", root)), { recursive: true });
writeFileSync(
  fileURLToPath(new URL("data/demand.json", root)),
  `${JSON.stringify(results, null, 2)}\n`,
);

const withAreas = results.filter((r) => r.areasInDemand.length > 0);
const totalSuggestions = results.reduce(
  (sum, r) => sum + r.suggestions.length,
  0,
);

console.log(`
Done
====
Categories probed     ${results.length}
Credits spent         ${results.length + errors.length}
Suggestions captured  ${totalSuggestions}
Categories naming a neighbourhood  ${withAreas.length}
Errors                ${errors.length}

Written to data/demand.json — committed, because it is derived query data
rather than business listings, and it is what makes the page selection
reproducible.
`);

for (const error of errors.slice(0, 5)) console.log(`  ${error}`);

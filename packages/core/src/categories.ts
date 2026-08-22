/**
 * Choosing what to search for in a city, from what the city actually contains.
 *
 * Shipping Dubai's forty categories everywhere would spend credits on empty
 * queries and miss whatever the local equivalent is. Measured on the recorded
 * Overpass counts of 2026-08-22, over central Dubai and the Lisbon
 * municipality:
 *
 *   tailors           Dubai 241   Lisbon  16
 *   exchange houses   Dubai 180   Lisbon  10
 *   supermarkets      Dubai 1310  Lisbon 245
 *   pubs              Dubai  25   Lisbon  71
 *
 * The inversion on the last row is the load-bearing one. Without it the
 * difference could be read as "Dubai simply has more of everything"; with it,
 * the only honest conclusion is that a category list is a property of a city.
 *
 * The counts come from the same free Overpass pass that measures tile density,
 * so this costs nothing extra.
 */
import type { CityCategory, Tier } from "./types";

/**
 * A category must clear this many OSM nodes to earn a slot.
 *
 * A tier is a claim about how likely an area is to hold 100+ businesses of a
 * kind, and `PAGE_CAP` turns that claim into credits. A category with three
 * nodes in the whole city buys empty result pages at one credit each.
 *
 * A floor chosen to exclude noise, not a measured optimum — it is named rather
 * than inlined so the calibration pass can argue with it.
 */
export const MIN_CATEGORY_COUNT = 10;

/**
 * Hard cap on how many categories a generated city carries.
 *
 * The floor alone is not enough. Applied to the recordings it admits **84
 * categories in Dubai and 87 in Lisbon**, against the 40 in the hand-tuned
 * `data/cities/dubai.json`. That is not free: worst-case cost is tiles times
 * categories, so doubling the list roughly halves how many tiles a fixed
 * budget can buy, and `fitToBudget` would shed real neighbourhoods to fund
 * marginal search terms.
 *
 * Forty is chosen because it is the only category count anyone has actually
 * crawled. The measured yield of 10.9 unique businesses per request comes from
 * a 40-category run, and it is the number every cost estimate in this
 * repository rests on; a 90-category city would be outside the evidence.
 *
 * The trade-off underneath — whether 23 tiles by 40 categories beats 11 tiles
 * by 84 — is genuinely unmeasured, and nothing here pretends otherwise. It
 * needs a crawl to settle, which is what the verification loop is for.
 */
export const MAX_CATEGORIES = 40;

/**
 * Tier shares, from `data/cities/dubai.json`: 10 broad, 20 standard, 10 niche.
 *
 * The design note called this a decile split. The committed file is a quartile
 * split, and the file is the measurement.
 */
export const TIER_SHARES: Record<Tier, number> = {
  broad: 0.25,
  standard: 0.5,
  niche: 0.25,
};

/** `data/category-map.json`: one OSM `tag=value` → one Google search term. */
export type CategoryMap = Record<string, string>;

/** OSM keys and values are lowercase ASCII with underscores; values may carry a colon. */
const TAG_PATTERN = /^[a-z_]+=[a-z0-9_:]+$/;

/**
 * Parse the hand-maintained tag map, rejecting entries that could never match.
 *
 * Throws rather than skipping, on `parseCityConfig`'s reasoning: a map that
 * silently ignores a malformed line looks exactly like a map that has the line,
 * and the difference only shows up as a category the generator mysteriously
 * never picks.
 */
export function parseCategoryMap(json: string, source?: string): CategoryMap {
  const label = source ? `Category map "${source}"` : "Category map";

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(
      `${label}: is not valid JSON - ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label}: must be a JSON object.`);
  }

  const map: CategoryMap = {};
  for (const [key, value] of Object.entries(parsed)) {
    // Underscore-prefixed keys are documentation, the same convention
    // availableCities() uses to skip data/cities/_template.json.
    if (key.startsWith("_")) continue;

    if (!TAG_PATTERN.test(key)) {
      throw new Error(
        `${label}: key ${JSON.stringify(key)} is not an OSM tag=value pair ` +
          `like "amenity=pharmacy". Overpass would never match it, so the ` +
          `category would silently never appear.`,
      );
    }
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(
        `${label}: ${key} has no search term (${JSON.stringify(value)}). An ` +
          `empty query still costs a credit.`,
      );
    }
    map[key] = value.trim();
  }

  return map;
}

/**
 * Turn city-wide OSM tag counts into a tiered category list.
 *
 * Ranking is by count descending with the search term as tiebreak, because
 * ADR 0001's reproducibility claim — that a published crawl can be rebuilt from
 * the committed config — is only true if this is deterministic.
 */
export function deriveCategories(
  counts: Record<string, number>,
  map: CategoryMap,
): CityCategory[] {
  // Two tags may name the same search. Summing rather than picking the larger
  // is what makes a business tagged inconsistently across OSM still count once
  // toward the term that would actually find it.
  const byQuery = new Map<string, number>();
  for (const [tag, count] of Object.entries(counts)) {
    const query = map[tag];
    if (!query) continue;
    if (!Number.isFinite(count) || count <= 0) continue;
    byQuery.set(query, (byQuery.get(query) ?? 0) + count);
  }

  const ranked = [...byQuery.entries()]
    .filter(([, count]) => count >= MIN_CATEGORY_COUNT)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_CATEGORIES)
    .map(([query]) => query);

  const n = ranked.length;

  // At least one broad category, always. The share alone rounds to zero below
  // two categories, and a city with no broad category can plan literally
  // nothing: PAGE_CAP gives a sparse tile zero pages for standard and niche
  // alike, so an all-sparse town would produce a config that passes every
  // validation check, spends no credits, finds no businesses, and looks like a
  // working config until the crawl finishes empty.
  const broad =
    n === 0 ? 0 : Math.min(n, Math.max(1, Math.round(n * TIER_SHARES.broad)));
  // Niche yields to broad rather than the other way round, for the same
  // reason: niche buys the shallowest crawl, so it is the safe thing to lose.
  const niche = Math.min(Math.round(n * TIER_SHARES.niche), n - broad);
  // Standard absorbs the rounding remainder rather than being computed from
  // its own share, so the three counts always sum to n exactly.
  const standardEnd = n - niche;

  return ranked.map((q, i) => ({
    q,
    tier: (i < broad
      ? "broad"
      : i < standardEnd
        ? "standard"
        : "niche") as Tier,
  }));
}

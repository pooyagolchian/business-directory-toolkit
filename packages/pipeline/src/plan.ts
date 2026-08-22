import { readdirSync, readFileSync } from "node:fs";
import { DENSITY_SHARES, parseCityConfig } from "@directory/core";
import type {
  CityCategory,
  CityConfig,
  CityTile,
  Density,
  Tier,
} from "@directory/core";

export type { CityCategory, CityConfig, CityTile, Density, Tier };

export interface CrawlJob {
  tileId: string;
  lat: number;
  lng: number;
  zoom: number;
  q: string;
  page: number;
  /** Hard stop for adaptive pagination on this (tile, category) pair. */
  maxPages: number;
}

export interface CrawlPlan {
  jobs: CrawlJob[];
  estimate: {
    /** Requests issued immediately — one per planned job. */
    initialRequests: number;
    /** If every job paginated all the way to its cap. Adaptive stopping means the real number lands well below this. */
    maxRequests: number;
    /**
     * Results the engine hands back, at the in-query rate, before anything is
     * deduplicated across categories. Deliberately not called "unique": a
     * listing tagged with several categories is counted once per category
     * whose query returned it.
     */
    estimatedGrossResults: number;
    /** Distinct businesses expected to survive dedup, at the rate a full crawl measured. */
    estimatedUniqueBusinesses: number;
  };
}

/**
 * In-query yield: 20 results per page, ~12% of them repeated within a single
 * query stream. This is a real measurement and it is the wrong one to quote as
 * a corpus size, because it counts across categories rather than across
 * businesses. It survives only to show where the loss below comes from.
 */
const GROSS_RESULTS_PER_REQUEST = 17.5;

/**
 * End-to-end yield, measured over the whole v0.1 crawl: 1,400 requests produced
 * 15,246 unique businesses, so 10.9 each.
 *
 * The gap between this and the 17.5 above is not noise, it is the ~45%
 * cross-category duplicate rate — a business tagged "restaurant", "cafe" and
 * "bakery" is returned by all three queries and is one business. Planning
 * against the in-query figure overstated the result by 38%, which this file
 * printed as the only yield number until it was corrected.
 */
const NET_UNIQUE_PER_REQUEST = 10.9;

/**
 * How deep to paginate a (tile, category) pair.
 *
 * Never above 10 — page 11 was measured to return zero results, so an eleventh
 * request is guaranteed waste. Depth otherwise tracks how likely an area is to
 * actually hold 100+ businesses of a given kind.
 */
const PAGE_CAP: Record<Density, Record<Tier, number>> = {
  dense: { broad: 5, standard: 3, niche: 1 },
  medium: { broad: 3, standard: 2, niche: 0 },
  sparse: { broad: 1, standard: 0, niche: 0 },
};

function citiesDir(): URL {
  return new URL("../../../data/cities/", import.meta.url);
}

/** Every city config shipped in the repo, by id. */
export function availableCities(): string[] {
  return readdirSync(citiesDir())
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
}

/**
 * Load a city config.
 *
 * A city is data, not code: pointing the toolkit at somewhere new means adding
 * a JSON file here, and nothing downstream changes.
 */
export function loadCity(id: string): CityConfig {
  const file = new URL(`${id}.json`, citiesDir());
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    throw new Error(
      `No city config "${id}". Available: ${availableCities().join(", ")}. ` +
        `Add data/cities/${id}.json to crawl somewhere new.`,
    );
  }
  // Validated rather than cast: a density typo would otherwise drop a tile in
  // silence, and a wrong countryCode would yield an empty directory that looks
  // like an honest empty result. See parseCityConfig.
  return parseCityConfig(raw, id);
}

/**
 * Build the crawl plan.
 *
 * Only first pages are planned. Deeper pages are enqueued by the fetcher at run
 * time, and only when a page came back full and still yielding new businesses —
 * pre-planning depth would commit credits to pages the data says are not worth
 * fetching.
 *
 * Output order is deterministic so that a published crawl can be reproduced
 * exactly from the committed city config.
 */
export function buildCrawlPlan(
  tiles: CityTile[],
  categories: CityCategory[],
): CrawlPlan {
  const jobs: CrawlJob[] = [];
  let maxRequests = 0;

  for (const tile of tiles) {
    for (const category of categories) {
      const maxPages = PAGE_CAP[tile.density]?.[category.tier] ?? 0;
      // 0 means this category is not worth crawling in this density of area.
      if (maxPages < 1) continue;

      jobs.push({
        tileId: tile.id,
        lat: tile.lat,
        lng: tile.lng,
        zoom: tile.zoom,
        q: category.q,
        page: 1,
        maxPages,
      });
      maxRequests += maxPages;
    }
  }

  return {
    jobs,
    estimate: {
      initialRequests: jobs.length,
      maxRequests,
      estimatedGrossResults: Math.round(
        jobs.length * GROSS_RESULTS_PER_REQUEST,
      ),
      estimatedUniqueBusinesses: Math.round(
        jobs.length * NET_UNIQUE_PER_REQUEST,
      ),
    },
  };
}

/** Dense first: when a budget cannot hold the whole city, keep the tiles with the businesses in them. */
const DENSITY_RANK: Record<Density, number> = {
  dense: 0,
  medium: 1,
  sparse: 2,
};

export interface BudgetFit {
  /** The tiles that fit, in the order they were given. */
  tiles: CityTile[];
  /** The tiles the budget could not afford, so the choice stays visible. */
  dropped: CityTile[];
  /** Worst-case requests for the kept tiles. Agrees with `buildCrawlPlan`. */
  maxRequests: number;
}

/**
 * Choose which tiles fit a credit budget, instead of letting the fetcher
 * truncate an oversized plan at run time.
 *
 * Dubai's own hand-tuned config plans 3,170 worst-case requests against a 2,000
 * budget. Today the fetcher absorbs that with a hard cap, which means *which*
 * tiles lose their coverage is decided by iteration order while the crawl is
 * running — nobody chose it, and nothing reports it. Deciding here instead
 * makes it a choice with a record, and turns the fourth hard rule (never widen
 * a crawl without saying what it costs) into a property of the code rather than
 * a discipline someone has to remember.
 *
 * Tiles are admitted in the order given, because that order is the caller's
 * priority: `spaceOut` already returns candidates busiest-first, and density —
 * the thing that drives cost through `PAGE_CAP` — is derived from the same
 * count. Re-sorting here would quietly overrule a caller who knew better.
 *
 * A tile whose categories all resolve to zero pages costs nothing and is
 * therefore always kept. Dropping it would make the budget a second, silent
 * reason for a tile to vanish, which is the failure mode ADR 0007 exists to
 * argue against.
 */
export function fitToBudget(
  tiles: CityTile[],
  categories: CityCategory[],
  budget: number,
): BudgetFit {
  const costOf = (tile: CityTile): number => {
    let cost = 0;
    for (const category of categories) {
      cost += PAGE_CAP[tile.density]?.[category.tier] ?? 0;
    }
    return cost;
  };

  // Selection runs density-descending, not in file order. Measured against
  // Dubai, admitting in file order at a 1,250 budget dropped five DENSE tiles
  // while keeping medium ones that happened to be listed earlier — which is
  // the opposite of what a budget should buy. Ties keep the caller's order,
  // which for a generated config is already busiest-first from `spaceOut`.
  const byDensity = tiles
    .map((tile, index) => ({ tile, index }))
    .sort(
      (a, b) =>
        DENSITY_RANK[a.tile.density] - DENSITY_RANK[b.tile.density] ||
        a.index - b.index,
    );

  const keptIndices = new Set<number>();
  let maxRequests = 0;
  for (const { tile, index } of byDensity) {
    const cost = costOf(tile);
    // No early exit: a cheap sparse tile can still fit in the remainder after
    // an expensive dense one has been turned away.
    if (maxRequests + cost <= budget) {
      keptIndices.add(index);
      maxRequests += cost;
    }
  }

  // Output returns to the caller's original order. Selection is a cost
  // decision; the result is a config file a human has to read.
  const kept: CityTile[] = [];
  const dropped: CityTile[] = [];
  tiles.forEach((tile, index) => {
    if (keptIndices.has(index)) kept.push(tile);
    else dropped.push(tile);
  });

  return { tiles: kept, dropped, maxRequests };
}

/**
 * How many tiles a budget can afford, given a category list.
 *
 * The generator needs this *before* it picks tiles, not after. Spacing alone
 * has no opinion about money: Dubai has 321 mapped neighbourhood nodes and 276
 * of them survive the spacing floors, against the 44 a human chose. Ranking
 * 276 centres puts ~94 of them in the `dense` class at 120 requests each, so
 * `fitToBudget` then throws away 258 tiles — and the config ships with worse
 * coverage than the human's for the same money, because the money went on
 * depth in a handful of places instead of breadth across the city.
 *
 * Deciding the count first inverts that: take the busiest N centres, rank
 * those, and the density split lands on a set the budget can actually hold.
 *
 * **At Dubai's own budget this returns exactly Dubai's 44 tiles — and that is
 * an identity, not a validation.** `DENSITY_SHARES` is Dubai's 15/18/11 and
 * `PAGE_CAP` is what priced that config, so the weighted average is precisely
 * 3,170/44 and the division cannot return anything else. It is worth stating
 * plainly because it looks like a confirmation and is not one: nothing here
 * has been checked against a city the constants did not come from.
 *
 * What the formula actually buys is the *scaling*. The one configuration
 * anybody has crawled fixes the ratio of budget to tiles, and this carries
 * that ratio to other budgets and other category lists rather than leaving the
 * tile count to whatever OpenStreetMap happened to have mapped. Whether the
 * ratio generalises is unmeasured and needs a second crawled city to settle.
 */
export function tilesAffordable(
  budget: number,
  categories: readonly CityCategory[],
  shares: Record<Density, number> = DENSITY_SHARES,
): number {
  const costOf = (density: Density): number => {
    let cost = 0;
    for (const category of categories) {
      cost += PAGE_CAP[density]?.[category.tier] ?? 0;
    }
    return cost;
  };

  // Expected cost of one tile, weighted by how often each density occurs.
  const average =
    costOf("dense") * shares.dense +
    costOf("medium") * shares.medium +
    costOf("sparse") * shares.sparse;

  // A category list where every tier resolves to zero pages costs nothing, so
  // no number of tiles is unaffordable. Callers still cap by what OSM offered.
  if (average <= 0) return Number.MAX_SAFE_INTEGER;

  // At least one tile: a city that cannot afford a single tile should fail
  // loudly downstream on its tile count, not silently return an empty config.
  return Math.max(1, Math.floor(budget / average));
}

/** Convenience: plan a whole city in one call. */
export function planCity(city: CityConfig): CrawlPlan {
  return buildCrawlPlan(city.tiles, city.categories);
}

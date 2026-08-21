import { readdirSync, readFileSync } from "node:fs";
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
    /** At the measured ~17.5 unique results per request, before cross-category dedup. */
    estimatedUniqueBusinesses: number;
  };
}

/** Measured: 20 results per page, ~12% duplicated within a query stream. */
const UNIQUE_PER_REQUEST = 17.5;

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
  return JSON.parse(raw) as CityConfig;
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
      estimatedUniqueBusinesses: Math.round(jobs.length * UNIQUE_PER_REQUEST),
    },
  };
}

/** Convenience: plan a whole city in one call. */
export function planCity(city: CityConfig): CrawlPlan {
  return buildCrawlPlan(city.tiles, city.categories);
}

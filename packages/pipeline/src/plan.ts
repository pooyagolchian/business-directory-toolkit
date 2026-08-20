import { readFileSync } from "node:fs";

export type Density = "dense" | "medium" | "sparse";
export type Tier = "broad" | "standard" | "niche";

export interface Tile {
  id: string;
  name: string;
  lat: number;
  lng: number;
  zoom: number;
  density: Density;
}

export interface Category {
  q: string;
  tier: Tier;
}

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

function dataUrl(file: string): URL {
  return new URL(`../../../data/${file}`, import.meta.url);
}

export function loadTiles(): Tile[] {
  const parsed = JSON.parse(readFileSync(dataUrl("tiles.json"), "utf8")) as {
    tiles: Tile[];
  };
  return parsed.tiles;
}

export function loadCategories(): Category[] {
  const parsed = JSON.parse(
    readFileSync(dataUrl("categories.json"), "utf8"),
  ) as {
    categories: Category[];
  };
  return parsed.categories;
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
 * exactly from the committed tile and category files.
 */
export function buildCrawlPlan(
  tiles: Tile[],
  categories: Category[],
): CrawlPlan {
  const jobs: CrawlJob[] = [];
  let maxRequests = 0;

  for (const tile of tiles) {
    for (const category of categories) {
      const maxPages = PAGE_CAP[tile.density][category.tier];
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

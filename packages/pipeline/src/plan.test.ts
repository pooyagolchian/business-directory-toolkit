import { describe, expect, test } from "vitest";
import { availableCities, buildCrawlPlan, loadCity } from "./plan";

const dubai = loadCity("dubai");
const tiles = dubai.tiles;
const categories = dubai.categories;

describe("buildCrawlPlan", () => {
  test("plans only first pages, because depth is decided adaptively at crawl time", () => {
    // Pre-planning 10 pages per combo would spend credits on pages that the
    // measured page-11 cliff and 12% duplicate rate say are not worth fetching.
    const plan = buildCrawlPlan(tiles, categories);
    expect(plan.jobs.every((j) => j.page === 1)).toBe(true);
  });

  test("runs broad categories across every tile", () => {
    const plan = buildCrawlPlan(tiles, categories);
    const restaurantTiles = new Set(
      plan.jobs.filter((j) => j.q === "restaurants").map((j) => j.tileId),
    );
    expect(restaurantTiles.size).toBe(tiles.length);
  });

  test("keeps niche categories out of sparse tiles", () => {
    // Crawling "law firms" in the desert spends credits to find nothing.
    const plan = buildCrawlPlan(tiles, categories);
    const sparseIds = new Set(
      tiles.filter((t) => t.density === "sparse").map((t) => t.id),
    );
    const nicheInSparse = plan.jobs.filter(
      (j) => j.q === "law firms" && sparseIds.has(j.tileId),
    );
    expect(nicheInSparse).toHaveLength(0);
  });

  test("keeps standard categories out of sparse tiles", () => {
    const plan = buildCrawlPlan(tiles, categories);
    const sparseIds = new Set(
      tiles.filter((t) => t.density === "sparse").map((t) => t.id),
    );
    expect(
      plan.jobs.filter((j) => j.q === "hotels" && sparseIds.has(j.tileId)),
    ).toHaveLength(0);
  });

  test("reports the up-front request count as the number of planned jobs", () => {
    const plan = buildCrawlPlan(tiles, categories);
    expect(plan.estimate.initialRequests).toBe(plan.jobs.length);
  });

  test("reports a worst case that assumes every job paginates to its cap", () => {
    const plan = buildCrawlPlan(tiles, categories);
    expect(plan.estimate.maxRequests).toBeGreaterThan(
      plan.estimate.initialRequests,
    );
  });

  test("estimates unique businesses from the measured 17.5 per request", () => {
    const plan = buildCrawlPlan(tiles, categories);
    expect(plan.estimate.estimatedUniqueBusinesses).toBeGreaterThan(0);
  });

  test("is deterministic, so a published crawl can be reproduced exactly", () => {
    const a = buildCrawlPlan(tiles, categories);
    const b = buildCrawlPlan(tiles, categories);
    expect(a.jobs).toEqual(b.jobs);
  });

  test("carries tile coordinates through so the fetcher needs no lookup", () => {
    const plan = buildCrawlPlan(tiles, categories);
    const job = plan.jobs.find((j) => j.tileId === "downtown");
    expect(job?.lat).toBe(25.1972);
    expect(job?.zoom).toBe(15);
  });

  test("assigns a deeper page cap to dense tiles than sparse ones", () => {
    const plan = buildCrawlPlan(tiles, categories);
    const dense = plan.jobs.find(
      (j) => j.tileId === "downtown" && j.q === "restaurants",
    );
    const sparse = plan.jobs.find(
      (j) => j.tileId === "hatta" && j.q === "restaurants",
    );
    expect(dense?.maxPages).toBeGreaterThan(sparse?.maxPages ?? 0);
  });

  test("never exceeds the ~200-result ceiling with its page cap", () => {
    // page 11 returns zero, so anything above 10 wastes a request.
    const plan = buildCrawlPlan(tiles, categories);
    expect(Math.max(...plan.jobs.map((j) => j.maxPages))).toBeLessThanOrEqual(
      10,
    );
  });
});

describe("loadCity", () => {
  test("loads the committed Dubai tile set", () => {
    expect(tiles.length).toBeGreaterThan(20);
    expect(tiles.every((t) => t.lat > 24 && t.lat < 26)).toBe(true);
  });
});

describe("availableCities", () => {
  test("lists the city configs shipped in the repo", () => {
    // A city is data, so this grows without any code change.
    expect(availableCities()).toContain("dubai");
  });

  test("names the alternatives when a city config is missing", () => {
    // The error has to teach, since adding a city is the main extension point.
    expect(() => loadCity("atlantis")).toThrow(/Available:.*dubai/s);
  });
});

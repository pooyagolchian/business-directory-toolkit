import { describe, expect, test } from "vitest";
import { spaceOut } from "@directory/core";
import {
  availableCities,
  buildCrawlPlan,
  fitToBudget,
  loadCity,
  tilesAffordable,
} from "./plan";

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

describe("the committed city registry", () => {
  // The registry is about to grow from one hand-written config to many
  // generated ones. These two are the guard that a bad config fails CI rather
  // than someone's crawl.

  test("every committed config validates", () => {
    // loadCity validates now, so loading each one IS the assertion.
    for (const id of availableCities()) {
      expect(() => loadCity(id), `data/cities/${id}.json`).not.toThrow();
    }
  });

  test("every committed config plans at least one job", () => {
    // A config can be structurally valid and still plan nothing: PAGE_CAP gives
    // sparse tiles zero pages for standard and niche categories, so an all-sparse
    // city with no broad categories yields zero jobs. That spends no credits and
    // finds no businesses, and it looks exactly like a working config until the
    // crawl finishes empty. Structure alone cannot catch it.
    for (const id of availableCities()) {
      const city = loadCity(id);
      const plan = buildCrawlPlan(city.tiles, city.categories);
      expect(
        plan.jobs.length,
        `data/cities/${id}.json plans no jobs`,
      ).toBeGreaterThan(0);
    }
  });
});

describe("spaceOut against the hand-placed Dubai tiles", () => {
  // The only ground truth available: 44 tiles a human placed deliberately. A
  // spacing rule that cannot survive them is wrong, and this is free to check.
  const POI_BY_DENSITY = { dense: 500, medium: 200, sparse: 50 } as const;

  const candidates = dubai.tiles.map((t) => ({
    id: t.id,
    name: t.name,
    lat: t.lat,
    lng: t.lng,
    density: t.density,
    // Synthetic: this test is about spacing, not classification. Real POI
    // counts need an Overpass pass that has not been run.
    poiCount: POI_BY_DENSITY[t.density],
  }));

  test("keeps every hand-placed tile", () => {
    // If this ever fails, the default floors have been tuned past the point
    // where this repository's own reference city is reproducible.
    const kept = spaceOut(candidates);
    expect(kept).toHaveLength(dubai.tiles.length);
  });

  test("still collapses a genuine duplicate", () => {
    // Guard against the floors being so permissive they do nothing at all.
    const withDuplicate = [
      ...candidates,
      { ...candidates[0]!, id: "duplicate-of-first", poiCount: 1 },
    ];
    expect(spaceOut(withDuplicate)).toHaveLength(dubai.tiles.length);
  });
});

describe("fitToBudget", () => {
  test("keeps everything when the budget is ample", () => {
    const fit = fitToBudget(dubai.tiles, dubai.categories, 100_000);
    expect(fit.tiles).toHaveLength(dubai.tiles.length);
    expect(fit.dropped).toHaveLength(0);
  });

  test("never exceeds the budget it was given", () => {
    const fit = fitToBudget(dubai.tiles, dubai.categories, 2_000);
    expect(fit.maxRequests).toBeLessThanOrEqual(2_000);
  });

  test("chooses what to drop instead of letting the fetcher truncate", () => {
    // Dubai's own config plans 3,170 worst-case against a 2,000 budget. Today
    // the fetcher absorbs that with a hard cap, which means iteration order
    // decides which tiles lose coverage and nobody chose it. This is that
    // decision, made deliberately and reported.
    const fit = fitToBudget(dubai.tiles, dubai.categories, 2_000);
    expect(fit.dropped.length).toBeGreaterThan(0);
    expect(fit.tiles.length + fit.dropped.length).toBe(dubai.tiles.length);
  });

  test("agrees with buildCrawlPlan about what the kept tiles cost", () => {
    // The fit is worthless if it disagrees with the planner it is fitting to.
    const fit = fitToBudget(dubai.tiles, dubai.categories, 2_000);
    const plan = buildCrawlPlan(fit.tiles, dubai.categories);
    expect(plan.estimate.maxRequests).toBe(fit.maxRequests);
  });

  test("preserves the order it was given, which is the caller's priority", () => {
    const fit = fitToBudget(dubai.tiles, dubai.categories, 2_000);
    const keptIds = fit.tiles.map((t) => t.id);
    const expected = dubai.tiles
      .map((t) => t.id)
      .filter((id) => keptIds.includes(id));
    expect(keptIds).toEqual(expected);
  });

  test("keeps nothing costly on a zero budget", () => {
    const fit = fitToBudget(dubai.tiles, dubai.categories, 0);
    expect(fit.maxRequests).toBe(0);
  });

  test("handles an empty tile list", () => {
    const fit = fitToBudget([], dubai.categories, 2_000);
    expect(fit.tiles).toEqual([]);
    expect(fit.maxRequests).toBe(0);
  });
});

describe("fitToBudget prefers density over file order", () => {
  test("keeps every dense tile even when the config lists them last", () => {
    // The discriminating case. Admitting in file order lets whatever appears
    // first eat the budget; reversing Dubai's config puts the sparse desert
    // tiles at the front, and a correct fit must still spend the budget on the
    // dense ones.
    const reversed = [...dubai.tiles].reverse();
    const fit = fitToBudget(reversed, dubai.categories, 2_000);
    const denseTotal = dubai.tiles.filter((t) => t.density === "dense").length;
    const denseKept = fit.tiles.filter((t) => t.density === "dense").length;
    expect(denseKept).toBe(denseTotal);
  });

  test("keeps every dense tile once the budget can afford them all", () => {
    // A dense tile costs 120 worst-case against Dubai's 40 categories
    // (10 broad x 5 pages + 20 standard x 3 + 10 niche x 1), so 15 of them
    // need exactly 1,800.
    const fit = fitToBudget(dubai.tiles, dubai.categories, 1_800);
    expect(fit.dropped.filter((t) => t.density === "dense")).toHaveLength(0);
  });

  test("funds no medium tile while dense tiles are still going unfunded", () => {
    // At 1,250 the budget cannot hold all fifteen dense tiles, so five are
    // dropped. What must NOT happen is a medium tile being funded ahead of
    // them — that would be the file-order bug wearing a different hat.
    const fit = fitToBudget(dubai.tiles, dubai.categories, 1_250);
    expect(
      fit.dropped.filter((t) => t.density === "dense").length,
    ).toBeGreaterThan(0);
    expect(fit.tiles.filter((t) => t.density === "medium")).toHaveLength(0);
  });
});

describe("tilesAffordable", () => {
  const dubai = loadCity("dubai");

  test("returns Dubai's own tile count at Dubai's own budget, by construction", () => {
    // Not a validation, and the test name says so. DENSITY_SHARES is Dubai's
    // 15/18/11 and PAGE_CAP is what priced that config, so the weighted
    // average cost is exactly 3,170/44 and this division has no freedom to
    // return anything else. It is asserted to pin the arithmetic, not to claim
    // the generator rediscovered a human's judgement.
    expect(dubai.tiles).toHaveLength(44);
    expect(tilesAffordable(3170, dubai.categories)).toBe(44);
  });

  test("scales down with the budget", () => {
    expect(tilesAffordable(2000, dubai.categories)).toBe(27);
    expect(tilesAffordable(1250, dubai.categories)).toBe(17);
    expect(tilesAffordable(800, dubai.categories)).toBe(11);
  });

  test("a longer category list buys fewer tiles for the same money", () => {
    // The trade-off MAX_CATEGORIES exists to bound: cost is tiles times
    // categories, so categories and neighbourhoods compete for one budget.
    const doubled = [
      ...dubai.categories,
      ...dubai.categories.map((c) => ({ ...c, q: `${c.q} near me` })),
    ];
    expect(tilesAffordable(2000, doubled)).toBeLessThan(
      tilesAffordable(2000, dubai.categories),
    );
  });

  test("never returns zero, so the failure is a tile count and not an empty config", () => {
    expect(tilesAffordable(1, dubai.categories)).toBe(1);
  });

  test("a category list that plans nothing is free, and says so", () => {
    // PAGE_CAP gives sparse tiles zero pages for niche categories, so a
    // niche-only list against sparse tiles genuinely costs nothing.
    expect(tilesAffordable(100, [], { dense: 0, medium: 0, sparse: 1 })).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  parseCategoryMap,
  parseCityConfig,
  verificationState,
} from "@directory/core";
import { buildCrawlPlan } from "./plan";
import {
  GENERATOR_VERSION,
  MIN_CANDIDATE_TILES,
  generateCityConfig,
} from "./cities";
import type { OsmClient } from "./osm";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}
function fixture(name: string): unknown {
  return JSON.parse(read(`../../../fixtures/osm/${name}.json`));
}

const CATEGORY_MAP = parseCategoryMap(read("../../../data/category-map.json"));

/**
 * A client backed entirely by the recorded responses. Never opens a socket, and
 * records the call order so the four-request claim stays a claim with a test.
 */
function fixtureClient(
  city: "lisbon" | "dubai",
  overrides: Partial<Record<string, unknown>> = {},
  calls: string[] = [],
): OsmClient {
  const pick = (kind: string, fallback: unknown) =>
    kind in overrides ? overrides[kind] : fallback;
  return {
    async resolvePlace() {
      calls.push("resolvePlace");
      return pick("resolvePlace", fixture(`nominatim-${city}`));
    },
    async places() {
      calls.push("places");
      return pick("places", fixture(`overpass-places-${city}`));
    },
    async pois() {
      calls.push("pois");
      return pick("pois", fixture("overpass-pois-dubai-central"));
    },
    async categoryCounts() {
      calls.push("categoryCounts");
      return pick("categoryCounts", fixture(`overpass-counts-${city}`));
    },
  };
}

function options(
  city: "lisbon" | "dubai",
  extra: Record<string, unknown> = {},
) {
  return {
    name: city === "lisbon" ? "Lisbon" : "Dubai",
    budget: 2000,
    client: fixtureClient(city, extra.overrides as never, extra.calls as never),
    categoryMap: CATEGORY_MAP,
    today: "2026-08-22",
    ...extra,
  };
}

describe("generateCityConfig", () => {
  test("emits a config its own loader accepts", async () => {
    // The generator must never write something parseCityConfig would refuse —
    // otherwise the failure surfaces at crawl time, not generate time.
    const { city } = await generateCityConfig(options("dubai"));
    expect(() => parseCityConfig(JSON.stringify(city), "dubai")).not.toThrow();
  });

  test("marks provenance generated, never verified", async () => {
    const { city } = await generateCityConfig(options("dubai"));
    expect(city.verification).toEqual({
      status: "generated",
      source: "openstreetmap",
      generatedAt: "2026-08-22",
      generator: GENERATOR_VERSION,
    });
    expect(verificationState(city)).toBe("generated");
  });

  test("carries a city name the engine will actually return", async () => {
    // OSM calls Dubai "دبي"; the engine says "Dubai". Getting this wrong makes
    // isInCity reject every listing and the crawl finish empty.
    const { city } = await generateCityConfig(options("dubai"));
    expect(city.name).toBe("Dubai");
    expect(city.id).toBe("dubai");
    expect(city.cityNames).toContain("dubai");
    expect(city.countryCode).toBe("AE");
    expect(city.phoneRegion).toBe("AE");
  });

  test("recovers the Hatta exclave box from the boundary alone", async () => {
    const { city } = await generateCityConfig(options("dubai"));
    expect(city.boundingBoxes.some((b) => b.minLng > 56)).toBe(true);
  });

  test("fits the budget it was given", async () => {
    for (const budget of [2000, 1250, 600]) {
      const { city } = await generateCityConfig(options("dubai", { budget }));
      const plan = buildCrawlPlan(city.tiles, city.categories);
      expect(plan.estimate.maxRequests).toBeLessThanOrEqual(budget);
    }
  });

  test("a tighter budget sheds sparse tiles before dense ones", async () => {
    const { dropped } = await generateCityConfig(
      options("dubai", { budget: 600 }),
    );
    const denseDropped = dropped.filter((t) => t.density === "dense").length;
    const sparseDropped = dropped.filter((t) => t.density === "sparse").length;
    expect(sparseDropped).toBeGreaterThanOrEqual(denseDropped);
  });

  test("spends exactly four upstream requests", async () => {
    // The design note's original stage 4 was one Overpass count per candidate
    // centre — sixty-odd requests per city to a free public service.
    const calls: string[] = [];
    await generateCityConfig(options("dubai", { calls }));
    expect(calls).toEqual(["resolvePlace", "places", "pois", "categoryCounts"]);
  });

  test("is reproducible: same input, byte-identical output", async () => {
    const a = await generateCityConfig(options("dubai"));
    const b = await generateCityConfig(options("dubai"));
    expect(JSON.stringify(a.city)).toBe(JSON.stringify(b.city));
  });

  test("gives every tile a unique, readable id", async () => {
    const { city } = await generateCityConfig(options("dubai"));
    const ids = city.tiles.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
  });

  test("skips an unnameable neighbourhood instead of losing the city", async () => {
    // Some OSM nodes carry only a non-Latin name. One of those must not cost a
    // whole city, but it must not become an opaque /area/ hash either.
    const places = {
      elements: [
        ...(fixture("overpass-places-lisbon") as { elements: unknown[] })
          .elements,
        {
          type: "node",
          id: 999999,
          lat: 38.72,
          lon: -9.15,
          tags: { place: "suburb", name: "الحي" },
        },
      ],
    };
    const result = await generateCityConfig(
      options("lisbon", { overrides: { places } }),
    );
    expect(result.skipped).toBe(1);
    expect(result.city.tiles.length).toBeGreaterThan(0);
  });

  test("fails loudly when OSM has too few neighbourhoods to tile", async () => {
    // ADR 0014: a generated grid would be invented data wearing a generator's
    // credibility, and an even grid also wastes requests on water and desert.
    await expect(
      generateCityConfig(
        options("lisbon", { overrides: { places: { elements: [] } } }),
      ),
    ).rejects.toThrow(new RegExp(String(MIN_CANDIDATE_TILES)));
  });

  test("says how many candidates it considered when it refuses", async () => {
    // "OSM is thin here" and "my spacing floors are too wide" are different
    // problems with the same symptom, so the error separates them.
    const places = {
      elements: (
        fixture("overpass-places-lisbon") as {
          elements: Record<string, unknown>[];
        }
      ).elements.slice(0, 2),
    };
    await expect(
      generateCityConfig(options("lisbon", { overrides: { places } })),
    ).rejects.toThrow(/2 candidate/);
  });

  test("derives Lisbon's categories from Lisbon, not from Dubai", async () => {
    const lisbon = await generateCityConfig(options("lisbon"));
    const dubai = await generateCityConfig(options("dubai"));
    const lq = new Set(lisbon.city.categories.map((c) => c.q));
    const dq = new Set(dubai.city.categories.map((c) => c.q));
    expect([...dq].some((q) => !lq.has(q))).toBe(true);
  });
});

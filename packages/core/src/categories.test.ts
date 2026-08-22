import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  MAX_CATEGORIES,
  MIN_CATEGORY_COUNT,
  deriveCategories,
  parseCategoryMap,
} from "./categories";
import { parseOverpassCounts } from "./osm";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const MAP = parseCategoryMap(
  read("../../../data/category-map.json"),
  "category-map.json",
);
const TAGS = Object.keys(MAP);

function realCounts(city: string): Record<string, number> {
  return parseOverpassCounts(
    JSON.parse(read(`../../../fixtures/osm/overpass-counts-${city}.json`)),
    TAGS,
  );
}

const SMALL = {
  "amenity=restaurant": "restaurants",
  "amenity=pharmacy": "pharmacies",
  "amenity=bureau_de_change": "exchange houses",
  "shop=laundry": "laundry",
  "amenity=dentist": "dentists",
};

describe("parseCategoryMap", () => {
  test("reads the shipped map", () => {
    expect(Object.keys(MAP).length).toBeGreaterThan(80);
    expect(MAP["amenity=bureau_de_change"]).toBe("exchange houses");
  });

  test("skips the _readme, the way availableCities skips _template", () => {
    expect(Object.keys(MAP).some((k) => k.startsWith("_"))).toBe(false);
  });

  test("rejects a key that is not tag=value, which could never match", () => {
    expect(() => parseCategoryMap('{"pharmacy":"pharmacies"}')).toThrow(
      /tag=value/,
    );
  });

  test("rejects an empty search term, which would buy a blank query", () => {
    expect(() => parseCategoryMap('{"amenity=bar":"  "}')).toThrow(
      /amenity=bar/,
    );
  });
});

describe("deriveCategories", () => {
  test("drops a category the city does not really have", () => {
    const cats = deriveCategories(
      { "amenity=restaurant": 900, "amenity=bureau_de_change": 1 },
      SMALL,
    );
    expect(cats.map((c) => c.q)).toContain("restaurants");
    expect(cats.map((c) => c.q)).not.toContain("exchange houses");
  });

  test("sums two OSM tags that mean the same search", () => {
    // shop=travel_agency and office=travel_agent are both real tagging for the
    // same high street business, and the search term is what gets bought.
    const cats = deriveCategories(
      { "shop=travel_agency": 6, "office=travel_agent": 7 },
      {
        "shop=travel_agency": "travel agencies",
        "office=travel_agent": "travel agencies",
      },
    );
    expect(cats).toEqual([{ q: "travel agencies", tier: "broad" }]);
  });

  test("never emits a duplicate query, which parseCityConfig rejects", () => {
    const cats = deriveCategories(
      { "shop=travel_agency": 60, "office=travel_agent": 70 },
      {
        "shop=travel_agency": "travel agencies",
        "office=travel_agent": "travel agencies",
      },
    );
    expect(cats.filter((c) => c.q === "travel agencies")).toHaveLength(1);
  });

  test("is deterministic when counts tie", () => {
    const a = deriveCategories(
      { "amenity=pharmacy": 50, "amenity=dentist": 50 },
      SMALL,
    );
    const b = deriveCategories(
      { "amenity=dentist": 50, "amenity=pharmacy": 50 },
      SMALL,
    );
    expect(a).toEqual(b);
  });

  test("ranks the busiest category first and calls it broad", () => {
    const cats = deriveCategories(realCounts("dubai"), MAP);
    expect(cats[0]).toEqual({ q: "restaurants", tier: "broad" });
  });

  test("splits tiers 25/50/25, which is Dubai's own hand-tuned shape", () => {
    // data/cities/dubai.json is 10 broad / 20 standard / 10 niche across 40
    // categories. The design note said "decile"; the committed file says
    // quartile, and the file is the measurement.
    const cats = deriveCategories(realCounts("dubai"), MAP);
    expect(cats).toHaveLength(40);
    expect(cats.filter((c) => c.tier === "broad")).toHaveLength(10);
    expect(cats.filter((c) => c.tier === "standard")).toHaveLength(20);
    expect(cats.filter((c) => c.tier === "niche")).toHaveLength(10);
  });

  test("caps the list, because categories compete with tiles for the budget", () => {
    // A floor of 10 alone admits 84 categories in Dubai and 87 in Lisbon
    // against the hand-tuned 40. Cost per tile scales with the category list,
    // so an uncapped list halves how many tiles a budget can buy — and 40 is
    // the only category count anyone has actually crawled, which is what makes
    // the measured 10.9 unique-per-request figure applicable at all.
    for (const city of ["dubai", "lisbon"]) {
      expect(deriveCategories(realCounts(city), MAP).length).toBe(
        MAX_CATEGORIES,
      );
    }
  });

  test("keeps the regional categories that make the argument", () => {
    // Measured: 180 bureau_de_change and 241 tailors in central Dubai.
    const dubai = deriveCategories(realCounts("dubai"), MAP).map((c) => c.q);
    expect(dubai).toContain("exchange houses");
    expect(dubai).toContain("tailors");
  });

  test("gives a different city a different list", () => {
    // The whole reason categories are derived rather than copied. Lisbon has
    // 16 tailors and 10 bureaux de change; Dubai has 241 and 180.
    const dubai = new Set(
      deriveCategories(realCounts("dubai"), MAP).map((c) => c.q),
    );
    const lisbon = new Set(
      deriveCategories(realCounts("lisbon"), MAP).map((c) => c.q),
    );
    const onlyDubai = [...dubai].filter((q) => !lisbon.has(q));
    expect(onlyDubai.length).toBeGreaterThan(0);
  });

  test("always leaves at least one broad category", () => {
    // Below two categories the 25% share rounds to zero broad, and a city with
    // no broad category can plan nothing at all: PAGE_CAP gives a sparse tile
    // zero pages for standard and niche alike. The config would validate,
    // spend nothing, find nothing, and look fine until the crawl ended empty.
    const one = deriveCategories({ "amenity=restaurant": 900 }, SMALL);
    expect(one).toEqual([{ q: "restaurants", tier: "broad" }]);
    const two = deriveCategories(
      { "amenity=restaurant": 900, "amenity=pharmacy": 50 },
      SMALL,
    );
    expect(two.filter((c) => c.tier === "broad")).toHaveLength(1);
  });

  test("the three tiers always sum to the whole list", () => {
    for (const n of [1, 2, 3, 5, 7, 13, 40]) {
      const counts = Object.fromEntries(
        Array.from({ length: n }, (_, i) => [`k${i}`, (n - i) * 100]),
      );
      const map = Object.fromEntries(
        Array.from({ length: n }, (_, i) => [`k${i}`, `q${i}`]),
      );
      const cats = deriveCategories(counts, map);
      expect(cats).toHaveLength(n);
      expect(cats.filter((c) => c.tier === "broad").length).toBeGreaterThan(0);
    }
  });

  test("respects the floor even when it leaves very few categories", () => {
    const cats = deriveCategories(
      { "amenity=restaurant": MIN_CATEGORY_COUNT - 1 },
      SMALL,
    );
    expect(cats).toEqual([]);
  });

  test("admits a category sitting exactly on the floor", () => {
    const cats = deriveCategories(
      { "amenity=restaurant": MIN_CATEGORY_COUNT },
      SMALL,
    );
    expect(cats).toHaveLength(1);
  });

  test("ignores a count for a tag the map does not carry", () => {
    expect(deriveCategories({ "amenity=telephone": 900 }, SMALL)).toEqual([]);
  });
});

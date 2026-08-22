import { describe, expect, test } from "vitest";
import type { Business } from "./types";
import {
  ACCESSIBILITY_VALUES,
  RATING_STEPS,
  REVIEW_STEPS,
  canonicalAmenity,
  facetSearch,
  paginate,
  parseSortKey,
  sortBusinesses,
  toCategorySlug,
  toggleFilter,
  parseFilter,
  parsePage,
  filterToQuery,
  type BusinessFilter,
} from "./facets";
import { corpusPrior } from "./rank";

let seq = 0;

/**
 * A business with only the fields a test cares about.
 *
 * `placeId` is generated rather than passed, because nothing here is ever
 * looked up by id and every test would otherwise carry the same noise.
 */
function b(fields: Partial<Business> = {}): Business {
  seq += 1;
  return {
    placeId: `place-${seq}`,
    slug: `slug-${seq}`,
    title: `Business ${seq}`,
    area: "downtown",
    types: [],
    ...fields,
  };
}

const noFilter = {};

describe("toCategorySlug", () => {
  test("matches the slug shape already in the category URLs", () => {
    // These URLs are live and indexed. If this function disagreed with the one
    // it replaces, every /category/ link on the site would 404 at once.
    expect(toCategorySlug("Restaurants")).toBe("restaurants");
    expect(toCategorySlug("Banking & Exchange")).toBe("banking-exchange");
    expect(toCategorySlug("Labs & Diagnostics")).toBe("labs-diagnostics");
  });

  test("folds diacritics rather than dropping the letter", () => {
    // No Dubai category carries an accent, so this changes nothing today. It
    // matters for the next city: ADR 0005 says a city is data, and "Cafés"
    // must not slug to "caf-s" the first time someone crawls Montreal.
    expect(toCategorySlug("Cafés")).toBe("cafes");
  });
});

describe("canonicalAmenity", () => {
  test("folds the US spelling onto the UK one", () => {
    // Google returns both spellings for the same physical feature. Filtering on
    // one silently hides the other's listings — 1,742 businesses in the Dubai
    // crawl carry only "parking-lot" and would vanish from a car-park filter.
    expect(canonicalAmenity("wheelchair-accessible-parking-lot")).toBe(
      "wheelchair-accessible-car-park",
    );
    expect(canonicalAmenity("wheelchair-accessible-restroom")).toBe(
      "wheelchair-accessible-toilet",
    );
  });

  test("leaves a value it does not know alone", () => {
    expect(canonicalAmenity("assistive-hearing-loop")).toBe(
      "assistive-hearing-loop",
    );
  });
});

describe("facetSearch — filtering", () => {
  test("returns everything when no filter is set", () => {
    const all = [b(), b(), b()];
    const result = facetSearch(all, noFilter);
    expect(result.items).toHaveLength(3);
    expect(result.total).toBe(3);
  });

  test("filters by category slug, not category label", () => {
    const all = [b({ l2: "Banking & Exchange" }), b({ l2: "Restaurants" })];
    const result = facetSearch(all, { category: "banking-exchange" });
    expect(result.items.map((x) => x.l2)).toEqual(["Banking & Exchange"]);
  });

  test("filters by area", () => {
    const all = [b({ area: "downtown" }), b({ area: "deira" })];
    expect(facetSearch(all, { area: "deira" }).items).toHaveLength(1);
  });

  test("excludes an unrated business from a minimum-rating filter", () => {
    // A missing rating is absence of evidence, not a passing grade. Letting it
    // through would put unrated listings inside a "4.5+" result set, which is
    // the one thing that filter promises it will not contain.
    const all = [b({ rating: 4.6 }), b({ rating: 4.1 }), b({})];
    const result = facetSearch(all, { minRating: 4.5 });
    expect(result.items.map((x) => x.rating)).toEqual([4.6]);
  });

  test("excludes a business with no review count from a minimum-reviews filter", () => {
    const all = [b({ reviews: 600 }), b({ reviews: 10 }), b({})];
    expect(facetSearch(all, { minReviews: 50 }).items).toHaveLength(1);
  });

  test("treats presence filters as AND, not OR", () => {
    const all = [
      b({ phoneE164: "+97145776680", website: "https://example.com" }),
      b({ phoneE164: "+97145776681" }),
      b({ website: "https://example.org" }),
    ];
    const result = facetSearch(all, { has: ["phone", "website"] });
    expect(result.items).toHaveLength(1);
  });

  test("counts an empty opening-hours object as no hours", () => {
    // The normaliser writes `{}` rather than omitting the key for a listing the
    // engine returned without hours, so a truthiness check alone lets it pass.
    const all = [b({ openHours: { monday: "9-5" } }), b({ openHours: {} })];
    expect(facetSearch(all, { has: ["hours"] }).items).toHaveLength(1);
  });

  test("matches an accessibility filter through either spelling", () => {
    const all = [
      b({ accessibility: ["wheelchair-accessible-car-park"] }),
      b({ accessibility: ["wheelchair-accessible-parking-lot"] }),
      b({ accessibility: ["assistive-hearing-loop"] }),
    ];
    const result = facetSearch(all, {
      accessibility: "wheelchair-accessible-car-park",
    });
    expect(result.items).toHaveLength(2);
  });

  test("ANDs every filter group together", () => {
    const all = [
      b({ l2: "Restaurants", area: "downtown", rating: 4.8, reviews: 900 }),
      b({ l2: "Restaurants", area: "deira", rating: 4.8, reviews: 900 }),
      b({ l2: "Cafes", area: "downtown", rating: 4.8, reviews: 900 }),
      b({ l2: "Restaurants", area: "downtown", rating: 3.2, reviews: 900 }),
    ];
    const result = facetSearch(all, {
      category: "restaurants",
      area: "downtown",
      minRating: 4.5,
    });
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
  });
});

describe("facetSearch — facet counts", () => {
  const corpus = [
    b({ l2: "Restaurants", area: "downtown", rating: 4.8, reviews: 900 }),
    b({ l2: "Restaurants", area: "downtown", rating: 4.2, reviews: 900 }),
    b({ l2: "Restaurants", area: "deira", rating: 4.9, reviews: 900 }),
    b({ l2: "Cafes", area: "downtown", rating: 4.9, reviews: 900 }),
    b({ l2: "Cafes", area: "deira", rating: 3.1, reviews: 10 }),
  ];

  test("counts a facet with the OTHER filters applied but not its own", () => {
    // The whole point of a faceted count. If the category filter counted
    // itself, picking "Restaurants" would collapse the category list to a
    // single row and there would be no way to switch to Cafes without first
    // clearing — the classic dead-end faceted search.
    const result = facetSearch(corpus, { category: "restaurants" });

    const categories = Object.fromEntries(
      result.facets.category.map((f) => [f.value, f.count]),
    );
    expect(categories).toEqual({ restaurants: 3, cafes: 2 });

    // Areas, by contrast, DO narrow: these are the areas that have restaurants.
    const areas = Object.fromEntries(
      result.facets.area.map((f) => [f.value, f.count]),
    );
    expect(areas).toEqual({ downtown: 2, deira: 1 });
  });

  test("carries the human label for a category, and the slug for an area", () => {
    // Area names live in the city config, which core cannot read without doing
    // I/O. The web layer resolves them; core reports the slug it was given.
    const result = facetSearch(corpus, noFilter);
    const banking = result.facets.category.find(
      (f) => f.value === "restaurants",
    );
    expect(banking?.label).toBe("Restaurants");
    expect(result.facets.area[0]?.label).toBe(result.facets.area[0]?.value);
  });

  test("orders facet values by count, descending", () => {
    const result = facetSearch(corpus, noFilter);
    expect(result.facets.category.map((f) => f.value)).toEqual([
      "restaurants",
      "cafes",
    ]);
  });

  test("breaks a count tie alphabetically so the order is stable", () => {
    // Facet rows are links. An order that depends on corpus iteration would
    // reshuffle the chips between two renders of the same query.
    const tied = [b({ l2: "Zoos" }), b({ l2: "Bakeries" })];
    const result = facetSearch(tied, noFilter);
    expect(result.facets.category.map((f) => f.value)).toEqual([
      "bakeries",
      "zoos",
    ]);
  });

  test("drops a value that nothing matches", () => {
    const result = facetSearch(corpus, { area: "deira" });
    // Only Restaurants and Cafes exist in Deira; no third category appears.
    expect(result.facets.category.map((f) => f.value)).toEqual([
      "cafes",
      "restaurants",
    ]);
  });

  test("keeps a selected value visible even when its count is zero", () => {
    // Otherwise the chip that produced an empty result set disappears along
    // with the results, and there is nothing left to click to undo it.
    const result = facetSearch(corpus, {
      category: "restaurants",
      minRating: 4.5,
      area: "deira",
      accessibility: "wheelchair-accessible-car-park",
    });
    expect(result.items).toHaveLength(0);
    const selected = result.facets.accessibility.find((f) => f.selected);
    expect(selected).toMatchObject({
      value: "wheelchair-accessible-car-park",
      count: 0,
      selected: true,
    });
  });

  test("keeps the real label on a selected value forced to zero", () => {
    // The chip is kept visible so there is something left to click to undo the
    // filter — which fails if the chip is renamed at the same moment. Slug
    // title-casing loses the ampersand ("Banking & Exchange" -> "Banking
    // Exchange") and the accessibility casing ("Wheelchair-accessible car park"
    // -> "Wheelchair Accessible Car Park"), so the one chip that undoes the
    // dead end is the one chip printed under a name found nowhere else.
    const all = [
      b({
        l2: "Banking & Exchange",
        area: "downtown",
        accessibility: ["wheelchair-accessible-car-park"],
      }),
    ];
    const result = facetSearch(all, {
      category: "banking-exchange",
      accessibility: "wheelchair-accessible-car-park",
      // Nothing clears this, so both selected chips fall to zero.
      minReviews: 500,
    });

    expect(result.items).toHaveLength(0);
    expect(result.facets.category.find((f) => f.selected)).toMatchObject({
      label: "Banking & Exchange",
      count: 0,
    });
    expect(result.facets.accessibility.find((f) => f.selected)).toMatchObject({
      label: "Wheelchair-accessible car park",
      count: 0,
    });
  });

  test("falls back to a readable name when even the corpus cannot label it", () => {
    // A hand-edited ?cat= for a category no business in the match set carries.
    // There is no real label to recover, so a title-cased slug is the honest
    // answer — it is only wrong when a better name was available.
    const result = facetSearch([b({ l2: "Restaurants" })], {
      category: "scuba-diving",
    });
    expect(result.facets.category.find((f) => f.selected)).toMatchObject({
      label: "Scuba Diving",
      count: 0,
    });
  });

  test("marks the selected value in each group", () => {
    const result = facetSearch(corpus, { area: "deira" });
    expect(result.facets.area.find((f) => f.value === "deira")?.selected).toBe(
      true,
    );
    expect(
      result.facets.area.find((f) => f.value === "downtown")?.selected,
    ).toBe(false);
  });

  test("folds both amenity spellings into one facet row", () => {
    const all = [
      b({ accessibility: ["wheelchair-accessible-car-park"] }),
      b({ accessibility: ["wheelchair-accessible-parking-lot"] }),
    ];
    const rows = facetSearch(all, noFilter).facets.accessibility;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      value: "wheelchair-accessible-car-park",
      count: 2,
    });
  });

  test("counts a business carrying both spellings only once", () => {
    // No listing in the current crawl does this, but a future one can: the two
    // spellings come from different Google surfaces, not from one field.
    const all = [
      b({
        accessibility: [
          "wheelchair-accessible-car-park",
          "wheelchair-accessible-parking-lot",
        ],
      }),
    ];
    const rows = facetSearch(all, noFilter).facets.accessibility;
    expect(rows[0]?.count).toBe(1);
  });

  test("reports only the accessibility values worth offering", () => {
    // An allow-list, mirroring the one in amenities.ts. The engine invents new
    // attribute strings, and a facet row that appears on its own is a
    // publishing decision nobody made.
    const all = [b({ accessibility: ["some-new-google-attribute"] })];
    expect(facetSearch(all, noFilter).facets.accessibility).toHaveLength(0);
    expect(ACCESSIBILITY_VALUES).toContain("wheelchair-accessible-entrance");
  });

  test("counts a presence chip as the result set that clicking it produces", () => {
    // `has` is the one group whose values AND together rather than replace each
    // other, so it cannot be counted the way the single-choice groups are.
    // Counting it with the whole group excluded would advertise "Has website 2"
    // next to a chip that actually yields 1 — a number the reader can never
    // reach by clicking. Each chip is counted with the OTHER groups applied,
    // the already-selected presence keys kept, and its own key added.
    const all = [
      b({ phoneE164: "+97145776680" }),
      b({ website: "https://example.com" }),
      b({ phoneE164: "+97145776681", website: "https://example.org" }),
    ];
    const result = facetSearch(all, { has: ["phone"] });
    const counts = Object.fromEntries(
      result.facets.has.map((f) => [f.value, f.count]),
    );
    // Already selected, so it describes the set on screen.
    expect(counts.phone).toBe(2);
    // Adding website to the existing phone filter leaves exactly one.
    expect(counts.website).toBe(1);
    expect(counts.hours).toBe(0);
  });

  test("still narrows presence counts by the other filter groups", () => {
    const all = [
      b({ area: "downtown", phoneE164: "+97145776680" }),
      b({ area: "deira", phoneE164: "+97145776681" }),
    ];
    const result = facetSearch(all, { area: "downtown" });
    expect(result.facets.has.find((f) => f.value === "phone")?.count).toBe(1);
  });

  test("counts each rating step against the unrated-filter result set", () => {
    const result = facetSearch(corpus, noFilter);
    const counts = Object.fromEntries(
      result.facets.rating.map((f) => [f.value, f.count]),
    );
    expect(counts["4"]).toBe(4);
    expect(counts["4.5"]).toBe(3);
    expect(RATING_STEPS).toEqual([4, 4.5]);
    expect(REVIEW_STEPS).toEqual([50, 500]);
  });

  test("keeps a rating step visible at zero because it is a threshold, not a value", () => {
    // Unlike a category, a step that currently matches nothing still has to be
    // clickable — its absence would silently change which thresholds exist.
    const all = [b({ rating: 3.1, reviews: 5 })];
    const result = facetSearch(all, noFilter);
    expect(result.facets.rating.map((f) => f.value)).toEqual(["4", "4.5"]);
    expect(result.facets.rating.every((f) => f.count === 0)).toBe(true);
  });
});

describe("sortBusinesses", () => {
  const prior = corpusPrior([{ rating: 4.5, reviews: 100 }]);

  test("leaves relevance order exactly as it was given", () => {
    // The web layer scores relevance before calling in; re-sorting here would
    // put the highest-ranked restaurant above an exact-title match.
    const all = [
      b({ title: "Zed", rating: 5, reviews: 3 }),
      b({ title: "Al" }),
    ];
    const sorted = sortBusinesses(all, "relevance", prior);
    expect(sorted.map((x) => x.title)).toEqual(["Zed", "Al"]);
  });

  test("does not mutate the array it was given", () => {
    const all = [b({ title: "Zed" }), b({ title: "Al" })];
    sortBusinesses(all, "name", prior);
    expect(all.map((x) => x.title)).toEqual(["Zed", "Al"]);
  });

  test("ranks a well-reviewed 4.6 above a lone 5.0", () => {
    const lone = b({ title: "Lone", rating: 5, reviews: 1 });
    const busy = b({ title: "Busy", rating: 4.6, reviews: 2000 });
    expect(sortBusinesses([lone, busy], "best", prior)[0]?.title).toBe("Busy");
  });

  test("puts the lone 5.0 first when sorting by rating, which is what that asks for", () => {
    const lone = b({ title: "Lone", rating: 5, reviews: 1 });
    const busy = b({ title: "Busy", rating: 4.6, reviews: 2000 });
    expect(sortBusinesses([lone, busy], "rating", prior)[0]?.title).toBe(
      "Lone",
    );
  });

  test("sorts by review count and by name", () => {
    const few = b({ title: "Zed", reviews: 5 });
    const many = b({ title: "Al", reviews: 500 });
    expect(sortBusinesses([few, many], "reviews")[0]?.title).toBe("Al");
    expect(sortBusinesses([few, many], "name")[0]?.title).toBe("Al");
  });

  test("sorts names with a locale comparison, not by code point", () => {
    // Bilingual titles are the norm here; a code-point sort files every
    // accented and non-Latin name after Z.
    const sorted = sortBusinesses(
      [b({ title: "Zaatar" }), b({ title: "Émile" }), b({ title: "Amir" })],
      "name",
    );
    expect(sorted.map((x) => x.title)).toEqual(["Amir", "Émile", "Zaatar"]);
  });
});

describe("parseSortKey", () => {
  test("accepts a known key and rejects anything else", () => {
    // The value arrives from a URL a stranger can edit.
    expect(parseSortKey("rating")).toBe("rating");
    expect(parseSortKey("../../etc/passwd")).toBe("relevance");
    expect(parseSortKey(undefined)).toBe("relevance");
    // ?sort=rating&sort=name reaches Next as an array, like every other param.
    expect(parseSortKey(["name", "rating"])).toBe("name");
  });
});

describe("paginate", () => {
  const items = Array.from({ length: 125 }, (_, i) => i);

  test("slices the requested page and reports 1-based display bounds", () => {
    expect(paginate(items, 2, 50)).toMatchObject({
      page: 2,
      pages: 3,
      from: 51,
      to: 100,
      total: 125,
    });
    expect(paginate(items, 2, 50).items[0]).toBe(50);
  });

  test("reports a short final page honestly", () => {
    expect(paginate(items, 3, 50)).toMatchObject({ from: 101, to: 125 });
    expect(paginate(items, 3, 50).items).toHaveLength(25);
  });

  test("clamps a page number out of range instead of returning nothing", () => {
    // ?page=999 is a stale link or a crawler, not an error worth a 404.
    expect(paginate(items, 999, 50).page).toBe(3);
    expect(paginate(items, 0, 50).page).toBe(1);
    expect(paginate(items, Number.NaN, 50).page).toBe(1);
    expect(paginate(items, -4, 50).page).toBe(1);
  });

  test("describes an empty result set without inventing a row", () => {
    expect(paginate([], 1, 50)).toMatchObject({
      page: 1,
      pages: 1,
      from: 0,
      to: 0,
      total: 0,
    });
  });
});

describe("parseFilter", () => {
  test("reads every group off the query string", () => {
    expect(
      parseFilter({
        cat: "banking-exchange",
        area: "downtown",
        rating: "4.5",
        reviews: "500",
        has: "phone,website",
        access: "wheelchair-accessible-entrance",
      }),
    ).toEqual({
      category: "banking-exchange",
      area: "downtown",
      minRating: 4.5,
      minReviews: 500,
      has: ["phone", "website"],
      accessibility: "wheelchair-accessible-entrance",
    });
  });

  test("returns an empty filter for an empty query string", () => {
    expect(parseFilter({})).toEqual({});
  });

  test("drops a threshold that is not one of the offered steps", () => {
    // Otherwise ?rating=4.9 renders a page whose chips all read "unselected"
    // while the results are silently filtered by something not on offer.
    expect(parseFilter({ rating: "4.9" })).toEqual({});
    expect(parseFilter({ reviews: "1" })).toEqual({});
    expect(parseFilter({ rating: "abc" })).toEqual({});
  });

  test("rejects a category or area that is not slug-shaped", () => {
    // These reach a filesystem-backed lookup and end up in rendered links.
    expect(parseFilter({ cat: "../../etc/passwd" })).toEqual({});
    expect(parseFilter({ area: "<script>alert(1)</script>" })).toEqual({});
    expect(parseFilter({ cat: "a".repeat(200) })).toEqual({});
  });

  test("keeps only known presence keys, in their declared order", () => {
    expect(parseFilter({ has: "website,nonsense,phone" })).toEqual({
      has: ["phone", "website"],
    });
    expect(parseFilter({ has: "phone,phone" })).toEqual({ has: ["phone"] });
    expect(parseFilter({ has: "nonsense" })).toEqual({});
  });

  test("accepts an accessibility value under either spelling", () => {
    // A link shared before the two spellings were folded together still works.
    expect(
      parseFilter({ access: "wheelchair-accessible-parking-lot" }),
    ).toEqual({ accessibility: "wheelchair-accessible-car-park" });
    expect(parseFilter({ access: "not-an-attribute" })).toEqual({});
  });

  test("takes the first value when a param is repeated", () => {
    // ?area=deira&area=downtown reaches Next as an array.
    expect(parseFilter({ area: ["deira", "downtown"] })).toEqual({
      area: "deira",
    });
  });
});

describe("parsePage", () => {
  test("defaults to the first page and refuses nonsense", () => {
    expect(parsePage(undefined)).toBe(1);
    expect(parsePage("3")).toBe(3);
    expect(parsePage("0")).toBe(1);
    expect(parsePage("-2")).toBe(1);
    expect(parsePage("abc")).toBe(1);
    expect(parsePage("1e9")).toBe(1);
  });
});

describe("filterToQuery", () => {
  test("round-trips a filter through the query string", () => {
    const filter: BusinessFilter = {
      category: "restaurants",
      area: "downtown",
      minRating: 4,
      minReviews: 50,
      has: ["phone", "hours"],
      accessibility: "wheelchair-accessible-toilet",
    };
    expect(parseFilter(filterToQuery(filter))).toEqual(filter);
  });

  test("omits everything that is not set, so a bare search stays a bare URL", () => {
    expect(filterToQuery({})).toEqual({});
  });

  test("writes a whole rating step without a trailing zero", () => {
    // ?rating=4, not ?rating=4.0 — the parse accepts both, but only one of them
    // is the URL people see and share.
    expect(filterToQuery({ minRating: 4 }).rating).toBe("4");
    expect(filterToQuery({ minRating: 4.5 }).rating).toBe("4.5");
  });
});

describe("toggleFilter", () => {
  test("sets a value that was not selected", () => {
    expect(toggleFilter({}, "category", "restaurants")).toEqual({
      category: "restaurants",
    });
  });

  test("clears a value by selecting it again", () => {
    // Every chip is its own off switch. Without this the only way out of a
    // filter is Clear all, which also throws away the other three.
    expect(
      toggleFilter({ category: "restaurants" }, "category", "restaurants"),
    ).toEqual({});
  });

  test("replaces rather than accumulates within a single-choice group", () => {
    expect(toggleFilter({ area: "deira" }, "area", "downtown")).toEqual({
      area: "downtown",
    });
  });

  test("adds and removes presence keys without disturbing the others", () => {
    const withPhone = toggleFilter({}, "has", "phone");
    expect(withPhone).toEqual({ has: ["phone"] });

    const withBoth = toggleFilter(withPhone, "has", "website");
    expect(withBoth).toEqual({ has: ["phone", "website"] });

    expect(toggleFilter(withBoth, "has", "phone")).toEqual({
      has: ["website"],
    });
  });

  test("drops the key entirely when the last presence toggle comes off", () => {
    // A lingering `has: []` would serialise to `?has=` — a filter that reads as
    // set, matches everything, and cannot be cleared from the UI.
    expect(toggleFilter({ has: ["phone"] }, "has", "phone")).toEqual({});
  });

  test("toggles the numeric thresholds", () => {
    expect(toggleFilter({}, "rating", "4.5")).toEqual({ minRating: 4.5 });
    expect(toggleFilter({ minRating: 4.5 }, "rating", "4.5")).toEqual({});
    expect(toggleFilter({ minReviews: 50 }, "reviews", "500")).toEqual({
      minReviews: 500,
    });
  });

  test("leaves the filter it was given untouched", () => {
    // The page renders one href per chip from the same base filter object.
    const base: BusinessFilter = { has: ["phone"] };
    toggleFilter(base, "has", "website");
    toggleFilter(base, "category", "restaurants");
    expect(base).toEqual({ has: ["phone"] });
  });

  test("ignores a value the group does not offer", () => {
    expect(toggleFilter({}, "rating", "4.9")).toEqual({});
    expect(toggleFilter({}, "has", "nonsense")).toEqual({});
  });
});

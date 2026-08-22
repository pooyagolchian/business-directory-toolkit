# Global City Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `pnpm cities generate --name "Lisbon" --budget 2000` produce a valid, budget-fitted `data/cities/lisbon.json` from OpenStreetMap alone, spending zero SearchApi credits.

**Architecture:** Pure parsing and selection live in `packages/core` and are TDD'd against recorded fixtures. The network half lives in `packages/pipeline/src/osm.ts` behind an injected `fetch`, with a disk cache under the git-ignored `data/osm-cache/`. A city costs **four upstream requests total** — one Nominatim resolve, three Overpass queries — because density is counted locally from one bulk POI fetch rather than one request per candidate, and category counts are batched into a single multi-`out count` query.

**Tech Stack:** TypeScript strict + ESM, Node 24 global `fetch`, Vitest, `libphonenumber-js/max`. **No new dependency.**

**Spec:** [docs/superpowers/specs/2026-08-22-global-city-registry-design.md](../specs/2026-08-22-global-city-registry-design.md)
**ADR:** [docs/adr/0014-generate-the-city-registry.md](../../adr/0014-generate-the-city-registry.md)

## Global Constraints

- **TDD is mandatory for `packages/core`.** Write the test, run it, watch it fail, then implement.
- **No test may open a socket.** Every test reads `fixtures/osm/`. Overpass costs no credits, but determinism is the rule, not just money.
- **No new npm dependency.** Node 24 has global `fetch`; `libphonenumber-js` already maps `countryCode` → dialling region.
- **Never commit crawled data.** `data/osm-cache/` is added to `.gitignore` in Task 5.
- **Every generated config passes `parseCityConfig` before being written.** The generator cannot emit something `loadCity` would reject.
- **Fail loud.** Too few candidates, an unresolvable name, or a missing boundary prints the cause and exits non-zero. Never fall back to an even grid.
- **Nominatim etiquette:** ≤1 request/second, and a real `User-Agent` identifying the project. Overpass: serialise requests, never parallelise.
- Generator version constant: `GENERATOR_VERSION = "0.1.0"`, written into `verification.generator`.

## Corrections this plan makes to the spec

The spec was written before the data was checked. Three of its statements do not survive contact and are changed here deliberately:

1. **Tier split is quartile, not decile.** The spec says "top decile `broad`, middle `standard`, tail `niche`". `data/cities/dubai.json` is 10 `broad` / 20 `standard` / 10 `niche` — **25 / 50 / 25**. The generator matches the file, which is measurable ground truth, not the prose.
2. **Density is counted locally, not per-candidate.** The spec's stage 4 is "one Overpass count per candidate", which is 60+ requests to a free public service per city. One bulk `out skel qt` fetch over the city bbox plus local counting with `distanceKm` gives the same numbers in one request.
3. **`zoom` is not a function of `density` in the hand-tuned config.** Dubai uses zoom 14 for ten medium tiles and 15 for eight others; 13 for five sparse and 14 for six. The generator uses the `_template.json` mapping (dense 15, medium 14, sparse 13) and the calibration gate in Task 9 **reports** the disagreement rather than tuning it away — the same discipline the spec applies to spacing.

## File structure

| File                                   | Responsibility                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/osm.ts`             | Pure: Nominatim/Overpass response shapes → `ResolvedPlace`, `OsmPlaceNode`, bounding boxes, tile ids. No I/O. |
| `packages/core/src/osm.test.ts`        | Its tests, reading `fixtures/osm/`.                                                                           |
| `packages/core/src/categories.ts`      | Pure: parse `data/category-map.json`, turn tag counts into tiered `CityCategory[]`.                           |
| `packages/core/src/categories.test.ts` | Its tests.                                                                                                    |
| `packages/pipeline/src/osm.ts`         | Network: Nominatim + Overpass clients, rate limiting, disk cache, query building.                             |
| `packages/pipeline/src/osm.test.ts`    | Query-builder and cache-key tests; clients driven by a fake `fetch`.                                          |
| `packages/pipeline/src/cities.ts`      | Orchestration: `generateCityConfig` wires the four requests into a `CityConfig`.                              |
| `packages/pipeline/src/cities.test.ts` | Full generation against fixture-backed fake clients.                                                          |
| `packages/pipeline/src/cli/cities.ts`  | `generate` / `validate` / `calibrate` subcommands.                                                            |
| `data/category-map.json`               | The one hand-maintained artefact: OSM tag → Google search term.                                               |
| `fixtures/osm/`                        | Recorded Nominatim + Overpass responses for Lisbon and Dubai.                                                 |

---

### Task 1: Derive `gl` from the city, not from a constant

`packages/pipeline/src/searchapi.ts:18` sets Google's country-of-search parameter to the literal `"ae"` on every request for every city. `packages/pipeline/src/cli/demand.ts:124` already derives it correctly. This is an ADR 0005 violation that spends real credits on UAE-localised results in cities that are not in the UAE, and it must be fixed before any generated config is crawlable.

`gl` is made a **required** field on `SearchParams` rather than an option with a default, because a default is exactly how `"ae"` survived. Making it required means the compiler finds every call site.

**Files:**

- Modify: `packages/pipeline/src/fetch.ts:5-11` (`SearchParams`), `:36-46` (`CrawlOptions`), `:122-129` (params construction)
- Modify: `packages/pipeline/src/searchapi.ts:11-21` (`buildSearchUrl`)
- Modify: `packages/pipeline/src/handlers/fetch.ts:11-15` (`CrawlMessage`), `:33-41`, `:76-80`
- Modify: `packages/pipeline/src/cli/crawl.ts` (pass `gl` from the loaded city)
- Test: `packages/pipeline/src/searchapi.test.ts:26-31`, `packages/pipeline/src/fetch.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `SearchParams.gl: string`; `CrawlOptions.gl: string`. Every later task assumes a crawl is country-correct.

- [ ] **Step 1: Write the failing test**

Replace the existing `gl` assertion in `packages/pipeline/src/searchapi.test.ts` and add its counterpart:

```ts
test("pins results to the city's own country, not a hard-coded one", () => {
  // The bug this replaces: gl was the literal "ae" for every city, so a
  // Lisbon crawl asked Google for UAE-localised results and paid for them.
  expect(buildSearchUrl({ ...params, gl: "pt" }).searchParams.get("gl")).toBe(
    "pt",
  );
  expect(buildSearchUrl({ ...params, gl: "ae" }).searchParams.get("gl")).toBe(
    "ae",
  );
});
```

Add `gl: "ae"` to the shared `params` object at `searchapi.test.ts:5-12` so the other tests still compile.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run packages/pipeline/src/searchapi.test.ts`
Expected: FAIL — TypeScript rejects `gl` as an unknown property on `SearchParams`, or the `"pt"` case returns `"ae"`.

- [ ] **Step 3: Make `gl` a required part of a request**

In `packages/pipeline/src/fetch.ts`:

```ts
export interface SearchParams {
  q: string;
  lat: number;
  lng: number;
  zoom: number;
  page: number;
  tileId: string;
  /**
   * Google's country-of-search, lowercase ISO-3166 alpha-2, from the city
   * config. Required rather than defaulted on purpose: this field spent the
   * whole of v0.1 hard-coded to "ae" because a default is invisible, and only
   * a compile error finds every call site.
   */
  gl: string;
}
```

In `packages/pipeline/src/searchapi.ts`, replace line 18:

```ts
url.searchParams.set("gl", params.gl);
```

`hl` stays `"en"`: the category map is English search terms, so asking in another interface language would not change what is being asked for. That limit is recorded in ADR 0014's Bad list.

- [ ] **Step 4: Thread it through both request paths**

`CrawlOptions` in `packages/pipeline/src/fetch.ts` gains `gl: string`, and the params construction at `:122` gains `gl: options.gl` — read it off the already-destructured options.

`CrawlMessage` in `packages/pipeline/src/handlers/fetch.ts` gains `gl: string`; the params at `:34` gain `gl: job.gl`, and the pagination message at `:76` copies `gl: job.gl` so a followed page keeps the country of the page that produced it.

In `packages/pipeline/src/cli/crawl.ts`, pass `gl: cityConfig.countryCode.toLowerCase()` into `runCrawl`'s options alongside the existing `budget`.

- [ ] **Step 5: Run the whole suite**

Run: `rtk vitest && rtk tsc`
Expected: PASS, 396+ tests. Any remaining compile error is a request path that was not passing a country — fix it rather than defaulting it.

- [ ] **Step 6: Commit**

```bash
git add packages/pipeline/src
git commit -m "fix(crawl): gl comes from the city config, not the literal \"ae\"

Every request in every city asked Google as if searching from the UAE.
cli/demand.ts already derived it correctly, so the repository held the bug
and its fix at once for the whole v0.1 period. Required rather than
defaulted, because a default is how this survived."
```

---

### Task 2: Resolve a city name to a boundary

**Files:**

- Create: `packages/core/src/osm.ts`
- Test: `packages/core/src/osm.test.ts`
- Modify: `packages/core/src/index.ts` (exports)

**Interfaces:**

- Consumes: `BoundingBox` from `./types`, `isSupportedCountry` from `libphonenumber-js/max`.
- Produces:

  ```ts
  export interface ResolvedPlace {
    name: string;
    countryCode: string; // ISO-3166 alpha-2, upper case
    phoneRegion: CountryCode; // libphonenumber region
    osmType: "relation" | "way" | "node";
    osmId: number;
    boundingBoxes: BoundingBox[];
    /** Every name OSM knows, for `cityNames`. Lowercased, deduped. */
    names: string[];
  }
  export function parseNominatimPlace(
    json: unknown,
    query: string,
  ): ResolvedPlace;
  export const MAX_BOUNDING_BOXES: number;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { parseNominatimPlace } from "./osm";

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      new URL(`../../../fixtures/osm/${name}.json`, import.meta.url),
      "utf8",
    ),
  );

describe("parseNominatimPlace", () => {
  test("resolves a city to its administrative relation", () => {
    const place = parseNominatimPlace(fixture("nominatim-lisbon"), "Lisbon");
    expect(place.osmType).toBe("relation");
    expect(place.countryCode).toBe("PT");
    expect(place.phoneRegion).toBe("PT");
  });

  test("derives the phone region from the country, never from the name", () => {
    // A wrong phoneRegion fails at normalise, far from its cause, so this is
    // checked against libphonenumber itself rather than assumed.
    const place = parseNominatimPlace(fixture("nominatim-dubai"), "Dubai");
    expect(place.phoneRegion).toBe("AE");
  });

  test("yields one bounding box per polygon, which is the exclave shape", () => {
    // Dubai's hand-written config has two boxes: the city and Hatta. A
    // multi-polygon boundary is the general case of that.
    const place = parseNominatimPlace(fixture("nominatim-dubai"), "Dubai");
    expect(place.boundingBoxes.length).toBeGreaterThanOrEqual(1);
    for (const box of place.boundingBoxes) {
      expect(box.minLat).toBeLessThan(box.maxLat);
      expect(box.minLng).toBeLessThan(box.maxLng);
    }
  });

  test("rejects a point result, because a node carries no boundary", () => {
    expect(() =>
      parseNominatimPlace(
        [{ osm_type: "node", osm_id: 1, lat: "0", lon: "0" }],
        "Nowhere",
      ),
    ).toThrow(/boundary/i);
  });

  test("names the query when nothing resolves, rather than returning empty", () => {
    expect(() => parseNominatimPlace([], "Atlantis")).toThrow(/Atlantis/);
  });

  test("rejects a country whose dialling region libphonenumber does not know", () => {
    const bogus = [
      {
        osm_type: "relation",
        osm_id: 1,
        class: "boundary",
        type: "administrative",
        name: "Nowhere",
        lat: "0",
        lon: "0",
        boundingbox: ["-1", "1", "-1", "1"],
        address: { country_code: "zz" },
      },
    ];
    expect(() => parseNominatimPlace(bogus, "Nowhere")).toThrow(/ZZ/);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm vitest run packages/core/src/osm.test.ts`
Expected: FAIL — `Cannot find module './osm'`.

- [ ] **Step 3: Implement**

```ts
/**
 * Above this many polygons, the per-polygon boxes stop being readable and
 * collapse to the single overall bbox Nominatim already returned.
 *
 * A readability threshold, not a measured one — do not quote it as a finding.
 * The direction is deliberate: `isInCity` treats boxes as a sanity check and
 * matches if ANY box contains the point, so falling back to one large box is
 * strictly more permissive. Over-filtering would silently drop real
 * businesses; being slightly loose costs nothing the city-name filter does not
 * already catch.
 */
export const MAX_BOUNDING_BOXES = 12;

function bboxOfRing(ring: unknown): BoundingBox | null {
  if (!Array.isArray(ring) || ring.length === 0) return null;
  let minLat = Infinity,
    maxLat = -Infinity,
    minLng = Infinity,
    maxLng = -Infinity;
  for (const point of ring) {
    if (!Array.isArray(point) || point.length < 2) continue;
    const [lng, lat] = point as [number, number]; // GeoJSON is lng,lat
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  }
  if (!Number.isFinite(minLat) || minLat === maxLat || minLng === maxLng)
    return null;
  return { minLat, maxLat, minLng, maxLng };
}
```

`parseNominatimPlace` then:

1. Requires a non-empty array; throws naming `query` if empty.
2. Picks the first element with `osm_type === "relation"`; if none, throws mentioning "boundary" and what was found instead.
3. `countryCode = String(address.country_code).toUpperCase()`; throws naming the code if `!isSupportedCountry(countryCode)`. `phoneRegion` is the same value, typed.
4. Boxes: if `geojson.type === "MultiPolygon"`, one box per polygon's outer ring; if `"Polygon"`, one box from its outer ring; otherwise the `boundingbox` quad, which Nominatim returns as **strings in `[minLat, maxLat, minLon, maxLon]` order**. If the polygon count exceeds `MAX_BOUNDING_BOXES`, use the `boundingbox` quad instead.
5. `names`: `name`, `address.city`, and every `namedetails` value present, lowercased, deduped, empties dropped.

- [ ] **Step 4: Run and watch it pass**

Run: `pnpm vitest run packages/core/src/osm.test.ts` → PASS.
(Fixtures arrive in Task 6; until then run against the two inline-literal tests and mark the fixture-backed ones `test.todo`. Task 6 removes the todos.)

- [ ] **Step 5: Export and commit**

Add to `packages/core/src/index.ts`:

```ts
export { MAX_BOUNDING_BOXES, parseNominatimPlace } from "./osm";
export type { ResolvedPlace } from "./osm";
```

```bash
git add packages/core/src/osm.ts packages/core/src/osm.test.ts packages/core/src/index.ts
git commit -m "feat(core): resolve a city name to an OSM boundary"
```

---

### Task 3: Turn OSM place nodes into tile candidates

**Files:**

- Modify: `packages/core/src/osm.ts`
- Test: `packages/core/src/osm.test.ts`

**Interfaces:**

- Consumes: `TileCandidate`, `distanceKm` from `./tiles`; `Density` from `./types`.
- Produces:

  ```ts
  export interface OsmPlaceNode {
    id: number;
    lat: number;
    lng: number;
    name: string;
    place: string;
  }
  export function parseOverpassPlaces(json: unknown): OsmPlaceNode[];
  export interface OsmPoi {
    lat: number;
    lng: number;
  }
  export function parseOverpassPois(json: unknown): OsmPoi[];
  export function countNearby(
    centre: GeoPoint,
    pois: readonly OsmPoi[],
    radiusKm: number,
  ): number;
  export function tileIdFrom(name: string, taken: Set<string>): string;
  export const ZOOM_FOR_DENSITY: Record<Density, number>;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
describe("tileIdFrom", () => {
  test("kebab-cases a plain name", () => {
    expect(tileIdFrom("Business Bay", new Set())).toBe("business-bay");
  });

  test("suffixes a collision rather than overwriting it", () => {
    // Two OSM nodes can legitimately share a name. parseCityConfig rejects
    // duplicate tile ids, so a collision must be resolved here or the
    // generator emits a config its own loader refuses.
    const taken = new Set(["marina"]);
    expect(tileIdFrom("Marina", taken)).toBe("marina-2");
  });

  test("refuses a name with no ASCII in it, instead of inventing one", () => {
    // toSlug would return "business-<hash>" here. A tile id is a browse facet
    // and an indexed /area/ URL under ADR 0011, so an opaque hash is worse
    // than a loud failure the operator can fix with a name:en tag.
    expect(() => tileIdFrom("ديرة", new Set())).toThrow(/ASCII|latin/i);
  });
});

describe("countNearby", () => {
  const pois = [
    { lat: 25.1972, lng: 55.2744 },
    { lat: 25.1975, lng: 55.2748 },
    { lat: 25.3, lng: 55.4 },
  ];

  test("counts only what is inside the radius", () => {
    expect(countNearby({ lat: 25.1972, lng: 55.2744 }, pois, 0.5)).toBe(2);
  });

  test("is inclusive at the boundary, matching classifyDensity", () => {
    const centre = { lat: 0, lng: 0 };
    const oneKmNorth = { lat: 1 / 111.195, lng: 0 };
    expect(countNearby(centre, [oneKmNorth], 1)).toBe(1);
  });
});

describe("parseOverpassPlaces", () => {
  test("keeps named nodes and drops unnamed ones", () => {
    const json = {
      elements: [
        {
          type: "node",
          id: 1,
          lat: 1,
          lon: 2,
          tags: { place: "suburb", name: "Alfama" },
        },
        { type: "node", id: 2, lat: 3, lon: 4, tags: { place: "suburb" } },
      ],
    };
    const places = parseOverpassPlaces(json);
    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({ name: "Alfama", lng: 2 });
  });

  test("prefers name:en, because a tile id has to be a URL", () => {
    const json = {
      elements: [
        {
          type: "node",
          id: 1,
          lat: 1,
          lon: 2,
          tags: { place: "quarter", name: "ديرة", "name:en": "Deira" },
        },
      ],
    };
    expect(parseOverpassPlaces(json)[0]!.name).toBe("Deira");
  });

  test("is deterministic, so a regenerated config diffs cleanly", () => {
    const json = {
      elements: [
        {
          type: "node",
          id: 9,
          lat: 1,
          lon: 2,
          tags: { place: "suburb", name: "B" },
        },
        {
          type: "node",
          id: 3,
          lat: 1,
          lon: 2,
          tags: { place: "suburb", name: "A" },
        },
      ],
    };
    expect(parseOverpassPlaces(json).map((p) => p.id)).toEqual([3, 9]);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm vitest run packages/core/src/osm.test.ts` → FAIL, functions not exported.

- [ ] **Step 3: Implement**

```ts
/**
 * Zoom per density, from `data/cities/_template.json`. Higher is a smaller area.
 *
 * The hand-tuned Dubai config does NOT follow this: it uses 14 for ten medium
 * tiles and 15 for eight others, 13 for five sparse and 14 for six. That
 * disagreement is real and is reported by `pnpm cities calibrate` rather than
 * being fitted away, on the same principle the spacing floors follow — the
 * generator is allowed to differ from a human, but not to hide that it did.
 */
export const ZOOM_FOR_DENSITY: Record<Density, number> = {
  dense: 15,
  medium: 14,
  sparse: 13,
};

const LATIN = /[a-z0-9]/;

export function tileIdFrom(name: string, taken: Set<string>): string {
  const base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!LATIN.test(base)) {
    throw new Error(
      `Tile name ${JSON.stringify(name)} has no Latin characters, so it cannot ` +
        `become a URL slug. Add a name:en tag to the OSM node, or drop the tile — ` +
        `an opaque hash would become an indexed /area/ URL nobody can read.`,
    );
  }

  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  // Deterministic: the same input order always produces the same suffix, which
  // is what makes a regenerated config diff cleanly instead of churning.
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}

export function countNearby(
  centre: GeoPoint,
  pois: readonly OsmPoi[],
  radiusKm: number,
): number {
  let n = 0;
  // Inclusive at the boundary, matching classifyDensity: of the two ways to be
  // wrong on a threshold, under-crawling a real centre is the one you cannot
  // detect afterwards.
  for (const poi of pois) if (distanceKm(centre, poi) <= radiusKm) n++;
  return n;
}
```

`parseOverpassPlaces` keeps `type === "node"` elements with a `tags.place` and a usable name (`tags["name:en"] ?? tags.name`), maps `lon` → `lng`, and sorts by `id` ascending for determinism.
`parseOverpassPois` keeps every element with numeric `lat`/`lon` and returns `{ lat, lng }` — `out skel qt` returns no tags, so nothing else is available or needed.

- [ ] **Step 4: Run and watch it pass**

Run: `pnpm vitest run packages/core/src/osm.test.ts` → PASS.

- [ ] **Step 5: Export and commit**

```ts
export {
  ZOOM_FOR_DENSITY,
  countNearby,
  parseOverpassPlaces,
  parseOverpassPois,
  tileIdFrom,
} from "./osm";
export type { OsmPlaceNode, OsmPoi } from "./osm";
```

```bash
git add packages/core/src
git commit -m "feat(core): OSM place nodes and POI counts become tile candidates"
```

---

### Task 4: Derive categories from what a city actually contains

Shipping Dubai's 40 categories to every city would waste credits on empty queries. Measured on 2026-08-22 in a central-Dubai bbox: **108 `amenity=bureau_de_change`** and **125 `shop=laundry`** nodes against **156 `amenity=pharmacy`** — those two are genuinely high-street businesses in the Gulf and barely exist as search categories in Northern Europe, exactly as the spec claimed. Now it is measured.

**Files:**

- Create: `packages/core/src/categories.ts`, `packages/core/src/categories.test.ts`
- Create: `data/category-map.json`
- Modify: `packages/core/src/index.ts`

**Interfaces:**

- Consumes: `CityCategory`, `Tier` from `./types`.
- Produces:

  ```ts
  export type CategoryMap = Record<string, string>; // "amenity=pharmacy" -> "pharmacies"
  export function parseCategoryMap(json: string, source?: string): CategoryMap;
  export const TIER_SHARES: Record<Tier, number>;
  export const MIN_CATEGORY_COUNT: number;
  export function deriveCategories(
    counts: Record<string, number>,
    map: CategoryMap,
  ): CityCategory[];
  ```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, test } from "vitest";
import {
  MIN_CATEGORY_COUNT,
  deriveCategories,
  parseCategoryMap,
} from "./categories";

const MAP = {
  "amenity=restaurant": "restaurants",
  "amenity=pharmacy": "pharmacies",
  "amenity=bureau_de_change": "exchange houses",
  "shop=laundry": "laundry",
  "amenity=dentist": "dentists",
};

describe("deriveCategories", () => {
  test("drops a category the city does not actually have", () => {
    // The whole point: exchange houses matter in the UAE and not in Manchester.
    const cats = deriveCategories(
      { "amenity=restaurant": 900, "amenity=bureau_de_change": 1 },
      MAP,
    );
    expect(cats.map((c) => c.q)).not.toContain("exchange houses");
    expect(cats.map((c) => c.q)).toContain("restaurants");
  });

  test("keeps a regional category the city really has", () => {
    // Measured in central Dubai: 108 bureau_de_change nodes.
    const cats = deriveCategories(
      {
        "amenity=restaurant": 900,
        "amenity=bureau_de_change": 108,
        "shop=laundry": 125,
      },
      MAP,
    );
    expect(cats.map((c) => c.q)).toContain("exchange houses");
    expect(cats.map((c) => c.q)).toContain("laundry");
  });

  test("splits tiers 25/50/25, which is Dubai's own shape", () => {
    // data/cities/dubai.json is 10 broad / 20 standard / 10 niche across 40
    // categories. The spec said "decile"; the file says quartile, and the file
    // is the measurement.
    const counts = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [`k${i}`, (40 - i) * 10]),
    );
    const map = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [`k${i}`, `q${i}`]),
    );
    const cats = deriveCategories(counts, map);
    expect(cats).toHaveLength(40);
    expect(cats.filter((c) => c.tier === "broad")).toHaveLength(10);
    expect(cats.filter((c) => c.tier === "standard")).toHaveLength(20);
    expect(cats.filter((c) => c.tier === "niche")).toHaveLength(10);
  });

  test("ranks the busiest category broad", () => {
    const cats = deriveCategories(
      {
        "amenity=restaurant": 900,
        "amenity=pharmacy": 156,
        "amenity=dentist": 30,
        "shop=laundry": 125,
      },
      MAP,
    );
    expect(cats[0]).toEqual({ q: "restaurants", tier: "broad" });
  });

  test("never emits a duplicate query, which parseCityConfig rejects", () => {
    const cats = deriveCategories(
      { "amenity=restaurant": 900, "shop=restaurant": 400 },
      { "amenity=restaurant": "restaurants", "shop=restaurant": "restaurants" },
    );
    expect(cats.filter((c) => c.q === "restaurants")).toHaveLength(1);
  });

  test("is deterministic when counts tie", () => {
    const a = deriveCategories(
      { "amenity=pharmacy": 50, "amenity=dentist": 50 },
      MAP,
    );
    const b = deriveCategories(
      { "amenity=dentist": 50, "amenity=pharmacy": 50 },
      MAP,
    );
    expect(a).toEqual(b);
  });
});

describe("parseCategoryMap", () => {
  test("rejects a key that is not tag=value, which would never match", () => {
    expect(() => parseCategoryMap('{"pharmacy":"pharmacies"}')).toThrow(
      /tag=value/,
    );
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm vitest run packages/core/src/categories.test.ts` → FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * A category must clear this many OSM nodes to earn a slot.
 *
 * A tier is a claim about how likely an area is to hold 100+ of that kind of
 * business, and PAGE_CAP turns that claim into credits. A category with three
 * nodes in the whole city buys empty result pages at one credit each.
 *
 * Ten is a floor chosen to exclude noise, not a measured optimum, and it is
 * named here rather than inlined so the calibration pass can argue with it.
 */
export const MIN_CATEGORY_COUNT = 10;

/** Dubai's own split across 40 categories: 10 broad / 20 standard / 10 niche. */
export const TIER_SHARES: Record<Tier, number> = {
  broad: 0.25,
  standard: 0.5,
  niche: 0.25,
};
```

`deriveCategories`:

1. Map each `tag=value` key present in `map` to its query string, summing counts where two tags share one query (`Map<string, number>`).
2. Drop anything under `MIN_CATEGORY_COUNT`.
3. Sort by count descending, then by query ascending — the tiebreak is what makes it deterministic.
4. Assign tiers by position: `broad` for the first `round(n * 0.25)`, `niche` for the last `round(n * 0.25)`, `standard` for the rest.
5. Return `{ q, tier }[]` in that order.

`parseCategoryMap` throws on a non-object, on a key not matching `/^[a-z_]+=[a-z0-9_:]+$/`, and on a non-string or empty value — each error naming the offending key, in the tone `parseCityConfig` already sets.

`data/category-map.json` ships 60–80 entries covering the real long tail — restaurants, cafes, bakeries, pharmacies, supermarkets, banks, dentists, doctors, hairdressers, car repair, hotels, schools, gyms, laundries, tailors, bureaux de change, jewellers, opticians, veterinarians, hardware, florists, bookshops, travel agencies, law offices, estate agents. Owned by the `taxonomy-curator` agent, and shaped like `data/taxonomy-map.json` so it inherits the community-PR pattern the repo already has.

- [ ] **Step 4: Run and watch it pass**

Run: `pnpm vitest run packages/core/src/categories.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/categories.ts packages/core/src/categories.test.ts \
        packages/core/src/index.ts data/category-map.json
git commit -m "feat(core): derive a city's categories from its own OSM tag counts"
```

---

### Task 5: The network half — clients, etiquette, cache

**Files:**

- Create: `packages/pipeline/src/osm.ts`, `packages/pipeline/src/osm.test.ts`
- Modify: `.gitignore`

**Interfaces:**

- Consumes: `ResolvedPlace`, `BoundingBox` from `@directory/core`.
- Produces:

  ```ts
  export type OsmFetch = typeof fetch;
  export interface OsmClientOptions {
    fetchImpl?: OsmFetch;
    sleep?: (ms: number) => Promise<void>;
    cacheDir?: URL | null;
    userAgent?: string;
  }
  export interface OsmClient {
    resolvePlace(name: string): Promise<unknown>;
    places(place: ResolvedPlace): Promise<unknown>;
    pois(boxes: BoundingBox[]): Promise<unknown>;
    categoryCounts(boxes: BoundingBox[], tags: string[]): Promise<unknown>;
  }
  export function createOsmClient(options?: OsmClientOptions): OsmClient;
  export function placesQuery(place: ResolvedPlace): string;
  export function poisQuery(boxes: BoundingBox[]): string;
  export function categoryCountsQuery(
    boxes: BoundingBox[],
    tags: string[],
  ): string;
  export function cacheKey(kind: string, body: string): string;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, test } from "vitest";
import {
  cacheKey,
  categoryCountsQuery,
  createOsmClient,
  placesQuery,
  poisQuery,
} from "./osm";

const BOX = { minLat: 25.19, maxLat: 25.28, minLng: 55.26, maxLng: 55.34 };
const PLACE = { osmType: "relation" as const, osmId: 5400890 };

describe("placesQuery", () => {
  test("turns a relation id into an Overpass area id", () => {
    // Overpass area ids are the OSM relation id plus 3600000000. Getting this
    // wrong returns an empty element list, which looks exactly like a city
    // with no neighbourhoods mapped.
    expect(placesQuery(PLACE as never)).toContain("3605400890");
  });

  test("asks only for the place types that are neighbourhood-scale", () => {
    const q = placesQuery(PLACE as never);
    expect(q).toMatch(/suburb/);
    expect(q).toMatch(/neighbourhood/);
    expect(q).not.toMatch(/place~"\^\(city\)/);
  });
});

describe("poisQuery", () => {
  test("asks for skeletons, because only coordinates are counted", () => {
    // out skel drops tags, which is most of the payload. Density is a distance
    // count; nothing downstream reads a POI's tags.
    expect(poisQuery([BOX])).toContain("out skel qt");
  });

  test("covers every bounding box the city has", () => {
    const q = poisQuery([BOX, { ...BOX, minLat: 24.7, maxLat: 24.9 }]);
    expect(q.match(/node\(/g)).toHaveLength(6); // 3 tag families x 2 boxes
  });
});

describe("categoryCountsQuery", () => {
  test("emits one out count per tag, in the order given", () => {
    // Counts come back with id 0 and no tag name, so position is the ONLY key
    // linking a result to its tag. Query order and parse order must be the
    // same list or every category is silently mislabelled.
    const q = categoryCountsQuery([BOX], ["amenity=pharmacy", "shop=laundry"]);
    expect(q.match(/out count;/g)).toHaveLength(2);
    expect(q.indexOf("pharmacy")).toBeLessThan(q.indexOf("laundry"));
  });
});

describe("createOsmClient", () => {
  test("identifies itself, because Nominatim blocks anonymous clients", async () => {
    let seen: Headers | undefined;
    const client = createOsmClient({
      cacheDir: null,
      sleep: async () => {},
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        seen = new Headers(init?.headers);
        return new Response("[]", { status: 200 });
      }) as never,
    });
    await client.resolvePlace("Lisbon");
    expect(seen?.get("user-agent")).toMatch(/directory-from-scratch/);
  });

  test("waits between requests rather than hammering a free service", async () => {
    const waits: number[] = [];
    const client = createOsmClient({
      cacheDir: null,
      sleep: async (ms) => {
        waits.push(ms);
      },
      fetchImpl: (async () => new Response("[]", { status: 200 })) as never,
    });
    await client.resolvePlace("Lisbon");
    await client.resolvePlace("Porto");
    expect(waits.some((w) => w >= 1000)).toBe(true);
  });

  test("names the service and the status when a request fails", async () => {
    const client = createOsmClient({
      cacheDir: null,
      sleep: async () => {},
      fetchImpl: (async () => new Response("busy", { status: 429 })) as never,
    });
    await expect(client.resolvePlace("Lisbon")).rejects.toThrow(
      /Nominatim.*429/s,
    );
  });
});

describe("cacheKey", () => {
  test("is stable for the same request", () => {
    expect(cacheKey("pois", "abc")).toBe(cacheKey("pois", "abc"));
  });

  test("separates different requests of the same kind", () => {
    expect(cacheKey("pois", "abc")).not.toBe(cacheKey("pois", "abd"));
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm vitest run packages/pipeline/src/osm.test.ts` → FAIL, module not found.

- [ ] **Step 3: Implement**

Constants and etiquette:

```ts
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OVERPASS = "https://overpass-api.de/api/interpreter";

/**
 * Nominatim's usage policy is one request per second and a User-Agent that
 * identifies the application. Both are conditions of use, not suggestions, and
 * a generator that will be run across a hundred cities is exactly the client
 * the policy exists to restrain.
 */
const NOMINATIM_MIN_INTERVAL_MS = 1_100;
/** Overpass publishes no fixed rate, but it is free and heavily loaded. */
const OVERPASS_MIN_INTERVAL_MS = 2_000;
const USER_AGENT =
  "directory-from-scratch/0.1.0 (https://github.com/pooyagolchian/directory-from-scratch)";

/** POI families that stand in for "a business". Matches the spec's stage 4. */
const POI_TAGS = ["shop", "amenity", "office"] as const;

/**
 * Overpass area ids are the OSM object id plus this offset for relations.
 * A wrong offset returns zero elements, which is indistinguishable from a city
 * whose neighbourhoods nobody has mapped — so it is asserted in a test.
 */
const OVERPASS_AREA_OFFSET_RELATION = 3_600_000_000;
```

Requests are **serialised through a single promise chain** shared by both hosts, each with its own last-call timestamp, so nothing runs in parallel by accident.

Cache: `cacheKey(kind, body)` is `${kind}-${fnv1a(body)}` reusing the FNV-1a shape already in `slug.ts` — stable across Node versions, which matters because a cache that misses on upgrade re-hits a free service. Files land in `data/osm-cache/<key>.json`; `cacheDir: null` disables it for tests.

Errors name the service, the status, and the query kind — `Overpass 429 for pois; the public instance is rate-limited, retry in a few minutes` — because "fetch failed" is what sends someone re-running a generator that is behaving correctly.

Add to `.gitignore`:

```gitignore
# Cached OpenStreetMap responses. Free to re-fetch, never worth committing,
# and large: one city's POI skeletons run to a few MB.
data/osm-cache/
```

- [ ] **Step 4: Run and watch it pass**

Run: `pnpm vitest run packages/pipeline/src/osm.test.ts` → PASS. No test opens a socket; every one injects `fetchImpl`.

- [ ] **Step 5: Commit**

```bash
git add packages/pipeline/src/osm.ts packages/pipeline/src/osm.test.ts .gitignore
git commit -m "feat(pipeline): OSM clients with rate limiting and a disk cache"
```

---

### Task 6: Record the fixtures

The first task that touches the network for real. No credits — OSM is free — but real requests, and the spec names this as the natural checkpoint for a human to look before going further.

**Files:**

- Create: `fixtures/osm/nominatim-lisbon.json`, `nominatim-dubai.json`, `overpass-places-lisbon.json`, `overpass-places-dubai.json`, `overpass-pois-dubai.json`, `overpass-counts-dubai.json`
- Create: `scripts/record-osm-fixtures.ts`
- Modify: `packages/core/src/osm.test.ts` (drop the `test.todo`s from Task 2)

**Interfaces:**

- Consumes: `createOsmClient` from Task 5.
- Produces: the fixture files every later test reads.

- [ ] **Step 1: Write the recorder**

`scripts/record-osm-fixtures.ts` resolves Lisbon and Dubai, then runs the three Overpass queries for each, writing each raw response to `fixtures/osm/`. It prints the byte size of every file it writes, because a POI skeleton fixture that lands at 8 MB is a fixture nobody should commit.

- [ ] **Step 2: Run it**

Run: `pnpm tsx scripts/record-osm-fixtures.ts`
Expected: six files written, sizes printed. Dubai's POI fixture is the large one.

- [ ] **Step 3: Trim the POI fixture if it exceeds 2 MB**

If `overpass-pois-dubai.json` is over 2 MB, re-record it over the four dense central tiles' bbox only rather than the whole city, and rename it `overpass-pois-dubai-central.json`. A fixture exists to pin behaviour, not to mirror a city — and ADR 0002's instinct applies: a large blob of OSM data in git is a cost with no test value. **Say in the commit which one was recorded**, so the calibration numbers in Task 9 are never quietly computed over a different area than the tests.

- [ ] **Step 4: Enable the fixture-backed tests**

Remove the `test.todo` markers added in Task 2 Step 4 and run the core suite.

Run: `rtk vitest`
Expected: PASS. If `parseNominatimPlace` throws on the real Lisbon response, the real response is right and the parser is wrong — fix the parser, never the fixture.

- [ ] **Step 5: Commit**

```bash
git add fixtures/osm scripts/record-osm-fixtures.ts packages/core/src/osm.test.ts
git commit -m "test(osm): record Nominatim and Overpass fixtures for Lisbon and Dubai

Real requests to record, zero credits. Every test reads these; nothing in the
suite opens a socket."
```

---

### Task 7: Generate a whole city config

**Files:**

- Create: `packages/pipeline/src/cities.ts`, `packages/pipeline/src/cities.test.ts`

**Interfaces:**

- Consumes: everything from Tasks 2–5, plus `fitToBudget`, `buildCrawlPlan` from `./plan` and `classifyDensity`, `spaceOut`, `parseCityConfig` from `@directory/core`.
- Produces:
  ```ts
  export const GENERATOR_VERSION = "0.1.0";
  export const MIN_CANDIDATE_TILES = 5;
  export const DENSITY_RADIUS_KM = 0.75;
  export interface GenerateOptions {
    name: string;
    budget: number;
    client: OsmClient;
    categoryMap: CategoryMap;
    today: string;
    radiusKm?: number;
    thresholds?: DensityThresholds;
  }
  export interface GenerateResult {
    city: CityConfig;
    dropped: CityTile[];
    candidatesConsidered: number;
  }
  export function generateCityConfig(
    options: GenerateOptions,
  ): Promise<GenerateResult>;
  ```

`today` is injected rather than read from the clock so a generated config is reproducible in a test.

- [ ] **Step 1: Write the failing tests**

```ts
describe("generateCityConfig", () => {
  test("emits a config its own loader accepts", async () => {
    // The generator must never write something parseCityConfig would reject.
    const result = await generateCityConfig(fixtureOptions("lisbon"));
    expect(() =>
      parseCityConfig(JSON.stringify(result.city), "lisbon"),
    ).not.toThrow();
  });

  test("marks provenance generated, never verified", async () => {
    const { city } = await generateCityConfig(fixtureOptions("lisbon"));
    expect(city.verification).toEqual({
      status: "generated",
      source: "openstreetmap",
      generatedAt: "2026-08-22",
      generator: "0.1.0",
    });
    expect(verificationState(city)).toBe("generated");
  });

  test("fits the budget it was given", async () => {
    const { city } = await generateCityConfig({
      ...fixtureOptions("lisbon"),
      budget: 800,
    });
    expect(
      buildCrawlPlan(city.tiles, city.categories).estimate.maxRequests,
    ).toBeLessThanOrEqual(800);
  });

  test("a tighter budget keeps the dense tiles and sheds the sparse ones", async () => {
    const tight = await generateCityConfig({
      ...fixtureOptions("lisbon"),
      budget: 400,
    });
    expect(tight.dropped.filter((t) => t.density === "dense")).toHaveLength(0);
  });

  test("fails loudly when OSM has too few neighbourhoods to tile", async () => {
    // ADR 0014: a generated grid would be invented data wearing a generator's
    // credibility, and an even grid also wastes requests on water and desert.
    await expect(
      generateCityConfig(
        fixtureOptions("lisbon", { places: { elements: [] } }),
      ),
    ).rejects.toThrow(/too few|no neighbourhood/i);
  });

  test("is reproducible: same input, byte-identical output", async () => {
    const a = await generateCityConfig(fixtureOptions("lisbon"));
    const b = await generateCityConfig(fixtureOptions("lisbon"));
    expect(JSON.stringify(a.city)).toBe(JSON.stringify(b.city));
  });

  test("spends exactly four upstream requests", async () => {
    // One Nominatim resolve plus three Overpass queries. The spec's original
    // one-count-per-candidate design was 60+ requests to a free service.
    const calls: string[] = [];
    await generateCityConfig(
      fixtureOptions("lisbon", { onCall: (k) => calls.push(k) }),
    );
    expect(calls).toEqual(["resolvePlace", "places", "pois", "categoryCounts"]);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm vitest run packages/pipeline/src/cities.test.ts` → FAIL, module not found.

- [ ] **Step 3: Implement the six stages**

```ts
/**
 * Below this many surviving candidates, the generator refuses rather than
 * tiling thinly.
 *
 * OSM place=* coverage is excellent in Western Europe and thin in parts of the
 * Gulf and sub-Saharan Africa (ADR 0014). Where it is thin the honest outcome
 * is an error naming the city, not a config that crawls four points and calls
 * it a city.
 */
export const MIN_CANDIDATE_TILES = 5;

/**
 * Radius for the POI count that decides density.
 *
 * 0.75 km is a starting value, not a measurement: Dubai's tightest dense pair
 * sits 0.78 km apart, so a wider radius would count a neighbour's businesses
 * as its own. `pnpm cities calibrate` fits this against the 44 hand-placed
 * tiles and Task 9 replaces this constant with what it finds.
 */
export const DENSITY_RADIUS_KM = 0.75;
```

Order of operations:

1. `resolvePlace(name)` → `parseNominatimPlace` → `ResolvedPlace`.
2. `places(place)` → `parseOverpassPlaces` → nodes. Throw if fewer than `MIN_CANDIDATE_TILES`.
3. `pois(place.boundingBoxes)` → `parseOverpassPois`.
4. Per node: `countNearby(node, pois, radiusKm)` → `classifyDensity(count, thresholds)` → `TileCandidate`.
5. `spaceOut(candidates)` → survivors, busiest first. Throw if fewer than `MIN_CANDIDATE_TILES` survive — say how many were considered and how many survived, so the operator can tell "OSM is thin here" from "my spacing floors are too wide".
6. `tileIdFrom` per survivor with a shared `taken` set; `zoom` from `ZOOM_FOR_DENSITY`.
7. `categoryCounts(boxes, Object.keys(categoryMap))` → counts by position → `deriveCategories`.
8. `fitToBudget(tiles, categories, budget)`.
9. Assemble, `parseCityConfig(JSON.stringify(city), id)` as a self-check, return.

A tile name that throws in `tileIdFrom` is **skipped with a printed warning**, not fatal — one unnameable node should not lose a whole city — but if skipping drops the count below `MIN_CANDIDATE_TILES`, the throw in step 5 catches it.

- [ ] **Step 4: Run and watch it pass**

Run: `pnpm vitest run packages/pipeline/src/cities.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/pipeline/src/cities.ts packages/pipeline/src/cities.test.ts
git commit -m "feat(pipeline): generate a budget-fitted city config from OSM"
```

---

### Task 8: The `pnpm cities` CLI

**Files:**

- Create: `packages/pipeline/src/cli/cities.ts`
- Modify: `package.json` (add `"cities": "tsx packages/pipeline/src/cli/cities.ts"`)
- Modify: `README.md`, `CONTRIBUTING.md`, `CLAUDE.md` (commands block)

**Interfaces:**

- Consumes: `generateCityConfig` from Task 7, `availableCities`/`loadCity` from `./plan`.
- Produces: the three subcommands.

- [ ] **Step 1: Write the CLI**

```
pnpm cities generate --name "Lisbon" --budget 2000   # writes data/cities/lisbon.json
pnpm cities generate --name "Lisbon" --dry-run       # prints the config, writes nothing
pnpm cities validate                                 # every config in the repo
pnpm cities calibrate --against dubai                # Task 9
```

`generate` prints, before writing:

```text
Lisbon (PT) — generated from OpenStreetMap
  candidates    68 place nodes → 41 after spacing
  tiles         27  (dense 9, medium 12, sparse 6)   14 dropped to fit budget
  categories    34  (broad 9, standard 17, niche 8)
  requests      up front 612 · worst case 1,988 · budget 2,000

  UNVERIFIED. Nobody has crawled this. Run:
    pnpm crawl --city lisbon --dry-run
  then open a PR flipping verification.status with what you measured.
```

Refuses to overwrite an existing config unless `--force`, naming the file — a hand-tuned Dubai config must not be silently replaced by a generated one. `--dry-run` is honoured before any write.

- [ ] **Step 2: Add the script and document it**

`package.json`: `"cities": "tsx packages/pipeline/src/cli/cities.ts"`.
`CLAUDE.md` commands block gains the three lines. `CONTRIBUTING.md` gains the verification loop as a named workflow: generate, crawl, PR the measured numbers — which is the contribution path ADR 0014 records.

- [ ] **Step 3: Verify it end to end against a real city**

Run: `pnpm cities generate --name "Lisbon" --budget 2000 --dry-run`
Expected: a real config printed, four upstream requests, no file written.

Then: `pnpm cities validate`
Expected: every committed config passes, Dubai included.

- [ ] **Step 4: Run the whole suite**

Run: `rtk vitest && rtk tsc && rtk lint && pnpm format:check`

- [ ] **Step 5: Commit**

```bash
git add packages/pipeline/src/cli/cities.ts package.json README.md CONTRIBUTING.md CLAUDE.md
git commit -m "feat(cli): pnpm cities generate/validate"
```

---

### Task 9: The calibration gate — publish three numbers before going wider

The spec is explicit that this runs **before** the seed registry, and that its numbers get published whether or not they flatter the generator. Until it runs, `PROVISIONAL_DENSITY_THRESHOLDS` (dense 150, medium 40) and `DENSITY_RADIUS_KM` (0.75) are guesses sitting underneath a credit estimate.

**Files:**

- Create: `packages/pipeline/src/calibrate.ts`, `packages/pipeline/src/calibrate.test.ts`
- Modify: `packages/core/src/tiles.ts` (replace `PROVISIONAL_DENSITY_THRESHOLDS` with measured values, or keep it and say why)
- Modify: `docs/adr/0014-generate-the-city-registry.md` (an amendment section carrying the results)
- Modify: `README.md`

**Interfaces:**

- Consumes: `loadCity("dubai")`, `countNearby`, `classifyDensity`, `generateCityConfig`.
- Produces:

  ```ts
  export interface Calibration {
    tileRecall: number; // within 1 km of a hand-placed tile
    densityConfusion: Record<Density, Record<Density, number>>;
    costDelta: { generated: number; handTuned: number };
    bestThresholds: DensityThresholds;
    bestRadiusKm: number;
  }
  export function calibrate(
    city: CityConfig,
    pois: OsmPoi[],
    generated: CityTile[],
  ): Calibration;
  ```

- [ ] **Step 1: Write the failing test**

```ts
describe("calibrate", () => {
  test("scores perfect recall when the generated tiles are the hand-placed ones", () => {
    const dubai = loadCity("dubai");
    const result = calibrate(dubai, [], dubai.tiles);
    expect(result.tileRecall).toBe(1);
  });

  test("scores zero recall when every generated tile is elsewhere", () => {
    const dubai = loadCity("dubai");
    const elsewhere = dubai.tiles.map((t) => ({ ...t, lat: t.lat + 5 }));
    expect(calibrate(dubai, [], elsewhere).tileRecall).toBe(0);
  });

  test("the confusion matrix totals the known 15/18/11 split", () => {
    const dubai = loadCity("dubai");
    const m = calibrate(dubai, [], dubai.tiles).densityConfusion;
    const rowTotal = (d: Density) =>
      Object.values(m[d]).reduce((a, b) => a + b, 0);
    expect(rowTotal("dense")).toBe(15);
    expect(rowTotal("medium")).toBe(18);
    expect(rowTotal("sparse")).toBe(11);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm vitest run packages/pipeline/src/calibrate.test.ts` → FAIL.

- [ ] **Step 3: Implement, then sweep for the best thresholds**

`calibrate` computes recall (fraction of the 44 hand-placed tiles with a generated tile within 1 km), the 3×3 confusion matrix of generated density against hand-labelled density, and the cost delta against the hand-tuned worst case of 3,170 requests.

Then sweep `radiusKm ∈ {0.5, 0.75, 1.0, 1.5}` × a grid of thresholds, scoring by confusion-matrix agreement against the known 15 / 18 / 11 split, and report the best.

- [ ] **Step 4: Run it and record what it actually says**

Run: `pnpm cities calibrate --against dubai`

Write the three numbers into an **Amendment** section of ADR 0014 and into the README, **whatever they are.** If the generator costs materially more credits for the same coverage, that is the number that goes in — it is the honest form of the claim and, per the spec, it is the article.

- [ ] **Step 5: Replace the provisional constants, or say why not**

If the sweep finds thresholds that beat `{ dense: 150, medium: 40 }`, replace them and rename the constant `MEASURED_DENSITY_THRESHOLDS`, with the fit reported in the comment. If it does not, **keep the name `PROVISIONAL_`** and record in the ADR amendment that the sweep failed to improve on the guess. Renaming a constant the measurement did not vindicate would be the one thing this repo's ADR README calls out as making the whole directory worthless.

- [ ] **Step 6: Commit**

```bash
git add packages/pipeline/src/calibrate.ts packages/pipeline/src/calibrate.test.ts \
        packages/core/src/tiles.ts docs/adr/0014-generate-the-city-registry.md README.md
git commit -m "feat(pipeline): calibrate the generator against Dubai's 44 hand-placed tiles"
```

---

## Not in this plan

Deliberately out of scope, each with the reason:

- **The 40–60 city seed registry.** It runs after Task 9, because seeding before calibration commits a guess to fifty files. It is a separate plan.
- **Multi-city serving.** ADR 0009 bundles one `DIRECTORY_CITY` at build time; widening the site is Milestone 2's DynamoDB work, not the registry's.
- **Non-English category terms.** ADR 0014 records this as a known limitation with an unmeasured cost. Solving it needs a per-language term list, which is its own decision.
- **`/area/` URL stability across regeneration.** ADR 0011's trap, made easier to spring by a generator and not solved here. It needs a redirect mechanism that does not exist.

## Self-review

- **Spec coverage.** §1 tile generation → Tasks 2, 3, 7. §1 calibration gate → Task 9. §2 registry shape and `parseCityConfig` → already shipped, exercised in Task 7. §3 categories → Task 4. §4 CLI, data flow, politeness, caching, error handling, testing → Tasks 5, 6, 8. §5 sequencing steps 1–2 → done; step 3 → Tasks 2–7; step 4 → Task 9; step 5 → Task 4; step 6 → explicitly deferred above.
- **Additions the spec did not have.** Task 1 (`gl`) — a live defect found while planning, and a blocker for any non-UAE crawl.
- **Type consistency.** `OsmPlaceNode` / `OsmPoi` / `ResolvedPlace` / `CategoryMap` / `OsmClient` / `Calibration` are each defined once, in the task that creates them, and referenced by those exact names afterwards. `countNearby(centre, pois, radiusKm)`, `tileIdFrom(name, taken)`, `deriveCategories(counts, map)` keep their argument order everywhere.
- **Placeholder scan.** No TBDs. Every constant carries its value and the reason it has that value; the three that are guesses (`MAX_BOUNDING_BOXES`, `MIN_CATEGORY_COUNT`, `DENSITY_RADIUS_KM`) say so in the comment the plan specifies, so none of them can be quoted as measured.

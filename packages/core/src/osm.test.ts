import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  MAX_BOUNDING_BOXES,
  boundingBoxesFrom,
  countNearby,
  parseNominatimPlace,
  parseOverpassCounts,
  parseOverpassPlaces,
  parseOverpassPois,
  tileIdFrom,
} from "./osm";

/**
 * Recorded from the live services on 2026-08-22. Nothing here opens a socket:
 * Overpass and Nominatim cost no credits, but a test that depends on a remote
 * service is not deterministic, and determinism is the rule.
 */
function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(
      new URL(`../../../fixtures/osm/${name}.json`, import.meta.url),
      "utf8",
    ),
  );
}

const LISBON = fixture("nominatim-lisbon") as unknown[];
const DUBAI = fixture("nominatim-dubai") as unknown[];

describe("parseNominatimPlace", () => {
  test("resolves a name to its administrative relation", () => {
    const place = parseNominatimPlace(LISBON, "Lisbon");
    expect(place.osmType).toBe("relation");
    expect(place.osmId).toBe(5400890);
    expect(place.countryCode).toBe("PT");
    expect(place.phoneRegion).toBe("PT");
  });

  test("skips a point result, because a node carries no boundary", () => {
    // Dubai's second Nominatim hit is node/31248510 — a place=city point. It
    // ranks above the emirate relation on some queries and has no polygon at
    // all, so preferring relations is not a stylistic choice.
    const place = parseNominatimPlace(DUBAI, "Dubai");
    expect(place.osmType).toBe("relation");
    expect(place.osmId).toBe(4479752);
  });

  test("takes the city name from name:en, not from the local script", () => {
    // The failure this prevents is silent and total. OSM calls Dubai "دبي",
    // while the engine returns "Dubai" in its `city` field. A config carrying
    // only the Arabic name makes isInCity reject every single listing, and the
    // crawl then yields an empty directory that looks exactly like an honest
    // empty result — after the credits are gone.
    const place = parseNominatimPlace(DUBAI, "Dubai");
    expect(place.names).toContain("dubai");
  });

  test("keeps the local name too, since the engine may return either", () => {
    expect(parseNominatimPlace(DUBAI, "Dubai").names).toContain("دبي");
  });

  test("refuses a place with no Latin name at all", () => {
    const noLatin = [
      {
        osm_type: "relation",
        osm_id: 1,
        category: "boundary",
        type: "administrative",
        name: "دبي",
        namedetails: { name: "دبي" },
        boundingbox: ["24.6", "25.5", "54.7", "55.7"],
        address: { country_code: "ae" },
      },
    ];
    // Better to stop than to write a config whose city filter cannot match
    // anything the engine will ever say.
    expect(() => parseNominatimPlace(noLatin, "Dubai")).toThrow(/Latin/i);
  });

  test("splits a multi-polygon boundary into one box per polygon", () => {
    const place = parseNominatimPlace(DUBAI, "Dubai");
    expect(place.boundingBoxes).toHaveLength(2);
  });

  test("recovers the Hatta exclave a human placed by hand", () => {
    // data/cities/dubai.json carries a second box at 24.7–24.9 / 56.0–56.25,
    // added by hand for Dubai's detached mountain exclave. OSM's second
    // polygon is that same exclave, so the generator rediscovers a piece of
    // local knowledge from open data alone.
    const hatta = parseNominatimPlace(DUBAI, "Dubai").boundingBoxes.find(
      (b) => b.minLng > 56,
    );
    expect(hatta).toBeDefined();
    expect(hatta!.minLat).toBeGreaterThan(24.7);
    expect(hatta!.maxLat).toBeLessThan(24.9);
    expect(hatta!.maxLng).toBeLessThan(56.25);
  });

  test("every box it emits is non-degenerate and correctly ordered", () => {
    // parseCityConfig rejects an inverted box, and an inverted box makes
    // isInCity reject every record. The generator must never produce one.
    for (const place of [
      parseNominatimPlace(LISBON, "Lisbon"),
      parseNominatimPlace(DUBAI, "Dubai"),
    ]) {
      for (const b of place.boundingBoxes) {
        expect(b.minLat).toBeLessThan(b.maxLat);
        expect(b.minLng).toBeLessThan(b.maxLng);
      }
    }
  });

  test("names the query when nothing resolves", () => {
    expect(() => parseNominatimPlace([], "Atlantis")).toThrow(/Atlantis/);
  });

  test("rejects a country libphonenumber does not know", () => {
    const bogus = [
      {
        osm_type: "relation",
        osm_id: 1,
        category: "boundary",
        type: "administrative",
        name: "Nowhere",
        boundingbox: ["-1", "1", "-1", "1"],
        address: { country_code: "zz" },
      },
    ];
    expect(() => parseNominatimPlace(bogus, "Nowhere")).toThrow(/ZZ/);
  });
});

describe("boundingBoxesFrom", () => {
  const fallback = { minLat: 0, maxLat: 1, minLng: 0, maxLng: 1 };

  test("collapses an archipelago to the single overall box", () => {
    // Nominatim's Lisbon *district* result is a MultiPolygon of 39 pieces, 38
    // of them four-point slivers — rocks and islets. Emitting 39 boxes would
    // be unreadable, and since isInCity matches if ANY box contains the point,
    // one large box is strictly more permissive. Of the two ways to be wrong,
    // over-filtering silently drops real businesses and being loose costs
    // nothing the city-name filter does not already catch.
    const district = (LISBON as Array<Record<string, unknown>>)[1]!;
    const boxes = boundingBoxesFrom(district.geojson, fallback);
    expect(boxes).toEqual([fallback]);
  });

  test("keeps per-polygon boxes when there are few enough to read", () => {
    const dubai = (DUBAI as Array<Record<string, unknown>>)[0]!;
    const boxes = boundingBoxesFrom(dubai.geojson, fallback);
    expect(boxes.length).toBeLessThanOrEqual(MAX_BOUNDING_BOXES);
    expect(boxes).toHaveLength(2);
  });

  test("falls back when there is no polygon at all", () => {
    expect(boundingBoxesFrom(undefined, fallback)).toEqual([fallback]);
    expect(
      boundingBoxesFrom({ type: "Point", coordinates: [1, 2] }, fallback),
    ).toEqual([fallback]);
  });
});

describe("parseOverpassPlaces", () => {
  const dubai = parseOverpassPlaces(fixture("overpass-places-dubai"));
  const lisbon = parseOverpassPlaces(fixture("overpass-places-lisbon"));

  test("reads every named neighbourhood node", () => {
    expect(dubai.length).toBeGreaterThan(300);
    expect(lisbon.length).toBeGreaterThan(70);
  });

  test("prefers name:en, because a tile id becomes a URL", () => {
    // Roughly half of Dubai's place nodes are named only in Arabic in `name`
    // and carry the Latin form in `name:en`. toSlug drops Arabic outright, so
    // without this every one of them would collapse to the same slug stem.
    const hefair = dubai.find((p) => p.id === 11799922415);
    expect(hefair?.name).toBe("Hefair");
  });

  test("drops an unnamed node rather than inventing a name", () => {
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
    expect(parseOverpassPlaces(json)).toHaveLength(1);
  });

  test("maps lon to lng, which is the name every other module uses", () => {
    expect(lisbon[0]).toHaveProperty("lng");
    expect(Number.isFinite(lisbon[0]!.lng)).toBe(true);
  });

  test("is ordered by id, so a regenerated config diffs cleanly", () => {
    const ids = dubai.map((p) => p.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });
});

describe("parseOverpassPois", () => {
  const pois = parseOverpassPois(fixture("overpass-pois-dubai-central"));

  test("reads the skeleton nodes", () => {
    expect(pois.length).toBeGreaterThan(1000);
  });

  test("keeps only coordinates, because nothing counts a POI's tags", () => {
    expect(Object.keys(pois[0]!).sort()).toEqual(["lat", "lng"]);
  });
});

describe("countNearby", () => {
  const pois = parseOverpassPois(fixture("overpass-pois-dubai-central"));
  const DOWNTOWN = { lat: 25.1972, lng: 55.2744 };
  const EMPTY_SEA = { lat: 25.05, lng: 55.0 };

  test("counts real businesses around a real tile centre", () => {
    // Downtown Dubai is labelled `dense` by hand in data/cities/dubai.json.
    // Whatever threshold the calibration pass settles on has to put this
    // number above it.
    expect(countNearby(DOWNTOWN, pois, 0.75)).toBeGreaterThan(50);
  });

  test("separates a busy centre from empty ground", () => {
    expect(countNearby(EMPTY_SEA, pois, 0.75)).toBeLessThan(
      countNearby(DOWNTOWN, pois, 0.75),
    );
  });

  test("grows with the radius, never shrinks", () => {
    expect(countNearby(DOWNTOWN, pois, 1.5)).toBeGreaterThanOrEqual(
      countNearby(DOWNTOWN, pois, 0.75),
    );
  });

  test("is inclusive at the boundary, matching classifyDensity", () => {
    const oneKmNorth = { lat: 1 / 111.195, lng: 0 };
    expect(countNearby({ lat: 0, lng: 0 }, [oneKmNorth], 1)).toBe(1);
  });
});

describe("tileIdFrom", () => {
  test("kebab-cases a plain name", () => {
    expect(tileIdFrom("Business Bay", new Set())).toBe("business-bay");
  });

  test("folds accents rather than hyphenating them", () => {
    // Lisbon's real neighbourhoods: Pedrouços, Santos-o-Velho.
    expect(tileIdFrom("Pedrouços", new Set())).toBe("pedroucos");
  });

  test("suffixes a collision instead of overwriting it", () => {
    // parseCityConfig rejects duplicate tile ids, so an unresolved collision
    // is a config the generator's own loader would refuse.
    const taken = new Set<string>();
    expect(tileIdFrom("Marina", taken)).toBe("marina");
    expect(tileIdFrom("Marina", taken)).toBe("marina-2");
    expect(tileIdFrom("Marina", taken)).toBe("marina-3");
  });

  test("refuses a name with no Latin characters", () => {
    // toSlug would return "business-<hash>". A tile id is a browse facet and
    // an indexed /area/ URL under ADR 0011, so an opaque hash is worse than a
    // loud failure someone can fix with a name:en tag.
    expect(() => tileIdFrom("العشوش", new Set())).toThrow(/Latin/i);
  });
});

describe("parseOverpassCounts", () => {
  test("pairs counts with tags by position, which is the only key there is", () => {
    // Every count element comes back as {type:"count", id:0} with no hint of
    // which statement produced it. Query order IS the mapping, so a mismatch
    // in length has to be an error rather than a zip that silently truncates.
    const json = {
      elements: [
        { type: "count", id: 0, tags: { total: "156" } },
        { type: "count", id: 0, tags: { total: "108" } },
      ],
    };
    expect(
      parseOverpassCounts(json, [
        "amenity=pharmacy",
        "amenity=bureau_de_change",
      ]),
    ).toEqual({ "amenity=pharmacy": 156, "amenity=bureau_de_change": 108 });
  });

  test("throws when the response does not line up with the query", () => {
    const json = { elements: [{ type: "count", id: 0, tags: { total: "1" } }] };
    expect(() => parseOverpassCounts(json, ["a=b", "c=d"])).toThrow(
      /2.*1|1.*2/,
    );
  });

  test("reads the real Dubai and Lisbon recordings", () => {
    const tags = ["amenity=restaurant", "amenity=cafe"];
    const dubai = fixture("overpass-counts-dubai") as { elements: unknown[] };
    const head = { elements: dubai.elements.slice(0, 2) };
    const counts = parseOverpassCounts(head, tags);
    expect(counts["amenity=restaurant"]).toBeGreaterThan(2000);
  });
});

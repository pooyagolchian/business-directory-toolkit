import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import type { CityConfig, RawLocalResult, TaxonomyMap } from "@directory/core";
import { normalizeBusiness, normalizeAll } from "./normalize";

const DUBAI: CityConfig = {
  id: "dubai",
  name: "Dubai",
  countryCode: "AE",
  phoneRegion: "AE",
  cityNames: ["dubai", "hatta"],
  boundingBoxes: [
    { minLat: 24.75, maxLat: 25.36, minLng: 54.85, maxLng: 55.65 },
  ],
  tiles: [],
  categories: [],
};

const MAP: TaxonomyMap = {
  Restaurant: { l1: "Food & Drink", l2: "Restaurants" },
  "Seafood restaurant": {
    l1: "Food & Drink",
    l2: "Restaurants",
    l3: "Seafood",
  },
};

const real: RawLocalResult = JSON.parse(
  readFileSync(
    new URL(
      "../../../fixtures/searchapi/google_maps_downtown_page1.json",
      import.meta.url,
    ),
    "utf8",
  ),
).local_results[0];

describe("normalizeBusiness", () => {
  test("turns a real API record into a loadable business", () => {
    const b = normalizeBusiness(real, MAP, "downtown", DUBAI);
    expect(b?.placeId).toBe("ChIJpabd1tppXz4RjwONpXIjsp8");
    expect(b?.title).toBe(
      "The MAINE Land Brasserie Restaurant, Business Bay Dubai",
    );
  });

  test("normalises the phone to E.164", () => {
    // Fixture carries "04 577 6680".
    expect(normalizeBusiness(real, MAP, "downtown", DUBAI)?.phoneE164).toBe(
      "+97145776680",
    );
  });

  test("keeps the raw phone alongside, so a listing stays auditable", () => {
    expect(normalizeBusiness(real, MAP, "downtown", DUBAI)?.phoneRaw).toBe(
      "04 577 6680",
    );
  });

  test("resolves the taxonomy through the map", () => {
    const b = normalizeBusiness(real, MAP, "downtown", DUBAI);
    expect(b?.l2).toBe("Restaurants");
    expect(b?.l3).toBe("Seafood");
  });

  test("generates a stable slug", () => {
    const a = normalizeBusiness(real, MAP, "downtown", DUBAI);
    const b = normalizeBusiness(real, MAP, "downtown", DUBAI);
    expect(a?.slug).toBe(b?.slug);
    expect(a?.slug).toMatch(/^the-maine-land-brasserie/);
  });

  test("carries the tile through as the area, for the SEO browse pages", () => {
    expect(normalizeBusiness(real, MAP, "business-bay", DUBAI)?.area).toBe(
      "business-bay",
    );
  });

  test("rejects a business outside Dubai", () => {
    expect(
      normalizeBusiness({ ...real, city: "Sharjah" }, MAP, "downtown", DUBAI),
    ).toBeNull();
  });

  test("rejects a record with no place_id, which cannot be keyed", () => {
    const { place_id, ...noId } = real;
    void place_id;
    expect(normalizeBusiness(noId, MAP, "downtown", DUBAI)).toBeNull();
  });

  test("keeps a business whose categories do not map yet", () => {
    // An unmapped category is a taxonomy gap to fix, not a reason to lose data.
    const b = normalizeBusiness(
      { ...real, type: "Camel track", types: [] },
      MAP,
      "d",
      DUBAI,
    );
    expect(b).not.toBeNull();
    expect(b?.l2).toBeUndefined();
  });

  test("keeps a business that has no phone", () => {
    // 2 of 100 probed listings had none.
    const { phone, ...noPhone } = real;
    void phone;
    const b = normalizeBusiness(noPhone, MAP, "downtown", DUBAI);
    expect(b).not.toBeNull();
    expect(b?.phoneE164).toBeUndefined();
  });
});

describe("normalizeAll", () => {
  test("reports why records were dropped, rather than losing them silently", () => {
    const result = normalizeAll(
      [real, { ...real, city: "Sharjah" }, { title: "no id" }],
      MAP,
      "downtown",
      DUBAI,
    );
    expect(result.businesses).toHaveLength(1);
    expect(result.rejectedNotDubai).toBe(1);
    expect(result.rejectedNoPlaceId).toBe(1);
  });

  test("counts how many businesses are still missing a taxonomy", () => {
    const result = normalizeAll(
      [real, { ...real, place_id: "OTHER", type: "Camel track", types: [] }],
      MAP,
      "downtown",
      DUBAI,
    );
    expect(result.unmappedTaxonomy).toBe(1);
  });
});

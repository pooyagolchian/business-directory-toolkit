import { describe, expect, test } from "vitest";
import { isInCity, parseCityConfig, verificationState } from "./city";
import type { CityConfig, RawLocalResult } from "./types";

// The point of this file: nothing about the filter is Dubai-specific any more.
// A city is data, so pointing the toolkit at Riyadh or Manchester is a config
// change, not a code change.

const dubai: CityConfig = {
  id: "dubai",
  name: "Dubai",
  countryCode: "AE",
  phoneRegion: "AE",
  cityNames: ["dubai", "hatta"],
  boundingBoxes: [
    { minLat: 24.75, maxLat: 25.36, minLng: 54.85, maxLng: 55.65 },
    { minLat: 24.7, maxLat: 24.9, minLng: 56.0, maxLng: 56.25 }, // Hatta exclave
  ],
  tiles: [],
  categories: [],
};

const manchester: CityConfig = {
  id: "manchester",
  name: "Manchester",
  countryCode: "GB",
  phoneRegion: "GB",
  cityNames: ["manchester"],
  boundingBoxes: [
    { minLat: 53.35, maxLat: 53.55, minLng: -2.35, maxLng: -2.15 },
  ],
  tiles: [],
  categories: [],
};

const listing = (over: Partial<RawLocalResult> = {}): RawLocalResult => ({
  place_id: "X",
  city: "Dubai",
  country_code: "AE",
  gps_coordinates: { latitude: 25.1884918, longitude: 55.267011 },
  ...over,
});

describe("isInCity", () => {
  test("accepts a listing in the configured city", () => {
    expect(isInCity(listing(), dubai)).toBe(true);
  });

  test('accepts the "City - Country" spelling the engine also returns', () => {
    expect(
      isInCity(listing({ city: "Dubai - United Arab Emirates" }), dubai),
    ).toBe(true);
  });

  test("rejects a neighbouring city a bounding box alone would accept", () => {
    // Sharjah sits inside any rectangle drawn around Dubai.
    expect(
      isInCity(
        listing({
          city: "Sharjah",
          gps_coordinates: { latitude: 25.3463, longitude: 55.4209 },
        }),
        dubai,
      ),
    ).toBe(false);
  });

  test("rejects a listing from another country", () => {
    expect(isInCity(listing({ country_code: "SA" }), dubai)).toBe(false);
  });

  test("rejects coordinates outside every configured box", () => {
    expect(
      isInCity(
        listing({ gps_coordinates: { latitude: 51.5074, longitude: -0.1278 } }),
        dubai,
      ),
    ).toBe(false);
  });

  test("accepts a secondary box, for cities with detached territory", () => {
    // Hatta is administratively Dubai but ~130km away.
    expect(
      isInCity(
        listing({
          city: "Hatta",
          gps_coordinates: { latitude: 24.7994, longitude: 56.1213 },
        }),
        dubai,
      ),
    ).toBe(true);
  });

  test("accepts a listing with no coordinates, since city is authoritative", () => {
    const { gps_coordinates, ...noGps } = listing();
    void gps_coordinates;
    expect(isInCity(noGps, dubai)).toBe(true);
  });

  test("rejects a listing with no city", () => {
    const { city, ...noCity } = listing();
    void city;
    expect(isInCity(noCity, dubai)).toBe(false);
  });

  test("works for a completely different city with negative longitude", () => {
    expect(
      isInCity(
        {
          place_id: "Y",
          city: "Manchester",
          country_code: "GB",
          gps_coordinates: { latitude: 53.4808, longitude: -2.2426 },
        },
        manchester,
      ),
    ).toBe(true);
  });

  test("does not let a Dubai listing pass a Manchester config", () => {
    expect(isInCity(listing(), manchester)).toBe(false);
  });

  test("matches city names case-insensitively", () => {
    expect(isInCity(listing({ city: "DUBAI" }), dubai)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseCityConfig
//
// loadCity used to end `JSON.parse(raw) as CityConfig`, and that cast was the
// whole problem: a config is hand-written or machine-generated, never checked,
// and three of its five plausible mistakes produce a run that looks fine and is
// quietly wrong. The worst is a density typo — PAGE_CAP misses, maxPages falls
// to 0, and the tile is skipped in silence. One bad tile in forty-four costs a
// neighbourhood of coverage and says nothing.
//
// So this parser throws, for the same reason parseSuppressionList throws: a
// half-valid city and a valid city look identical until the credits are gone.
// ---------------------------------------------------------------------------

const validConfig = {
  id: "lisbon",
  name: "Lisbon",
  countryCode: "PT",
  phoneRegion: "PT",
  cityNames: ["lisbon", "lisboa"],
  boundingBoxes: [
    { minLat: 38.69, maxLat: 38.8, minLng: -9.23, maxLng: -9.09 },
  ],
  tiles: [
    {
      id: "baixa",
      name: "Baixa",
      lat: 38.7107,
      lng: -9.1385,
      zoom: 15,
      density: "dense",
    },
  ],
  categories: [{ q: "restaurants", tier: "broad" }],
};

const withConfig = (over: Record<string, unknown>) =>
  JSON.stringify({ ...validConfig, ...over });

describe("parseCityConfig", () => {
  test("accepts a well-formed config and returns it typed", () => {
    const city = parseCityConfig(JSON.stringify(validConfig));
    expect(city.id).toBe("lisbon");
    expect(city.tiles[0]?.density).toBe("dense");
    expect(city.categories[0]?.tier).toBe("broad");
  });

  test("preserves fields it does not know about", () => {
    // dubai.json carries a `note` explaining its tiling. Rejecting unknown keys
    // would fail the repository's own config.
    const city = parseCityConfig(withConfig({ note: "why these tiles" }));
    expect((city as unknown as { note: string }).note).toBe("why these tiles");
  });

  test("names the source in the error, so a hundred configs stay debuggable", () => {
    expect(() => parseCityConfig("{}", "lisbon")).toThrow(/lisbon/);
  });

  test("rejects JSON that is not an object", () => {
    expect(() => parseCityConfig("[]")).toThrow(/object/i);
    expect(() => parseCityConfig("null")).toThrow(/object/i);
    expect(() => parseCityConfig('"dubai"')).toThrow(/object/i);
  });

  test("rejects a missing or blank id", () => {
    expect(() => parseCityConfig(withConfig({ id: "" }))).toThrow(/id/);
    expect(() => parseCityConfig(withConfig({ id: 7 }))).toThrow(/id/);
  });

  test("rejects a missing name", () => {
    expect(() => parseCityConfig(withConfig({ name: "  " }))).toThrow(/name/);
  });

  test("rejects a countryCode that is not ISO-3166 alpha-2", () => {
    // isInCity compares this straight against the engine's country_code, so a
    // wrong one rejects every record and yields an empty directory.
    expect(() => parseCityConfig(withConfig({ countryCode: "PRT" }))).toThrow(
      /countryCode/,
    );
    expect(() => parseCityConfig(withConfig({ countryCode: "pt" }))).toThrow(
      /countryCode/,
    );
  });

  test("rejects a phoneRegion libphonenumber does not know", () => {
    expect(() => parseCityConfig(withConfig({ phoneRegion: "XX" }))).toThrow(
      /phoneRegion/,
    );
  });

  test("rejects empty cityNames, the primary listing filter", () => {
    expect(() => parseCityConfig(withConfig({ cityNames: [] }))).toThrow(
      /cityNames/,
    );
  });

  test("accepts uppercase cityNames, because isInCity already lowercases", () => {
    // Rejecting a config that demonstrably works would be user-hostile.
    const city = parseCityConfig(withConfig({ cityNames: ["Lisbon"] }));
    expect(city.cityNames).toEqual(["Lisbon"]);
  });

  test("accepts an empty boundingBoxes list, which isInCity supports", () => {
    const city = parseCityConfig(withConfig({ boundingBoxes: [] }));
    expect(city.boundingBoxes).toEqual([]);
  });

  test("rejects a bounding box whose min exceeds its max", () => {
    // Silently rejects every record in the city.
    expect(() =>
      parseCityConfig(
        withConfig({
          boundingBoxes: [
            { minLat: 38.8, maxLat: 38.69, minLng: -9.23, maxLng: -9.09 },
          ],
        }),
      ),
    ).toThrow(/minLat/);
  });

  test("rejects coordinates outside the WGS84 range", () => {
    expect(() =>
      parseCityConfig(
        withConfig({
          boundingBoxes: [
            { minLat: -91, maxLat: 38.8, minLng: -9.23, maxLng: -9.09 },
          ],
        }),
      ),
    ).toThrow(/-91/);
  });

  test("rejects an empty tiles list", () => {
    expect(() => parseCityConfig(withConfig({ tiles: [] }))).toThrow(/tiles/);
  });

  test("rejects a density typo — the silent-zero bug this parser exists for", () => {
    const tiles = [{ ...validConfig.tiles[0], density: "Dense" }];
    expect(() => parseCityConfig(withConfig({ tiles }))).toThrow(/density/);
    expect(() => parseCityConfig(withConfig({ tiles }))).toThrow(/Dense/);
  });

  test("lists the accepted densities, so the error teaches the fix", () => {
    const tiles = [{ ...validConfig.tiles[0], density: "high" }];
    expect(() => parseCityConfig(withConfig({ tiles }))).toThrow(/sparse/);
  });

  test("rejects duplicate tile ids, which would double-crawl an area", () => {
    const tiles = [validConfig.tiles[0], validConfig.tiles[0]];
    expect(() => parseCityConfig(withConfig({ tiles }))).toThrow(/baixa/);
  });

  test("rejects a tile outside the WGS84 range", () => {
    const tiles = [{ ...validConfig.tiles[0], lat: 200 }];
    expect(() => parseCityConfig(withConfig({ tiles }))).toThrow(/lat/);
  });

  test("rejects an implausible zoom", () => {
    // Google Maps zoom runs 0-21; the template uses 13-15.
    const tiles = [{ ...validConfig.tiles[0], zoom: 40 }];
    expect(() => parseCityConfig(withConfig({ tiles }))).toThrow(/zoom/);
  });

  test("rejects an empty categories list", () => {
    expect(() => parseCityConfig(withConfig({ categories: [] }))).toThrow(
      /categories/,
    );
  });

  test("rejects a tier typo — the other half of the silent-zero bug", () => {
    const categories = [{ q: "restaurants", tier: "wide" }];
    expect(() => parseCityConfig(withConfig({ categories }))).toThrow(/tier/);
    expect(() => parseCityConfig(withConfig({ categories }))).toThrow(/wide/);
  });

  test("rejects a blank category query", () => {
    const categories = [{ q: "   ", tier: "broad" }];
    expect(() => parseCityConfig(withConfig({ categories }))).toThrow(/q/);
  });

  test("rejects duplicate category queries, which would spend credits twice", () => {
    const categories = [
      { q: "restaurants", tier: "broad" },
      { q: "restaurants", tier: "niche" },
    ];
    expect(() => parseCityConfig(withConfig({ categories }))).toThrow(
      /restaurants/,
    );
  });

  test("reports malformed JSON without leaking a raw SyntaxError", () => {
    expect(() => parseCityConfig("{ not json", "lisbon")).toThrow(/lisbon/);
  });
});

// ---------------------------------------------------------------------------
// verification
//
// The registry is about to hold configs nobody has ever crawled. A reader has
// to be able to tell those apart from Dubai, which was crawled and measured,
// without taking anyone's word for it — so provenance travels inside the config
// and carries the evidence rather than a bare boolean.
//
// The load-bearing rule is the default: absence means unverified, never
// verified. It is the same choice dropSuppressed makes when a record has no
// place_id — missing information resolves toward the cautious answer.
// ---------------------------------------------------------------------------

const generated = {
  status: "generated",
  source: "openstreetmap",
  generatedAt: "2026-09-01",
  generator: "0.1.0",
};

const verified = {
  status: "verified",
  crawledAt: "2026-08-20",
  requests: 1400,
  uniqueBusinesses: 15246,
  inCity: 14981,
};

describe("parseCityConfig verification block", () => {
  test("accepts a config with no verification at all", () => {
    // A fork must still be able to drop in a minimal JSON file. That is the
    // whole promise of ADR 0005 and it outranks compile-time provenance.
    const city = parseCityConfig(JSON.stringify(validConfig));
    expect(city.verification).toBeUndefined();
  });

  test("accepts a generated block", () => {
    const city = parseCityConfig(withConfig({ verification: generated }));
    expect(city.verification?.status).toBe("generated");
  });

  test("accepts a verified block and keeps the measured numbers", () => {
    const city = parseCityConfig(withConfig({ verification: verified }));
    expect(city.verification).toEqual(verified);
  });

  test("rejects a verification that is not an object", () => {
    expect(() => parseCityConfig(withConfig({ verification: "yes" }))).toThrow(
      /verification/,
    );
  });

  test("rejects an unknown status", () => {
    expect(() =>
      parseCityConfig(withConfig({ verification: { status: "probably" } })),
    ).toThrow(/probably/);
  });

  test("requires a generated block to say where it came from", () => {
    const { source, ...noSource } = generated;
    void source;
    expect(() =>
      parseCityConfig(withConfig({ verification: noSource })),
    ).toThrow(/source/);
  });

  test("requires a generated block to say when and by what version", () => {
    const { generator, ...noGenerator } = generated;
    void generator;
    expect(() =>
      parseCityConfig(withConfig({ verification: noGenerator })),
    ).toThrow(/generator/);
  });

  test("requires a verified block to carry its crawl date", () => {
    const { crawledAt, ...noDate } = verified;
    void crawledAt;
    expect(() => parseCityConfig(withConfig({ verification: noDate }))).toThrow(
      /crawledAt/,
    );
  });

  test("rejects a date that is not ISO yyyy-mm-dd", () => {
    expect(() =>
      parseCityConfig(
        withConfig({ verification: { ...verified, crawledAt: "20th Aug" } }),
      ),
    ).toThrow(/crawledAt/);
  });

  test("rejects counts that are negative or fractional", () => {
    expect(() =>
      parseCityConfig(
        withConfig({ verification: { ...verified, requests: -1 } }),
      ),
    ).toThrow(/requests/);
    expect(() =>
      parseCityConfig(
        withConfig({ verification: { ...verified, uniqueBusinesses: 1.5 } }),
      ),
    ).toThrow(/uniqueBusinesses/);
  });

  test("rejects claiming more businesses in the city than were found", () => {
    // inCity is a subset of uniqueBusinesses by construction — Dubai's crawl
    // found 15,246 and 14,981 of them were actually in Dubai. The reverse is
    // not a small error, it is an incoherent claim.
    expect(() =>
      parseCityConfig(
        withConfig({
          verification: { ...verified, inCity: 99999 },
        }),
      ),
    ).toThrow(/inCity/);
  });
});

describe("verificationState", () => {
  const cityWith = (verification?: unknown) =>
    parseCityConfig(
      verification === undefined
        ? JSON.stringify(validConfig)
        : withConfig({ verification }),
    );

  test("reports an absent block as unknown, never as verified", () => {
    expect(verificationState(cityWith())).toBe("unknown");
  });

  test("reports a generated block as generated", () => {
    expect(verificationState(cityWith(generated))).toBe("generated");
  });

  test("reports a verified block as verified", () => {
    expect(verificationState(cityWith(verified))).toBe("verified");
  });
});

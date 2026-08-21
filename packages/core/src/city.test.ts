import { describe, expect, test } from "vitest";
import { isInCity } from "./city.js";
import type { CityConfig, RawLocalResult } from "./types.js";

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

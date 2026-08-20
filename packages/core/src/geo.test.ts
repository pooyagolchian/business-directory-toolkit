import { describe, expect, test } from "vitest";
import { isDubaiListing } from "./geo.js";
import type { RawLocalResult } from "./types.js";

// Probing 100 Dubai results showed country_code="AE" and a city field on every
// single one — but in two spellings. City is therefore a stronger filter than a
// bounding box, which cannot separate Dubai from Sharjah (their urban areas are
// contiguous and the border is not rectangular).

const dubai: RawLocalResult = {
  place_id: "ChIJpabd1tppXz4RjwONpXIjsp8",
  title: "The MAINE Land Brasserie",
  city: "Dubai",
  country_code: "AE",
  gps_coordinates: { latitude: 25.1884918, longitude: 55.267011 },
};

describe("isDubaiListing", () => {
  test("accepts a real Dubai business", () => {
    expect(isDubaiListing(dubai)).toBe(true);
  });

  test('accepts the "Dubai - United Arab Emirates" city spelling', () => {
    // 20 of 100 probed results used this longer form.
    expect(
      isDubaiListing({ ...dubai, city: "Dubai - United Arab Emirates" }),
    ).toBe(true);
  });

  test("rejects a business in another emirate", () => {
    expect(
      isDubaiListing({
        ...dubai,
        city: "Abu Dhabi",
        gps_coordinates: { latitude: 24.4539, longitude: 54.3773 },
      }),
    ).toBe(false);
  });

  test("rejects Sharjah, which a bounding box alone would wrongly accept", () => {
    // Sharjah city centre sits inside any rectangle drawn around Dubai.
    expect(
      isDubaiListing({
        ...dubai,
        city: "Sharjah",
        gps_coordinates: { latitude: 25.3463, longitude: 55.4209 },
      }),
    ).toBe(false);
  });

  test("rejects a non-UAE country code", () => {
    expect(isDubaiListing({ ...dubai, country_code: "SA" })).toBe(false);
  });

  test("rejects coordinates far outside the emirate even if the city string says Dubai", () => {
    // Guards against a mislabelled listing dragging a foreign business in.
    expect(
      isDubaiListing({
        ...dubai,
        gps_coordinates: { latitude: 51.5074, longitude: -0.1278 },
      }),
    ).toBe(false);
  });

  test("accepts a Dubai listing that has no coordinates", () => {
    // City and country are authoritative; missing GPS should not lose a record.
    const { gps_coordinates, ...noGps } = dubai;
    void gps_coordinates;
    expect(isDubaiListing(noGps)).toBe(true);
  });

  test("rejects a record with no city at all", () => {
    const { city, ...noCity } = dubai;
    void city;
    expect(isDubaiListing(noCity)).toBe(false);
  });

  test("accepts Hatta, which is part of Dubai but geographically separate", () => {
    expect(
      isDubaiListing({
        ...dubai,
        city: "Hatta",
        gps_coordinates: { latitude: 24.7994, longitude: 56.1213 },
      }),
    ).toBe(true);
  });
});

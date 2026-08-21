import { describe, expect, test } from "vitest";
import { extractAmenities } from "./amenities";

/**
 * The engine returns an `extensions` block on 91% of listings — accessibility,
 * payment methods, service options. The pipeline was discarding all of it,
 * which meant paying for the data and then throwing it away.
 *
 * Accessibility is the part worth surfacing. "Which pharmacies near me have a
 * wheelchair-accessible entrance" is a question no Dubai directory answers, and
 * the data to answer it was already on disk.
 */
describe("extractAmenities", () => {
  const raw = [
    {
      title: "Accessibility",
      items: [
        {
          title: "Wheelchair-accessible entrance",
          value: "Has wheelchair accessible entrance",
        },
        {
          title: "Wheelchair-accessible car park",
          value: "Has wheelchair accessible parking lot",
        },
      ],
    },
    {
      title: "Payments",
      items: [
        { title: "NFC mobile payments", value: "Accepts NFC" },
        { title: "Credit cards", value: "Accepts credit cards" },
      ],
    },
    {
      title: "Service options",
      items: [{ title: "Delivery", value: "Offers delivery" }],
    },
  ];

  test("collects accessibility attributes", () => {
    expect(extractAmenities(raw).accessibility).toContain(
      "wheelchair-accessible-entrance",
    );
  });

  test("collects payment methods", () => {
    expect(extractAmenities(raw).payments).toContain("nfc-mobile-payments");
  });

  test("collects service options", () => {
    expect(extractAmenities(raw).services).toContain("delivery");
  });

  test("slugifies so the values are usable as filter keys and URLs", () => {
    // "Wheelchair-accessible car park" must not become a query-string problem.
    for (const v of extractAmenities(raw).accessibility) {
      expect(v).toMatch(/^[a-z0-9-]+$/);
    }
  });

  test("ignores groups it does not understand rather than inventing a bucket", () => {
    const out = extractAmenities([
      { title: "Atmosphere", items: [{ title: "Cosy", value: "Cosy" }] },
    ]);
    expect(out.accessibility).toEqual([]);
    expect(out.payments).toEqual([]);
    expect(out.services).toEqual([]);
  });

  test("survives malformed input, since this comes straight off an API", () => {
    for (const bad of [undefined, null, [], [{}], [{ items: null }], "nope"]) {
      const out = extractAmenities(bad);
      expect(Array.isArray(out.accessibility)).toBe(true);
    }
  });

  test("deduplicates repeated attributes", () => {
    const out = extractAmenities([
      {
        title: "Accessibility",
        items: [
          { title: "Wheelchair-accessible entrance" },
          { title: "Wheelchair-accessible entrance" },
        ],
      },
    ]);
    expect(out.accessibility).toEqual(["wheelchair-accessible-entrance"]);
  });

  test("recognises the American spelling the engine also returns", () => {
    // Observed both "car park" and "parking lot" in live responses.
    const out = extractAmenities([
      {
        title: "Accessibility",
        items: [{ title: "Wheelchair accessible parking lot" }],
      },
    ]);
    expect(out.accessibility).toContain("wheelchair-accessible-parking-lot");
  });
});

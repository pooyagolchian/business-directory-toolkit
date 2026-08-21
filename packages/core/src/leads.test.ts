import { describe, expect, test } from "vitest";
import { detectSignals, isContactable, LEAD_SIGNALS } from "./leads";
import type { Business } from "./types";

const base: Business = {
  placeId: "X",
  slug: "x",
  title: "X",
  area: "deira",
  types: [],
  phoneE164: "+97141234567",
  website: "https://example.invalid",
  rating: 4.5,
  reviews: 200,
  openHours: { monday: "9 AM–6 PM" },
};

describe("detectSignals", () => {
  test("finds no signal on a business with no gaps", () => {
    expect(detectSignals(base)).toEqual([]);
  });

  test("flags a business with no website", () => {
    const { website, ...noSite } = base;
    void website;
    expect(detectSignals(noSite as Business)).toContain("no-website");
  });

  test("flags weak reputation only when there are enough reviews to mean it", () => {
    // 2.0 from 3 reviews is noise, not a reputation problem to sell against.
    expect(detectSignals({ ...base, rating: 2.0, reviews: 200 })).toContain(
      "weak-reputation",
    );
    expect(detectSignals({ ...base, rating: 2.0, reviews: 3 })).not.toContain(
      "weak-reputation",
    );
  });

  test("flags low visibility below ten reviews", () => {
    expect(detectSignals({ ...base, reviews: 4 })).toContain("low-visibility");
    expect(detectSignals({ ...base, reviews: 40 })).not.toContain(
      "low-visibility",
    );
  });

  test("flags a business with no opening hours", () => {
    const { openHours, ...noHours } = base;
    void openHours;
    expect(detectSignals(noHours as Business)).toContain("no-hours");
  });

  test("returns several signals when a business has several gaps", () => {
    const { website, openHours, ...gappy } = base;
    void website;
    void openHours;
    const signals = detectSignals({ ...gappy, reviews: 2 } as Business);
    expect(signals).toContain("no-website");
    expect(signals).toContain("no-hours");
    expect(signals).toContain("low-visibility");
  });

  test("only ever returns known signals", () => {
    // exactOptionalPropertyTypes rejects `website: undefined` against
    // `website?: string` — omit the key with object rest instead of
    // widening the production type to accommodate a test fixture.
    const { website, ...noSite } = base;
    void website;
    for (const signal of detectSignals(noSite as Business)) {
      expect(LEAD_SIGNALS).toContain(signal);
    }
  });
});

describe("isContactable", () => {
  test("requires a phone number", () => {
    // A lead you cannot ring is not a lead, whatever else is wrong with it.
    const { phoneE164, ...noPhone } = base;
    void phoneE164;
    expect(isContactable(noPhone as Business)).toBe(false);
    expect(isContactable(base)).toBe(true);
  });
});

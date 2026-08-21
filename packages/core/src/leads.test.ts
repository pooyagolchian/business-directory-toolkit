import { describe, expect, test } from "vitest";
import {
  detectSignals,
  isContactable,
  LEAD_SIGNALS,
  leadScore,
  signalStrength,
} from "./leads";
import type { RankPrior } from "./rank";
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

describe("leadScore", () => {
  const prior: RankPrior = { mean: 4.5, weight: 76 };

  test("ranks a thriving business above a struggling one with the same gap", () => {
    // The core idea: the best lead is a SUCCESSFUL business with a fixable
    // gap. Both lack a website; only one is worth calling first.
    //
    // exactOptionalPropertyTypes rejects `website: undefined` against
    // `website?: string`, and `as Business` does not rescue it either — so
    // the key is omitted with object rest, same as `detectSignals` above.
    const { website: thrivingWebsite, ...thriving } = {
      ...base,
      rating: 4.8,
      reviews: 500,
    };
    void thrivingWebsite;
    const { website: strugglingWebsite, ...struggling } = {
      ...base,
      rating: 3.1,
      reviews: 20,
    };
    void strugglingWebsite;
    expect(
      leadScore(thriving as Business, "no-website", prior),
    ).toBeGreaterThan(leadScore(struggling as Business, "no-website", prior));
  });

  test("scores a worse rating as a stronger reputation signal", () => {
    const bad = { ...base, rating: 2.0, reviews: 300 };
    const borderline = { ...base, rating: 3.7, reviews: 300 };
    expect(signalStrength(bad as Business, "weak-reputation")).toBeGreaterThan(
      signalStrength(borderline as Business, "weak-reputation"),
    );
  });

  test("scores fewer reviews as a stronger visibility signal", () => {
    expect(
      signalStrength({ ...base, reviews: 0 } as Business, "low-visibility"),
    ).toBeGreaterThan(
      signalStrength({ ...base, reviews: 9 } as Business, "low-visibility"),
    );
  });

  test("treats a binary gap as full strength", () => {
    const { website, ...noWebsite } = base;
    void website;
    expect(signalStrength(noWebsite as Business, "no-website")).toBe(1);
  });

  test("keeps strength within 0 and 1 for every signal", () => {
    const { website, ...noWebsite } = { ...base, rating: 1, reviews: 0 };
    void website;
    for (const signal of LEAD_SIGNALS) {
      const strength = signalStrength(noWebsite as Business, signal);
      expect(strength).toBeGreaterThanOrEqual(0);
      expect(strength).toBeLessThanOrEqual(1);
    }
  });

  test("never returns NaN on missing fields", () => {
    const sparse = {
      placeId: "S",
      slug: "s",
      title: "S",
      area: "a",
      types: [],
    } as Business;
    for (const signal of LEAD_SIGNALS) {
      expect(Number.isFinite(leadScore(sparse, signal, prior))).toBe(true);
    }
  });
});

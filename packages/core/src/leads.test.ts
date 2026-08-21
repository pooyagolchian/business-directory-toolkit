import { describe, expect, test } from "vitest";
import {
  detectSignals,
  findLeads,
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

  test("does not flag weak reputation when rating is genuinely absent", () => {
    // Unknown quality is not bad quality. The prior tests only ever set
    // `rating` to an explicit low number, so this branch — rating truly
    // missing, as the engine returns for listings it has no score for —
    // was never directly exercised.
    const { rating, ...noRating } = base;
    void rating;
    expect(detectSignals(noRating as Business)).not.toContain(
      "weak-reputation",
    );
  });

  test("flags low visibility when reviews is genuinely absent", () => {
    // An absent review count plausibly means zero reviews — the strongest
    // visibility gap there is — not "unknown, so leave it unflagged".
    const { reviews, ...noReviews } = base;
    void reviews;
    expect(detectSignals(noReviews as Business)).toContain("low-visibility");
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

describe("findLeads", () => {
  const prior: RankPrior = { mean: 4.5, weight: 76 };
  const opts = { signal: "no-website" as const, prior };

  const corpus: Business[] = [
    {
      ...base,
      placeId: "A",
      title: "A",
      website: undefined,
      rating: 4.8,
      reviews: 500,
    },
    {
      ...base,
      placeId: "B",
      title: "B",
      website: undefined,
      rating: 3.1,
      reviews: 30,
    },
    { ...base, placeId: "C", title: "C" },
    {
      ...base,
      placeId: "D",
      title: "D",
      website: undefined,
      phoneE164: undefined,
    },
  ] as Business[];

  test("returns only businesses carrying the requested signal", () => {
    const { leads } = findLeads(corpus, opts);
    expect(leads.map((l) => l.business.placeId)).not.toContain("C");
  });

  test("excludes businesses with no phone, however good the signal", () => {
    const { leads } = findLeads(corpus, opts);
    expect(leads.map((l) => l.business.placeId)).not.toContain("D");
  });

  test("ranks the healthier prospect first", () => {
    const { leads } = findLeads(corpus, opts);
    expect(leads[0]?.business.placeId).toBe("A");
  });

  test("never returns a suppressed business", () => {
    // A business that asked to be removed must not resurface on a call list.
    const { leads, suppressed } = findLeads(corpus, {
      ...opts,
      suppressed: new Set(["A"]),
    });
    expect(leads.map((l) => l.business.placeId)).not.toContain("A");
    expect(suppressed).toBe(1);
  });

  test("reports zero suppressed when the list is empty", () => {
    expect(findLeads(corpus, opts).suppressed).toBe(0);
  });

  test("filters by category", () => {
    const { leads } = findLeads(
      [
        { ...corpus[0], l2: "Restaurants" },
        { ...corpus[1], l2: "Salons" },
      ] as Business[],
      { ...opts, category: "Restaurants" },
    );
    expect(leads).toHaveLength(1);
    expect(leads[0]?.business.l2).toBe("Restaurants");
  });

  test("filters by area", () => {
    const { leads } = findLeads(
      [
        { ...corpus[0], area: "marina" },
        { ...corpus[1], area: "deira" },
      ] as Business[],
      { ...opts, area: "marina" },
    );
    expect(leads).toHaveLength(1);
  });

  test("filters by minimum review count", () => {
    const { leads } = findLeads(corpus, { ...opts, minReviews: 100 });
    expect(leads.every((l) => (l.business.reviews ?? 0) >= 100)).toBe(true);
  });

  test("respects the limit", () => {
    expect(findLeads(corpus, { ...opts, limit: 1 }).leads).toHaveLength(1);
  });

  test("attaches a human-readable reason to every lead", () => {
    // The list has to be auditable — a score with no explanation is a number
    // someone will either trust blindly or ignore.
    for (const lead of findLeads(corpus, opts).leads) {
      expect(lead.reason.length).toBeGreaterThan(0);
    }
  });

  test("returns an empty result rather than throwing on an empty corpus", () => {
    expect(findLeads([], opts)).toEqual({
      leads: [],
      suppressed: 0,
      considered: 0,
    });
  });
});

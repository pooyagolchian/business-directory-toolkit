import { describe, expect, test } from "vitest";
import {
  detectSignals,
  establishment,
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

  test("never returns NaN when reviews itself is NaN", () => {
    // `?? 0` only replaces null/undefined — NaN sails straight through it.
    // Mirrors the same non-finite guard `weak-reputation` already has.
    const strength = signalStrength(
      { ...base, reviews: NaN } as Business,
      "low-visibility",
    );
    expect(Number.isFinite(strength)).toBe(true);
    expect(strength).toBeGreaterThanOrEqual(0);
    expect(strength).toBeLessThanOrEqual(1);
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

  test("a heavily-reviewed weak-reputation business outranks a lightly-reviewed one with the identical rating", () => {
    // This is the bug the establishment fix exists to close. Under the OLD
    // businessHealth (rankScore, a credibility-shrunk RATING), a below-prior
    // rating is shrunk UPWARD toward the corpus mean, and shrunk LESS the
    // more reviews back it — so rankScore DECREASED with review count for a
    // below-average business. Multiplying by it demoted exactly the
    // established, high-volume businesses this signal exists to surface: on
    // the real corpus, a 3.6-rated hospital with 5,562 reviews sat at #522 of
    // 641, below bank ATMs with 23-37 reviews. Same rating here isolates the
    // effect to review count alone.
    const veteran = { ...base, rating: 3.6, reviews: 5000 };
    const newcomer = { ...base, rating: 3.6, reviews: 25 };
    expect(
      leadScore(veteran as Business, "weak-reputation", prior),
    ).toBeGreaterThan(
      leadScore(newcomer as Business, "weak-reputation", prior),
    );
  });

  test("a more severe reputation gap outranks a less severe one at equal health", () => {
    // Pins the MULTIPLICATION itself, not just signalStrength in isolation.
    // The two product tests above ("ranks a thriving business..." and the
    // veteran/newcomer test just above) both still pass if leadScore's body
    // is replaced with `return health;` — for "ranks a thriving business",
    // signalStrength is the constant 1.0 for no-website, so the product is
    // tautologically just health; for veteran/newcomer, health itself
    // already orders correctly by review count regardless of signalStrength.
    // Equal reviews here (hence equal establishment/health for both) removes
    // health as a variable, so only signalStrength — multiplied in — can
    // explain the expected ordering. Verified by mutation: see the report.
    const worse = { ...base, rating: 2.0, reviews: 200 };
    const lessBad = { ...base, rating: 3.7, reviews: 200 };
    expect(
      leadScore(worse as Business, "weak-reputation", prior),
    ).toBeGreaterThan(leadScore(lessBad as Business, "weak-reputation", prior));
  });
});

describe("establishment", () => {
  const prior: RankPrior = { mean: 4.5, weight: 76 };

  test("is zero with no reviews", () => {
    expect(establishment(0, prior)).toBe(0);
    expect(establishment(undefined, prior)).toBe(0);
  });

  test("reaches exactly half at the prior's weight, and rises toward but never reaches 1", () => {
    expect(establishment(76, prior)).toBeCloseTo(0.5, 10);
    expect(establishment(10_000, prior)).toBeGreaterThan(0.99);
    expect(establishment(10_000, prior)).toBeLessThan(1);
  });

  test("is monotonically increasing in review count", () => {
    expect(establishment(500, prior)).toBeGreaterThan(establishment(20, prior));
    expect(establishment(20, prior)).toBeGreaterThan(establishment(0, prior));
  });

  test("treats absent, zero, negative, and non-finite reviews as no evidence", () => {
    expect(establishment(undefined, prior)).toBe(0);
    expect(establishment(0, prior)).toBe(0);
    expect(establishment(-5, prior)).toBe(0);
    expect(establishment(NaN, prior)).toBe(0);
    expect(establishment(Infinity, prior)).toBe(0);
  });

  test("never returns NaN or Infinity even with a degenerate prior", () => {
    // A zero weight would divide by zero when reviews is also zero — the
    // one combination `rankScore`'s own guard doesn't have to worry about,
    // since establishment's shape (v / (v + m)) puts m in the denominator
    // unconditionally, unlike rankScore's early return on evidence === 0.
    const degeneratePriors: RankPrior[] = [
      { mean: 4.5, weight: 0 },
      { mean: 4.5, weight: -10 },
      { mean: 4.5, weight: NaN },
    ];
    for (const degenerate of degeneratePriors) {
      for (const reviews of [0, 5, undefined, NaN, -3]) {
        const result = establishment(reviews, degenerate);
        expect(Number.isFinite(result)).toBe(true);
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThan(1);
      }
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

  test("returns the FULL ranked order, not just the top lead", () => {
    // `corpus` above happens to already be listed in descending-score order
    // (A then B), so deleting `.sort()` from `findLeads` entirely would still
    // leave `leads[0]` correct and the whole suite green — only `leads[0]`
    // was ever inspected. This corpus is listed in an order UNRELATED to
    // score (list order is not review-count order), so only a real sort
    // produces the expected array; with `.sort()` removed, `Array.prototype
    // .filter().map()` preserves this shuffled list order instead.
    const { website, ...noWebsiteBase } = base;
    void website;
    const shuffled: Business[] = [
      { ...noWebsiteBase, placeId: "mid", title: "Mid", reviews: 50 },
      { ...noWebsiteBase, placeId: "lowest", title: "Lowest", reviews: 5 },
      { ...noWebsiteBase, placeId: "highest", title: "Highest", reviews: 900 },
      { ...noWebsiteBase, placeId: "second", title: "Second", reviews: 300 },
    ] as Business[];

    const { leads } = findLeads(shuffled, opts);
    expect(leads.map((l) => l.business.placeId)).toEqual([
      "highest",
      "second",
      "mid",
      "lowest",
    ]);
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

  test("matches category against l3 as well as l2", () => {
    // The filter is `b.l2 !== category && b.l3 !== category`, both halves
    // required — a business the taxonomy placed only at l3 (a niche
    // sub-category with a distinct l2 parent) must still match a `--category`
    // query for that l3 value. Deleting the `b.l3` half leaves this business
    // filtered out, since its l2 ("Food") does not equal "Sushi".
    const { leads } = findLeads(
      [{ ...corpus[0], l2: "Food", l3: "Sushi" }] as Business[],
      { ...opts, category: "Sushi" },
    );
    expect(leads).toHaveLength(1);
    expect(leads[0]?.business.l3).toBe("Sushi");
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

  test("filters by minimum rating", () => {
    // `corpus` carries A (rating 4.8) and B (rating 3.1). Deleting the
    // `minRating` check leaves B on the list despite failing the 4.0 floor.
    const { leads } = findLeads(corpus, { ...opts, minRating: 4.0 });
    const ids = leads.map((l) => l.business.placeId);
    expect(ids).toContain("A");
    expect(ids).not.toContain("B");
    expect(leads.every((l) => (l.business.rating ?? 0) >= 4.0)).toBe(true);
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

  test("the no-website reason does not claim 'established' for a business with few or no reviews", () => {
    // The reason string used to read "N reviews suggest an established
    // business" unconditionally — on the real corpus, 268 of 3,820
    // no-website leads have 0 reviews, so 7% of rows made a claim false on
    // its face in a CSV a client might open directly.
    const { website, ...noWebsiteBase } = base;
    void website;
    const zero = { ...noWebsiteBase, placeId: "Z", reviews: 0 };
    const few = { ...noWebsiteBase, placeId: "F", reviews: 4 };
    const many = { ...noWebsiteBase, placeId: "M", reviews: 500 };

    const { leads } = findLeads([zero, few, many] as Business[], {
      signal: "no-website",
      prior,
    });
    const reasonOf = (id: string) =>
      leads.find((l) => l.business.placeId === id)?.reason ?? "";

    // The specific false claim this fix removes is "N reviews suggest an
    // established business" for a business with too few (or zero) reviews
    // to support that claim — not the word "established" in isolation, which
    // an honest negation ("may not be an established business") legitimately
    // still contains.
    const falseClaim = /reviews suggest an established business/;
    expect(reasonOf("Z")).not.toMatch(falseClaim);
    expect(reasonOf("F")).not.toMatch(falseClaim);
    expect(reasonOf("M")).toMatch(falseClaim);
  });

  test("returns an empty result rather than throwing on an empty corpus", () => {
    expect(findLeads([], opts)).toEqual({
      leads: [],
      suppressed: 0,
      considered: 0,
    });
  });
});

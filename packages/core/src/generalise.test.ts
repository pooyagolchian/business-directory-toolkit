import { describe, expect, test } from "vitest";
import {
  MIN_BUSINESSES_PER_THEME,
  MIN_CATEGORY_CONCENTRATION,
  keepGeneralisableThemes,
  keepTopicalThemes,
} from "./generalise";

/**
 * Stripping reviewer identity is not enough.
 *
 * Reviewers thank individual employees by name — "Nadia was wonderful" — and
 * TF-IDF rewards exactly that shape: frequent for one business, rare
 * everywhere else. Left alone it publishes staff names on a public page, which
 * is the personal data this project promises never to collect.
 *
 * The distinguishing property is generalisation. A real theme recurs across
 * many businesses; a staff name belongs to one. That test needs no name list,
 * works in any language, and cannot be defeated by an unusual name.
 */
describe("keepGeneralisableThemes", () => {
  const signals = {
    hotelA: {
      reviewsAnalysed: 10,
      averageRating: 4.5,
      themes: ["breakfast", "nadia", "parking"],
    },
    hotelB: {
      reviewsAnalysed: 10,
      averageRating: 4.2,
      themes: ["breakfast", "wilbert", "parking"],
    },
    cafeC: {
      reviewsAnalysed: 10,
      averageRating: 4.8,
      themes: ["breakfast", "shisha", "umesh"],
    },
  };

  test("drops a term that belongs to only one business", () => {
    const out = keepGeneralisableThemes(signals, 2);
    expect(out.hotelA?.themes).not.toContain("nadia");
    expect(out.hotelB?.themes).not.toContain("wilbert");
    expect(out.cafeC?.themes).not.toContain("umesh");
  });

  test("keeps a term that recurs across businesses", () => {
    const out = keepGeneralisableThemes(signals, 2);
    expect(out.hotelA?.themes).toContain("breakfast");
    expect(out.hotelA?.themes).toContain("parking");
  });

  test("respects the threshold it is given", () => {
    // At 3, "parking" (2 businesses) no longer qualifies but "breakfast" (3) does.
    const out = keepGeneralisableThemes(signals, 3);
    expect(out.hotelA?.themes).toContain("breakfast");
    expect(out.hotelA?.themes).not.toContain("parking");
  });

  test("leaves the non-theme fields untouched", () => {
    const out = keepGeneralisableThemes(signals, 2);
    expect(out.hotelA?.reviewsAnalysed).toBe(10);
    expect(out.hotelA?.averageRating).toBe(4.5);
  });

  test("keeps a business whose themes are all dropped, rather than deleting it", () => {
    // The rating and count are still worth having.
    const out = keepGeneralisableThemes(
      { solo: { reviewsAnalysed: 5, averageRating: 4, themes: ["zamboni"] } },
      2,
    );
    expect(out.solo).toBeDefined();
    expect(out.solo?.themes).toEqual([]);
  });

  test("handles an empty input", () => {
    expect(keepGeneralisableThemes({}, 2)).toEqual({});
  });

  test("counts a business once even if a term repeats in its own themes", () => {
    const duped = {
      a: { reviewsAnalysed: 1, averageRating: 5, themes: ["spa", "spa"] },
      b: { reviewsAnalysed: 1, averageRating: 5, themes: ["pool"] },
    };
    // "spa" is still only one business, so it must not survive a threshold of 2.
    expect(keepGeneralisableThemes(duped, 2).a?.themes).not.toContain("spa");
  });
});

/**
 * Recurrence alone does not stop a staff name.
 *
 * `keepGeneralisableThemes` removes a name that belongs to one business, but
 * common given names defeat it: enough businesses employ a Neha or an Abdul
 * that the name recurs on its own. Measured on the live corpus, "neha"
 * cleared the recurrence bar at exactly 5 businesses and was published as the
 * ONLY theme of two medical facilities.
 *
 * The property that separates the two is topicality. A real theme belongs to
 * a kind of business — "biryani" is about food wherever it appears. A person's
 * name is not about anything, so it scatters across unrelated verticals: a
 * hospital receptionist and a hotel concierge who happen to share a name.
 *
 * Being a ratio rather than a count, this also survives a bigger crawl, which
 * the recurrence threshold does not — a count calibrated on 999 businesses
 * lets every name through at 11,890.
 */
describe("keepTopicalThemes", () => {
  const businesses = [
    {
      placeId: "clinic1",
      title: "Al Noor Polyclinic Satwa",
      l1: "Health & Medical",
      l2: "Clinics",
      types: ["Clinic"],
    },
    {
      placeId: "hospital1",
      title: "PRIME Hospital",
      l1: "Health & Medical",
      l2: "Hospitals",
      types: ["Hospital"],
    },
    {
      placeId: "hospital2",
      title: "Aster Hospital",
      l1: "Health & Medical",
      l2: "Hospitals",
      types: ["Hospital"],
    },
    {
      placeId: "hotel1",
      title: "City Seasons Towers Hotel",
      l1: "Travel & Hospitality",
      l2: "Hotels",
      types: ["Hotel"],
    },
    {
      placeId: "hotel2",
      title: "Sheraton Jumeirah Beach Resort",
      l1: "Travel & Hospitality",
      l2: "Hotels",
      types: ["Resort hotel"],
    },
    {
      placeId: "rest1",
      title: "Ravi Restaurant",
      l1: "Food & Drink",
      l2: "Restaurants",
      types: ["Pakistani restaurant"],
    },
    {
      placeId: "rest2",
      title: "Bikanervala",
      l1: "Food & Drink",
      l2: "Restaurants",
      types: ["Indian restaurant"],
    },
    {
      placeId: "rest3",
      title: "Kamat",
      l1: "Food & Drink",
      l2: "Restaurants",
      types: ["Vegetarian restaurant"],
    },
  ];

  const signal = (themes: string[]) => ({
    reviewsAnalysed: 10,
    averageRating: 4.5,
    themes,
  });

  test("drops a staff name that scatters across unrelated verticals", () => {
    // The live defect: 3 medical + 2 hospitality = 0.6 concentration.
    const out = keepTopicalThemes(
      {
        clinic1: signal(["neha"]),
        hospital1: signal(["neha"]),
        hospital2: signal(["neha"]),
        hotel1: signal(["neha"]),
        hotel2: signal(["neha"]),
      },
      businesses,
      0.75,
    );
    for (const id of [
      "clinic1",
      "hospital1",
      "hospital2",
      "hotel1",
      "hotel2",
    ]) {
      expect(out[id]?.themes).not.toContain("neha");
    }
  });

  test("keeps a theme that stays inside one top-level category", () => {
    const out = keepTopicalThemes(
      {
        rest1: signal(["biryani"]),
        rest2: signal(["biryani"]),
        rest3: signal(["biryani"]),
      },
      businesses,
      0.75,
    );
    expect(out.rest1?.themes).toContain("biryani");
    expect(out.rest3?.themes).toContain("biryani");
  });

  test("keeps a term on the business it actually names, and drops it elsewhere", () => {
    // "sheraton" spans two verticals, so concentration alone would drop it.
    // It is legitimate on the hotel called Sheraton and nowhere else.
    const out = keepTopicalThemes(
      { hotel2: signal(["sheraton"]), hospital1: signal(["sheraton"]) },
      businesses,
      0.75,
    );
    expect(out.hotel2?.themes).toContain("sheraton");
    expect(out.hospital1?.themes).not.toContain("sheraton");
  });

  test("treats the category vocabulary as self-naming too", () => {
    // A clinic may be described as a "clinic" however few clinics there are.
    const out = keepTopicalThemes(
      { clinic1: signal(["clinic"]) },
      businesses,
      0.75,
    );
    expect(out.clinic1?.themes).toContain("clinic");
  });

  test("a business with no category cannot lend concentration to a term", () => {
    // Fail closed: an unclassified business is not evidence of topicality.
    const unclassified = [
      { placeId: "x1", title: "One", types: [] },
      { placeId: "x2", title: "Two", types: [] },
    ];
    const out = keepTopicalThemes(
      { x1: signal(["mysteryword"]), x2: signal(["mysteryword"]) },
      unclassified,
      0.75,
    );
    expect(out.x1?.themes).toEqual([]);
  });

  test("a business missing from the corpus loses its themes rather than passing them through", () => {
    const out = keepTopicalThemes(
      { ghost: signal(["anything"]) },
      businesses,
      0.75,
    );
    expect(out.ghost).toBeDefined();
    expect(out.ghost?.themes).toEqual([]);
  });

  test("leaves the non-theme fields untouched", () => {
    const out = keepTopicalThemes(
      { rest1: signal(["biryani"]) },
      businesses,
      0.75,
    );
    expect(out.rest1?.reviewsAnalysed).toBe(10);
    expect(out.rest1?.averageRating).toBe(4.5);
  });

  test("handles an empty input", () => {
    expect(keepTopicalThemes({}, businesses, 0.75)).toEqual({});
  });
});

/**
 * The two thresholds are the privacy policy, so they are pinned here rather
 * than left in the CLI where nothing would fail if someone edited them.
 */
describe("theme thresholds", () => {
  test("a theme must recur across at least 5 businesses", () => {
    expect(MIN_BUSINESSES_PER_THEME).toBe(5);
  });

  test("three quarters of a theme's businesses must share a top-level category", () => {
    expect(MIN_CATEGORY_CONCENTRATION).toBe(0.75);
  });
});

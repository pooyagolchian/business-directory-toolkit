import { describe, expect, test } from "vitest";
import { deriveReviewSignals, stripReviewIdentity } from "./reviews.js";

// The engine returns reviewer names, contributor ids, profile links and photos.
// None of that may be stored: the project indexes business listings, and a
// reviewer is a private individual, not a business.
//
// The identity below is INVENTED. An earlier version of this file pasted a
// real reviewer straight out of a live API response — which would have
// published a real person's name and Google contributor id in a public repo,
// inside the very test that asserts we never do that. Fixtures that stand in
// for personal data must always be fabricated.

describe("stripReviewIdentity", () => {
  const raw = {
    review_id: "abc",
    rating: 5,
    text: "Great breakfast and friendly staff.",
    iso_date: "2026-07-01T00:00:00Z",
    likes: 3,
    user: {
      name: "Example Reviewer",
      link: "https://example.invalid/maps/contrib/000000000000000000000/reviews",
      contributor_id: "000000000000000000000",
      thumbnail: "https://example.invalid/avatar/000",
    },
    images: ["https://example.invalid/photo/000"],
  };

  test("keeps the rating and the text", () => {
    const clean = stripReviewIdentity(raw);
    expect(clean?.rating).toBe(5);
    expect(clean?.text).toBe("Great breakfast and friendly staff.");
  });

  test("drops the reviewer entirely", () => {
    const clean = stripReviewIdentity(raw);
    expect(JSON.stringify(clean)).not.toContain("Example Reviewer");
    expect(JSON.stringify(clean)).not.toContain("000000000000000000000");
  });

  test("drops reviewer photos, which can contain identifiable people", () => {
    expect(JSON.stringify(stripReviewIdentity(raw))).not.toContain(
      "example.invalid",
    );
  });

  test("drops a review with no text, since a bare star adds nothing", () => {
    expect(stripReviewIdentity({ rating: 4 })).toBeNull();
  });

  test("drops a malformed entry rather than guessing", () => {
    expect(stripReviewIdentity(null)).toBeNull();
    expect(stripReviewIdentity({ text: "no rating" })).toBeNull();
  });
});

describe("deriveReviewSignals", () => {
  // Terms common everywhere carry no information; terms common HERE and rare
  // elsewhere are what distinguishes a business.
  const corpus = new Map<string, number>([
    ["dubai", 900],
    ["good", 800],
    ["place", 700],
    ["staff", 300],
    ["breakfast", 40],
    ["parking", 30],
    ["shisha", 5],
  ]);

  const reviews = [
    { rating: 5, text: "Good place in Dubai, the breakfast was excellent" },
    { rating: 4, text: "Breakfast is great and parking is easy" },
    { rating: 5, text: "Lovely breakfast, good staff, easy parking" },
  ];

  test("averages the ratings it was given", () => {
    expect(deriveReviewSignals(reviews, corpus).averageRating).toBeCloseTo(
      4.67,
      1,
    );
  });

  test("counts how many reviews it actually analysed", () => {
    expect(deriveReviewSignals(reviews, corpus).reviewsAnalysed).toBe(3);
  });

  test("surfaces the distinctive terms, not the ubiquitous ones", () => {
    const themes = deriveReviewSignals(reviews, corpus).themes;
    expect(themes).toContain("breakfast");
    // "good" appears in two reviews but is everywhere in the corpus.
    expect(themes).not.toContain("good");
  });

  test("ignores stopwords entirely", () => {
    const themes = deriveReviewSignals(reviews, corpus).themes;
    expect(themes).not.toContain("the");
    expect(themes).not.toContain("was");
    expect(themes).not.toContain("and");
  });

  test("requires a term to appear in more than one review", () => {
    // A single reviewer's idiosyncratic word is not a theme.
    const signals = deriveReviewSignals(
      [
        { rating: 5, text: "The zamboni was remarkable" },
        { rating: 5, text: "Breakfast was fine" },
        { rating: 5, text: "Breakfast again" },
      ],
      corpus,
    );
    expect(signals.themes).not.toContain("zamboni");
  });

  test("returns no themes when there is nothing to go on", () => {
    const signals = deriveReviewSignals([], corpus);
    expect(signals.themes).toEqual([]);
    expect(signals.reviewsAnalysed).toBe(0);
  });

  test("never returns the review text itself", () => {
    // The whole point: we publish what we derived, not what Google's users wrote.
    const signals = deriveReviewSignals(reviews, corpus);
    expect(JSON.stringify(signals)).not.toContain("excellent");
    expect(JSON.stringify(signals)).not.toContain("Lovely");
  });
});

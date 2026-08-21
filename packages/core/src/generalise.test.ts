import { describe, expect, test } from "vitest";
import { keepGeneralisableThemes } from "./generalise";

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

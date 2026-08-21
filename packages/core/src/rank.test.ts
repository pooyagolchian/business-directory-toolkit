import { describe, expect, test } from "vitest";
import { corpusPrior, rankScore } from "./rank";

/**
 * Sorting a directory by raw rating is wrong, and obviously so once you look
 * at real data: a single 5-star review outranks 2,000 reviews averaging 4.6.
 * The star average is an estimate, and an estimate from three samples deserves
 * less confidence than one from three thousand.
 *
 * The fix is a credibility-weighted mean — pull every rating toward the corpus
 * average in proportion to how little evidence supports it.
 */
describe("rankScore", () => {
  const prior = { mean: 4.0, weight: 50 };

  test("ranks a well-reviewed 4.6 above a 5.0 with three reviews", () => {
    const established = rankScore(4.6, 2000, prior);
    const newcomer = rankScore(5.0, 3, prior);
    expect(established).toBeGreaterThan(newcomer);
  });

  test("still prefers the better of two equally-established businesses", () => {
    expect(rankScore(4.8, 2000, prior)).toBeGreaterThan(
      rankScore(4.2, 2000, prior),
    );
  });

  test("still prefers more evidence when the ratings match", () => {
    expect(rankScore(4.5, 2000, prior)).toBeGreaterThan(
      rankScore(4.5, 10, prior),
    );
  });

  test("pulls a thinly-reviewed business toward the corpus mean", () => {
    // One 5-star review says almost nothing, so the score should sit far below
    // 5 and near the prior.
    const score = rankScore(5.0, 1, prior);
    expect(score).toBeLessThan(4.1);
    expect(score).toBeGreaterThan(3.9);
  });

  test("converges on the real rating once evidence is overwhelming", () => {
    expect(rankScore(4.6, 100_000, prior)).toBeCloseTo(4.6, 1);
  });

  test("scores a business with no reviews at exactly the prior", () => {
    // Nothing is known, so it ranks as an average business rather than a bad one.
    expect(rankScore(undefined, undefined, prior)).toBeCloseTo(4.0, 5);
  });

  test("treats a rating with no review count as unsupported", () => {
    expect(rankScore(5.0, undefined, prior)).toBeCloseTo(4.0, 5);
  });

  test("is stable enough to sort with — never NaN", () => {
    for (const [r, v] of [
      [0, 0],
      [5, 0],
      [undefined, 100],
      [4.4, -1],
    ] as const) {
      expect(Number.isFinite(rankScore(r, v, prior))).toBe(true);
    }
  });
});

describe("corpusPrior", () => {
  test("uses the corpus mean rating as the prior, not a guess", () => {
    const prior = corpusPrior([
      { rating: 4.0, reviews: 10 },
      { rating: 5.0, reviews: 10 },
    ]);
    expect(prior.mean).toBeCloseTo(4.5, 5);
  });

  test("ignores businesses with no rating when averaging", () => {
    const prior = corpusPrior([
      { rating: 4.0, reviews: 10 },
      { reviews: 10 },
      { rating: 5.0, reviews: 10 },
    ]);
    expect(prior.mean).toBeCloseTo(4.5, 5);
  });

  test("derives the weight from the corpus, so it scales with the dataset", () => {
    // A directory where everyone has thousands of reviews needs a higher bar
    // than one where ten is typical.
    const busy = corpusPrior(
      Array.from({ length: 100 }, () => ({ rating: 4.5, reviews: 1000 })),
    );
    const quiet = corpusPrior(
      Array.from({ length: 100 }, () => ({ rating: 4.5, reviews: 5 })),
    );
    expect(busy.weight).toBeGreaterThan(quiet.weight);
  });

  test("falls back to something usable on an empty corpus", () => {
    const prior = corpusPrior([]);
    expect(Number.isFinite(prior.mean)).toBe(true);
    expect(prior.weight).toBeGreaterThan(0);
  });
});

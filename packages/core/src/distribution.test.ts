import { describe, expect, test } from "vitest";
import { RATING_BANDS, ratingDistribution } from "./distribution";

/** A business is only ever read for its rating and review count here. */
const b = (rating?: number, reviews?: number) => ({ rating, reviews });

describe("ratingDistribution — the histogram bins", () => {
  test("covers 1.0 to 5.0 in even 0.1 steps, with no gaps", () => {
    // Bins with a zero count must still be emitted. A histogram that omits its
    // empty buckets silently compresses the axis, which misstates the shape of
    // the distribution — the one thing the chart exists to show.
    const { bins } = ratingDistribution([]);
    expect(bins).toHaveLength(41);
    expect(bins[0]?.rating).toBe(1);
    expect(bins.at(-1)?.rating).toBe(5);
    expect(bins.every((bin) => bin.count === 0)).toBe(true);

    const steps = bins.map((bin) => bin.rating);
    expect(steps.slice(0, 4)).toEqual([1, 1.1, 1.2, 1.3]);
  });

  test("counts a business into the bin for its rating", () => {
    const { bins } = ratingDistribution([b(4.7, 10), b(4.7, 20), b(3.1, 5)]);
    expect(bins.find((bin) => bin.rating === 4.7)?.count).toBe(2);
    expect(bins.find((bin) => bin.rating === 3.1)?.count).toBe(1);
  });

  test("snaps a rating that is not already on a tenth", () => {
    // The engine returns one decimal place, but JSON round-trips and any future
    // averaging can hand us 4.6999999. Binning that as its own value would
    // scatter one bar into several invisible ones.
    const { bins } = ratingDistribution([b(4.6999999, 3), b(4.65, 3)]);
    expect(bins.find((bin) => bin.rating === 4.7)?.count).toBe(2);
  });

  test("ignores a rating outside the 1-5 scale", () => {
    const { bins, rated } = ratingDistribution([b(0, 1), b(5.4, 1), b(-2, 1)]);
    expect(bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(0);
    expect(rated).toBe(0);
  });
});

describe("ratingDistribution — the bands", () => {
  test("keeps an exact 5.0 out of the 4.5-4.9 band", () => {
    // This separation is the entire point of the figure. A perfect score is a
    // different population from a near-perfect one — it is mostly businesses
    // with a handful of reviews — and merging the two hides that.
    const { bands } = ratingDistribution([b(5, 4), b(4.9, 900), b(4.5, 900)]);
    const perfect = bands.find((band) => band.label === "5.0");
    const near = bands.find((band) => band.label === "4.5–4.9");
    expect(perfect?.count).toBe(1);
    expect(near?.count).toBe(2);
  });

  test("reports the median review count of each band, not the mean", () => {
    // A single landmark with 100,000 reviews sits in almost every band and
    // would drag a mean far above anything a reader could recognise.
    const { bands } = ratingDistribution([
      b(4.6, 10),
      b(4.6, 20),
      b(4.6, 100_000),
    ]);
    expect(bands.find((band) => band.label === "4.5–4.9")?.medianReviews).toBe(
      20,
    );
  });

  test("averages the two middle values when a band holds an even count", () => {
    const { bands } = ratingDistribution([b(4.6, 10), b(4.6, 20)]);
    expect(bands.find((band) => band.label === "4.5–4.9")?.medianReviews).toBe(
      15,
    );
  });

  test("treats a missing review count as no reviews", () => {
    const { bands } = ratingDistribution([b(4.6), b(4.6), b(4.6, 30)]);
    expect(bands.find((band) => band.label === "4.5–4.9")?.medianReviews).toBe(
      0,
    );
  });

  test("an empty band reports zero rather than dropping out", () => {
    // The bands are the x-axis of the second panel; one going missing would
    // silently reflow every other bar.
    const { bands } = ratingDistribution([b(4.6, 10)]);
    expect(bands).toHaveLength(RATING_BANDS.length);
    expect(bands.every((band) => typeof band.medianReviews === "number")).toBe(
      true,
    );
  });

  test("puts every rated business in exactly one band", () => {
    const input = [
      b(1, 1),
      b(2.9, 1),
      b(3, 1),
      b(3.4, 1),
      b(3.9, 1),
      b(4, 1),
      b(4.4, 1),
      b(4.5, 1),
      b(4.9, 1),
      b(5, 1),
    ];
    const { bands, rated } = ratingDistribution(input);
    expect(bands.reduce((sum, band) => sum + band.count, 0)).toBe(rated);
    expect(rated).toBe(input.length);
  });
});

describe("ratingDistribution — provenance", () => {
  test("counts the unrated separately so the figure can declare its n", () => {
    // 940 of Dubai's 14,981 businesses carry no rating. A chart that quietly
    // drops them would imply the corpus is smaller than it is.
    const { rated, unrated } = ratingDistribution([
      b(4.5, 2),
      b(),
      b(),
      b(3, 1),
    ]);
    expect(rated).toBe(2);
    expect(unrated).toBe(2);
  });
});

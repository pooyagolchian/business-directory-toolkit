/**
 * The shape of a city's ratings — and what a rating is actually worth.
 *
 * Two measures, deliberately kept apart. Plotting them on one pair of axes
 * would mean two y-scales on one chart, and the alignment between two scales
 * is arbitrary: it invents a correlation the data does not contain. They are
 * returned as two independent series for two panels instead.
 *
 *   `bins`  — how many businesses hold each rating, in 0.1 steps. The fine
 *             step is the point: at half-star buckets the distribution looks
 *             like a smooth climb, and the spike at exactly 5.0 disappears
 *             into the 4.5–4.9 bucket that swallows it.
 *
 *   `bands` — the median review count behind each rating. Coarse bands here,
 *             because a median is only meaningful over enough businesses to
 *             have one; the 0.1 bins in the low tail hold single figures.
 *
 * Measured on the v0.1 Dubai crawl, the two together say something a star
 * average alone cannot: median reviews climb monotonically with rating —
 * 12, 18, 48, 93, 139 — and then collapse to 11 at exactly 5.0, where 47% of
 * businesses have fewer than ten reviews. A perfect score is not the top of
 * the scale, it is the bottom of the evidence. That is the same fact
 * rankScore() in ./rank.ts exists to correct for, so the figure is the
 * evidence for the ranking rather than decoration beside it.
 */

/** Google's scale. Anything outside it is not a rating we can place. */
const MIN_RATING = 1;
const MAX_RATING = 5;
/** One decimal place, which is the precision the engine actually returns. */
const BIN_STEP = 0.1;

export interface RatingBin {
  /** The bin's rating, on a tenth. */
  rating: number;
  count: number;
}

export interface RatingBand {
  label: string;
  /** Inclusive. */
  min: number;
  /** Exclusive, except for the final band, where it equals `min`. */
  max: number;
  count: number;
  /** Median, not mean — see below. Zero for an empty band. */
  medianReviews: number;
}

export interface RatingDistribution {
  bins: RatingBin[];
  bands: RatingBand[];
  /** Businesses carrying a rating on the 1–5 scale. */
  rated: number;
  /** Everything else. Reported so a figure can state its own n honestly. */
  unrated: number;
}

/**
 * The bands of the second panel.
 *
 * 5.0 gets a band to itself rather than closing out a 4.5–5.0 bucket. That is
 * not a rounding convenience — an exact 5.0 means "no review has ever been
 * less than perfect", which is a claim about sample size far more than about
 * quality, and 2,283 Dubai businesses make it. Folding them in with 4.9
 * averages the two populations together and erases the finding.
 *
 * The low tail is one "Below 3.0" band for the opposite reason: 352 businesses
 * spread over four half-star buckets give medians drawn from a few dozen
 * records each, which is noise rendered as though it were signal.
 */
export const RATING_BANDS: ReadonlyArray<{
  label: string;
  min: number;
  max: number;
}> = [
  { label: "Below 3.0", min: 1, max: 3 },
  { label: "3.0–3.4", min: 3, max: 3.5 },
  { label: "3.5–3.9", min: 3.5, max: 4 },
  { label: "4.0–4.4", min: 4, max: 4.5 },
  { label: "4.5–4.9", min: 4.5, max: 5 },
  { label: "5.0", min: 5, max: 5 },
];

/**
 * Which band a rating belongs to, or -1 if it is off the scale.
 *
 * Exported because ./pivot.ts builds the heatmap's rows from the same bands.
 * Two copies of this comparison would drift, and the drift would show up as a
 * heatmap row that does not add up to the band count printed beside it.
 */
export function ratingBandIndex(rating: number): number {
  return RATING_BANDS.findIndex((band) =>
    band.min === band.max
      ? rating === band.min
      : rating >= band.min && rating < band.max,
  );
}

/** Snap to a tenth. See the test: 4.6999999 must bin with 4.7, not beside it. */
function toTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Median of an ascending copy. Even counts average the two middle values.
 *
 * The mean is the wrong summary for review counts and not by a little: one
 * landmark carrying 102,494 reviews sits inside a band of several thousand
 * ordinary businesses and pulls its mean to five times its median.
 */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export function ratingDistribution(
  businesses: Array<{
    rating?: number | undefined;
    reviews?: number | undefined;
  }>,
): RatingDistribution {
  const binCount = Math.round((MAX_RATING - MIN_RATING) / BIN_STEP) + 1;
  // Every bin is materialised up front, including the empty ones. A histogram
  // built only from the values it saw draws an even axis over uneven gaps.
  const bins: RatingBin[] = Array.from({ length: binCount }, (_, i) => ({
    rating: toTenth(MIN_RATING + i * BIN_STEP),
    count: 0,
  }));

  const bandReviews: number[][] = RATING_BANDS.map(() => []);
  let rated = 0;
  let unrated = 0;

  for (const business of businesses) {
    const raw = business.rating;
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      unrated++;
      continue;
    }
    const rating = toTenth(raw);
    if (rating < MIN_RATING || rating > MAX_RATING) {
      unrated++;
      continue;
    }

    rated++;
    const index = Math.round((rating - MIN_RATING) / BIN_STEP);
    const bin = bins[index];
    if (bin) bin.count++;

    // A rating with no review count attached is treated as no reviews rather
    // than skipped: it is still a business showing stars on the page, and
    // dropping it would flatter the band it belongs to.
    const reviews =
      typeof business.reviews === "number" && Number.isFinite(business.reviews)
        ? Math.max(0, business.reviews)
        : 0;

    bandReviews[ratingBandIndex(rating)]?.push(reviews);
  }

  const bands: RatingBand[] = RATING_BANDS.map((band, i) => {
    const reviews = bandReviews[i] ?? [];
    return {
      label: band.label,
      min: band.min,
      max: band.max,
      count: reviews.length,
      medianReviews: median(reviews),
    };
  });

  return { bins, bands, rated, unrated };
}

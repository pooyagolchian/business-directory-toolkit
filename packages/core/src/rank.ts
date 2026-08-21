/**
 * Ranking by rating, without letting three reviews beat three thousand.
 *
 * Sorting a directory by raw star average is wrong in a way that is obvious on
 * real data: a lone 5-star review outranks 2,000 reviews averaging 4.6. The
 * star average is an *estimate*, and an estimate drawn from three samples
 * deserves less confidence than one drawn from three thousand.
 *
 * The correction is a credibility-weighted mean — the same shape IMDb uses for
 * its top-250, and Bayesian in spirit: treat the corpus average as a prior
 * belief, and let each business's own reviews move the score away from it in
 * proportion to how much evidence there is.
 *
 *     score = (v / (v + m)) * R  +  (m / (v + m)) * C
 *
 *     R = this business's rating      v = its review count
 *     C = corpus mean rating          m = how many reviews count as "enough"
 *
 * With v = 0 the score is exactly C: an unrated business ranks as average
 * rather than as bad, which is the honest reading of no information. As v grows
 * the first term dominates and the score converges on R.
 */

export interface RankPrior {
  /** Corpus mean rating — what we assume before seeing a business's reviews. */
  mean: number;
  /** Review count at which a business's own rating carries half the weight. */
  weight: number;
}

/** Sensible fallback when the corpus is empty; 4.0 is mid-scale for a 1–5 range. */
const FALLBACK_PRIOR: RankPrior = { mean: 4.0, weight: 25 };

export function rankScore(
  rating: number | undefined,
  reviews: number | undefined,
  prior: RankPrior,
): number {
  const mean = Number.isFinite(prior.mean) ? prior.mean : FALLBACK_PRIOR.mean;
  const weight =
    Number.isFinite(prior.weight) && prior.weight > 0
      ? prior.weight
      : FALLBACK_PRIOR.weight;

  // A rating with no review count behind it is unsupported, and a negative
  // count is nonsense — both mean "no evidence", which is the prior.
  const evidence = typeof reviews === "number" && reviews > 0 ? reviews : 0;
  if (rating === undefined || !Number.isFinite(rating) || evidence === 0) {
    return mean;
  }

  return (
    (evidence / (evidence + weight)) * rating +
    (weight / (evidence + weight)) * mean
  );
}

/**
 * Derive the prior from the corpus rather than hardcoding it.
 *
 * `weight` is the median review count. That makes the threshold self-scaling:
 * in a directory where everyone has thousands of reviews, ten reviews should
 * barely move a score; in one where ten is typical, ten is real evidence. A
 * fixed constant would be wrong in both directions on a different city.
 */
export function corpusPrior(
  businesses: Array<{ rating?: number; reviews?: number }>,
): RankPrior {
  const ratings: number[] = [];
  const counts: number[] = [];

  for (const b of businesses) {
    if (typeof b.rating === "number" && Number.isFinite(b.rating)) {
      ratings.push(b.rating);
    }
    if (typeof b.reviews === "number" && b.reviews > 0) counts.push(b.reviews);
  }

  if (ratings.length === 0) return FALLBACK_PRIOR;

  const mean = ratings.reduce((sum, r) => sum + r, 0) / ratings.length;

  // Median, not mean: review counts are heavily skewed by a few landmarks with
  // tens of thousands, and a mean would set the bar far above what a typical
  // business could ever clear.
  counts.sort((a, b) => a - b);
  const median = counts.length
    ? (counts[Math.floor((counts.length - 1) / 2)] ?? FALLBACK_PRIOR.weight)
    : FALLBACK_PRIOR.weight;

  return { mean, weight: Math.max(1, median) };
}

import { rankScore, type RankPrior } from "./rank";
import type { Business } from "./types";

/**
 * Lead signal detection.
 *
 * A lead is a business with a gap somebody can sell against. Each signal maps
 * to a real service: no website to web design, weak reputation to reputation
 * management, low visibility to local SEO, no hours to listing management.
 * Scoring those signals into a ranked lead list is later work (Tasks 4–5) —
 * this module only decides which gaps a business has.
 */
export const LEAD_SIGNALS = [
  "no-website",
  "weak-reputation",
  "low-visibility",
  "no-hours",
] as const;

export type LeadSignal = (typeof LEAD_SIGNALS)[number];

/**
 * Below this rating, and only with enough reviews to trust it, is a
 * reputation problem worth raising with the business. Above it, a below-
 * average score is normal variance rather than a sales angle.
 */
const WEAK_RATING = 3.8;

/**
 * A 2.0 average from three reviews is noise, not a reputation problem — one
 * bad visit can produce it. This is the review count at which a low rating
 * starts meaning something. Shared with `weak-reputation` only; `low-
 * visibility` below uses its own, lower bar because it is measuring a
 * different thing (whether anyone has reviewed at all).
 */
const MIN_REVIEWS_FOR_REPUTATION = 20;

/**
 * Fewer reviews than this and the business is essentially undiscovered —
 * invisible rather than disliked. That's a local-SEO gap, not a reputation
 * one, so it is scored separately even though both read off `reviews`.
 */
const LOW_VISIBILITY_REVIEWS = 10;

/**
 * A lead you cannot contact is not a lead.
 *
 * This is a disqualifier, not a fifth signal: no amount of business health —
 * gorgeous rating, thousands of reviews — makes an unreachable prospect worth
 * a place on a call list. Callers should filter on this before ranking, not
 * fold it into the score.
 */
export function isContactable(business: Business): boolean {
  return Boolean(business.phoneE164);
}

/** Which sellable gaps a business has. Independent of whether it's contactable. */
export function detectSignals(business: Business): LeadSignal[] {
  const signals: LeadSignal[] = [];

  if (!business.website) signals.push("no-website");

  if (
    business.rating !== undefined &&
    business.rating < WEAK_RATING &&
    (business.reviews ?? 0) >= MIN_REVIEWS_FOR_REPUTATION
  ) {
    signals.push("weak-reputation");
  }

  if ((business.reviews ?? 0) < LOW_VISIBILITY_REVIEWS) {
    signals.push("low-visibility");
  }

  if (!business.openHours || Object.keys(business.openHours).length === 0) {
    signals.push("no-hours");
  }

  return signals;
}

/**
 * How badly this business has the problem, normalised to 0–1.
 *
 * `no-website` and `no-hours` are binary — a business either has one or it
 * doesn't, so a gap is always full strength. `weak-reputation` and
 * `low-visibility` are continuous: how far below their threshold a business
 * sits. Normalising keeps a signal's own scores comparable to each other;
 * they are never compared ACROSS signals — see `leadScore`.
 */
export function signalStrength(business: Business, signal: LeadSignal): number {
  switch (signal) {
    case "no-website":
    case "no-hours":
      return 1;

    // Distance below the reputation cutoff, scaled against the full range
    // down to the bottom of the scale (1.0), so a 2.0 reads as a near-maximum
    // signal and a 3.7 — just under the cutoff — reads as barely one at all.
    // A missing rating means no reputation problem was ever raised, so it
    // scores as no gap rather than the worst one.
    case "weak-reputation": {
      if (business.rating === undefined || !Number.isFinite(business.rating)) {
        return 0;
      }
      const below = Math.max(0, WEAK_RATING - business.rating);
      return Math.min(1, below / (WEAK_RATING - 1));
    }

    // Distance below the visibility floor, scaled against that same floor —
    // zero reviews is the strongest possible signal, and anything at or
    // above the floor is none at all.
    case "low-visibility": {
      const reviews = Math.max(0, business.reviews ?? 0);
      const below = Math.max(0, LOW_VISIBILITY_REVIEWS - reviews);
      return Math.min(1, below / LOW_VISIBILITY_REVIEWS);
    }
  }
}

/**
 * The best lead is a successful business with a fixable gap.
 *
 * Multiplying signal strength by business health is what separates a
 * 4.8-rated restaurant with 500 reviews and no website from a 3.1-rated one
 * with 20. Both match the filter; only the score says which is worth calling
 * first.
 *
 * `businessHealth` comes from `rankScore` rather than the raw star average,
 * so a lone 5-star review can't float a barely-reviewed prospect to the top
 * of a call list — the same credibility weighting that keeps the directory's
 * own rankings honest applies here too.
 *
 * A score is only ever compared within its own signal: a `no-website` score
 * and a `weak-reputation` score describe different sales conversations, not
 * points on a shared scale.
 */
export function leadScore(
  business: Business,
  signal: LeadSignal,
  prior: RankPrior,
): number {
  const health = rankScore(business.rating, business.reviews, prior);
  return signalStrength(business, signal) * health;
}

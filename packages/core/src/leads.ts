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

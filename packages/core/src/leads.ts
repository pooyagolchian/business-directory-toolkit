import type { RankPrior } from "./rank";
import { dropSuppressed } from "./suppression";
import type { Business } from "./types";

/**
 * Lead detection and scoring.
 *
 * A lead is a business with a gap somebody can sell against. Each signal maps
 * to a real service: no website to web design, weak reputation to reputation
 * management, low visibility to local SEO, no hours to listing management.
 * This module detects which gaps a business has (`detectSignals`), measures
 * how severe each one is (`signalStrength`), combines that with how
 * established the business is into a single rank (`leadScore`), and turns
 * the whole corpus into a filtered, ranked, suppression-aware call list
 * (`findLeads`).
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
      // `?? 0` alone only replaces null/undefined — NaN sails straight
      // through it, so this narrows the same way the non-finite guard above
      // does before doing arithmetic, rather than trusting the nullish
      // check to catch every degenerate input.
      const reviews =
        business.reviews === undefined || !Number.isFinite(business.reviews)
          ? 0
          : Math.max(0, business.reviews);
      const below = Math.max(0, LOW_VISIBILITY_REVIEWS - reviews);
      return Math.min(1, below / LOW_VISIBILITY_REVIEWS);
    }
  }
}

/**
 * How much real trade this business has evidence of, independent of rating.
 *
 * "The best lead is a successful business with a fixable gap" turns on what
 * "successful" means here: not well-rated — for `weak-reputation` the rating
 * IS the gap being sold against — but ESTABLISHED, in the sense of having
 * enough transaction history that the gap is worth fixing. A business with
 * thousands of reviews and no website is a real commercial concern that
 * happens to be invisible online; a business with three reviews and no
 * website might not be trading at all.
 *
 * Shaped like the credibility term inside `rankScore` (`v / (v + m)`), reused
 * here for the same reason: a business needs enough reviews relative to the
 * corpus norm (`m`, the prior's weight) before its volume counts as real
 * evidence rather than noise. Deliberately excludes rating, unlike
 * `rankScore` — folding a credibility-shrunk rating back in here would
 * double-count the very deficiency `weak-reputation` sells against. Measured
 * on the real 641-lead reputation list: the old rankScore-based health gave
 * `corr(score, businessHealth) = -0.328`, topped by bank ATMs with 23–37
 * reviews, while a 3.6-rated hospital with 5,562 reviews — the most valuable
 * reputation-management prospect in the crawl — sat at #522 of 641. A
 * below-prior rating is shrunk UPWARD by rankScore toward the corpus mean,
 * and shrunk LESS the more reviews back it, so rankScore *decreases* with
 * review count for exactly the businesses `weak-reputation` targets;
 * multiplying by it demoted the highest-volume prospects instead of
 * surfacing them.
 *
 * `m` must come from the prior passed in — the corpus median review count —
 * never a hardcoded constant, so "established" self-scales with the corpus
 * (see `corpusPrior`'s own doc comment for why a fixed number is wrong on a
 * different city or crawl size).
 *
 * Guards independently against every way `reviews` and `prior.weight` can be
 * degenerate: an absent, zero, negative, or non-finite `reviews` all read as
 * "no evidence yet" (0) rather than throwing or producing NaN; a zero,
 * absent, or non-finite `prior.weight` falls back to 1 rather than dividing
 * by zero when `reviews` is also 0 — a combination only a malformed prior can
 * produce, since `corpusPrior` itself always returns at least 1
 * (`Math.max(1, median)`). With both inputs non-negative and the denominator
 * strictly positive, the result is always in [0, 1): it can approach but
 * never reach 1, however many reviews a business has.
 */
export function establishment(
  reviews: number | undefined,
  prior: RankPrior,
): number {
  const v =
    typeof reviews === "number" && Number.isFinite(reviews) && reviews > 0
      ? reviews
      : 0;
  const m =
    Number.isFinite(prior.weight) && prior.weight > 0 ? prior.weight : 1;
  return v / (v + m);
}

/**
 * The best lead is a successful business with a fixable gap.
 *
 * Multiplying signal strength by business health is what separates a
 * heavily-reviewed restaurant with no website from a barely-reviewed one
 * with the same gap. Both match the filter; only the score says which is
 * worth calling first.
 *
 * `businessHealth` is `establishment` — see that function's doc comment for
 * why a credibility-shrunk RATING belongs in `signalStrength`, where it
 * describes the SIZE of a gap like `weak-reputation`, not here, where it
 * would double-count and cancel that same gap out.
 *
 * THE GENERAL RULE — of which `weak-reputation` and `low-visibility` are two
 * instances, not a one-off fix: the health term must never be a function of
 * the quantity the signal itself measures. For `weak-reputation` the gap IS
 * the rating, so health must not use rating — that's why `establishment` is
 * built from reviews alone. For `low-visibility` the gap IS the review
 * count, so health must not use review count either — but `establishment`
 * is *defined* from review count, so multiplying it in here would
 * double-count the gap in exactly the way the old rating-based health once
 * did for `weak-reputation`. Measured on the real corpus: `signalStrength ×
 * establishment` for `low-visibility` peaks at reviews = 5 — an arithmetic
 * accident, not a design choice; it's simply where the decreasing signal
 * and the increasing health curves cross — and it buries every zero-review
 * business at the exact bottom of the list, when a zero-review business is
 * the clearest instance of the very gap this signal exists to find. So
 * `low-visibility` is the deliberate exception below: no health multiplier,
 * ranked on gap severity alone. This is the same principle applied
 * consistently, not an oversight.
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
  const strength = signalStrength(business, signal);

  // See the rule above: `low-visibility`'s gap is the review count, the same
  // input `establishment` is built from, so this signal alone skips the
  // health multiplier rather than double-counting its own gap.
  if (signal === "low-visibility") return strength;

  return strength * establishment(business.reviews, prior);
}

export interface Lead {
  business: Business;
  signal: LeadSignal;
  score: number;
  /** Why it scored as it did, so the list can be audited rather than trusted. */
  reason: string;
}

export interface LeadOptions {
  /** Exactly one. Scores are not comparable across signals — see module docs. */
  signal: LeadSignal;
  /**
   * Built once from the whole corpus, never from the filtered subset that
   * `findLeads` returns. A prior recomputed per query would rescale with
   * every filter, so `--category Restaurants` and `--category Salons` would
   * produce scores nobody could compare.
   */
  prior: RankPrior;
  /** place_ids that must never appear — takedown requests. */
  suppressed?: Set<string> | undefined;
  category?: string | undefined;
  area?: string | undefined;
  minReviews?: number | undefined;
  minRating?: number | undefined;
  limit?: number | undefined;
}

export interface LeadResult {
  leads: Lead[];
  /** How many were withheld by the suppression list, so the filter is visible. */
  suppressed: number;
  /** How many were examined after filters, before signal matching. */
  considered: number;
}

/** A one-line explanation of the gap, so a lead reads as a claim rather than a number. */
function reasonFor(business: Business, signal: LeadSignal): string {
  const reviews = business.reviews ?? 0;
  switch (signal) {
    case "no-website": {
      // The "established" claim is only true above the same visibility
      // floor `low-visibility` uses — on the real corpus, 268 of 3,820
      // no-website leads have 0 reviews, and the old unconditional wording
      // made a claim false on its face for every one of them in an
      // auditable, client-facing CSV.
      if (reviews === 0) {
        return "No website listed; no reviews yet, so this may not be an established business at all";
      }
      if (reviews < LOW_VISIBILITY_REVIEWS) {
        return `No website listed; only ${reviews.toLocaleString()} reviews, too few to call this established`;
      }
      return `No website listed; ${reviews.toLocaleString()} reviews suggest an established business`;
    }
    case "weak-reputation":
      return `Rated ${(business.rating ?? 0).toFixed(1)} across ${reviews.toLocaleString()} reviews`;
    case "low-visibility":
      return `Only ${reviews.toLocaleString()} reviews`;
    case "no-hours":
      return `No opening hours listed`;
  }
}

/**
 * The whole corpus in, a ranked call list out.
 *
 * Order of operations is the point of this function, not an implementation
 * detail: suppression runs before anything else, so a business that asked to
 * be removed is gone before it can be scored, filtered on, or counted toward
 * `considered` — it never has a chance to reappear on a cold-outreach list.
 * The withheld count is returned rather than swallowed so the takedown
 * promise is visibly enforced instead of silently trusted.
 */
export function findLeads(
  businesses: Business[],
  options: LeadOptions,
): LeadResult {
  const { kept, removed } = dropSuppressed(
    businesses,
    options.suppressed ?? new Set<string>(),
  );

  const filtered = kept.filter((b) => {
    // Not contactable is a disqualifier, same as in isContactable's own
    // doc comment: no amount of business health earns an unreachable
    // prospect a place on a call list.
    if (!isContactable(b)) return false;
    if (
      options.category &&
      b.l2 !== options.category &&
      b.l3 !== options.category
    )
      return false;
    if (options.area && b.area !== options.area) return false;
    if (
      options.minReviews !== undefined &&
      (b.reviews ?? 0) < options.minReviews
    )
      return false;
    if (options.minRating !== undefined && (b.rating ?? 0) < options.minRating)
      return false;
    return true;
  });

  const leads: Lead[] = filtered
    .filter((b) => detectSignals(b).includes(options.signal))
    .map((business) => ({
      business,
      signal: options.signal,
      score: leadScore(business, options.signal, options.prior),
      reason: reasonFor(business, options.signal),
    }))
    // Score descending, then two tie-breaks so the order is TOTAL —
    // reproducible across runs and machines, not an accident of whatever
    // order the input array (or a particular sort implementation) happened
    // to preserve for equal scores:
    //   1. Rating descending. Among leads that score identically, a
    //      better-rated business is more likely to be genuinely trading and
    //      worth the call. `?? -Infinity`, not `?? 0`, so a business with no
    //      rating at all sorts LAST — an unrated business is not a better
    //      prospect than a well-rated one, and this also loses to a
    //      (hypothetical) 0-rated business, not just positive ratings.
    //   2. `placeId` ascending — the final, always-available discriminator,
    //      so two leads tied on both score and rating still sort the same
    //      way every time rather than by insertion order.
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const ratingA = a.business.rating ?? -Infinity;
      const ratingB = b.business.rating ?? -Infinity;
      if (ratingB !== ratingA) return ratingB - ratingA;
      return a.business.placeId.localeCompare(b.business.placeId);
    });

  return {
    leads: options.limit ? leads.slice(0, options.limit) : leads,
    suppressed: removed,
    considered: filtered.length,
  };
}

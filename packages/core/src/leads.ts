import { rankScore, type RankPrior } from "./rank";
import { dropSuppressed } from "./suppression";
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
    case "no-website":
      return `No website listed; ${reviews.toLocaleString()} reviews suggest an established business`;
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
    .sort((a, b) => b.score - a.score);

  return {
    leads: options.limit ? leads.slice(0, options.limit) : leads,
    suppressed: removed,
    considered: filtered.length,
  };
}

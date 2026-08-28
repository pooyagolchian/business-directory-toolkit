/**
 * Human labels for the payment and service attributes Google returns.
 *
 * WHY THIS IS A SEPARATE FILE FROM ACCESSIBILITY_LABELS
 *
 * facets.ts owns accessibility because those values are FILTERABLE — they are
 * gated by an allow-list, appear as facet chips in /search, and a new value
 * appearing upstream must not silently widen a filter. Payments and services
 * are only ever DISPLAYED. Same shape, different contract, so they live apart
 * rather than being folded into a map whose allow-list means something else.
 *
 * WHY THE ALIASES EXIST
 *
 * Google returns one physical fact under two spellings, because the strings
 * come from different surfaces rather than from one normalised field. Measured
 * in the Dubai v0.1 corpus:
 *
 *     on-site-services 5,416   vs   onsite-services 1,181
 *     takeaway         1,558   vs   takeout           266
 *     cheques            380   vs   checks             89
 *
 * Rendering both spellings shows a reader the same capability twice, and
 * rendering only one silently hides the other's businesses. Folding is the only
 * option that is true. British English wins, matching the rest of the repo, and
 * it is the larger set in every pair above.
 *
 * This is the same reasoning AMENITY_ALIASES in facets.ts applies to
 * "car park" versus "parking lot" — kept separate for the contract reason above,
 * not because the problem is different.
 */

/**
 * Declaration order IS render order.
 *
 * Ordering by the input array would let crawl order decide chip order, so two
 * businesses with identical capabilities would render them differently — noise
 * a reader reads as meaning. Most-common first, which is also roughly
 * most-expected first.
 */
export const PAYMENT_LABELS: Record<string, string> = {
  "credit-cards": "Credit cards",
  "debit-cards": "Debit cards",
  "nfc-mobile-payments": "Mobile payments",
  cheques: "Cheques",
  "payment-plans": "Payment plans",
  "cash-only": "Cash only",
};

export const SERVICE_LABELS: Record<string, string> = {
  "on-site-services": "On-site services",
  delivery: "Delivery",
  "no-contact-delivery": "No-contact delivery",
  "same-day-delivery": "Same-day delivery",
  "dine-in": "Dine-in",
  takeaway: "Takeaway",
  "outdoor-seating": "Outdoor seating",
  "in-store-shopping": "In-store shopping",
  "in-store-pick-up": "In-store pick-up",
  "online-appointments": "Online appointments",
};

/** Two spellings of one fact, folded onto the British spelling. */
const ALIASES: Record<string, string> = {
  checks: "cheques",
  "onsite-services": "on-site-services",
  takeout: "takeaway",
};

/**
 * Resolve slugs to labels, deduplicated, in declaration order.
 *
 * An unlabelled value is DROPPED rather than de-slugified. These render as bare
 * chips with no surrounding context, so a raw slug reads as a rendering bug
 * rather than as information. Accessibility takes the opposite decision on
 * purpose — hiding a reported accessibility feature because we lack a label is
 * the wrong failure for that particular field, and it is shown under a heading
 * that explains what it is.
 *
 * The test asserting a label exists for every value seen in a real crawl is what
 * stops that dropping from being silent.
 */
function resolve(
  slugs: string[] | undefined,
  labels: Record<string, string>,
): string[] {
  if (!slugs || slugs.length === 0) return [];
  const wanted = new Set(slugs.map((slug) => ALIASES[slug] ?? slug));
  return Object.entries(labels)
    .filter(([slug]) => wanted.has(slug))
    .map(([, label]) => label);
}

export function paymentLabels(slugs: string[] | undefined): string[] {
  return resolve(slugs, PAYMENT_LABELS);
}

export function serviceLabels(slugs: string[] | undefined): string[] {
  return resolve(slugs, SERVICE_LABELS);
}

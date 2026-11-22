import {
  ACCESSIBILITY_LABELS,
  canonicalAmenity,
  canonicalWebsite,
  openingHoursSpecification,
  paymentLabels,
  schemaTypeFor,
  serviceLabels,
  type Business,
} from "@directory/core";

/**
 * The LocalBusiness markup for /business/[slug], and the facts it shares with
 * the visible page.
 *
 * Pure on purpose. It lived inline in page.tsx, where the only way to check
 * that a change left the markup alone was to render a page and diff it. Here
 * it takes everything the page used to read from disk — the city, its country,
 * the neighbourhood's display name — as arguments, so business-jsonld.test.ts
 * can pin its exact output from a fixture with no I/O.
 */

/**
 * Fallback label for an accessibility value core has no copy for.
 *
 * ACCESSIBILITY_LABELS covers the seven values measured in the Dubai corpus.
 * Google invents new ones, and a different city will surface values this repo
 * has never seen — so an unknown slug is shown de-slugified rather than
 * dropped. Hiding a reported accessibility feature because we lack a label for
 * it is the wrong failure for this particular field.
 */
function deslugify(slug: string): string {
  const words = slug.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The claims a listing makes that appear BOTH on the page and in its markup.
 *
 * Derived once and handed to both, because marking up a feature a visitor
 * cannot see is the structured-data violation this page otherwise avoids by
 * leaving aggregateRating out. Two derivations would be two chances to drift.
 */
export interface BusinessFacts {
  website: string | undefined;
  accessibility: string[];
  payments: string[];
  services: string[];
}

export function businessFacts(business: Business): BusinessFacts {
  return {
    /**
     * The business's own site, with tracking parameters stripped.
     *
     * 911 of the 10,348 websites in the corpus change when cleaned. 847 of those
     * carry a utm_*, gclid or fbclid — not ours, but whoever set the Google
     * listing up. Publishing them verbatim put someone else's campaign
     * attribution into our structured data and into every outbound click.
     *
     * The two numbers differ because canonicalWebsite strips more than those
     * three parameters; quoting 847 as "the URLs this fixes" would understate it.
     * Both were re-measured against the corpus rather than carried over from the
     * note that first raised this.
     */
    website: canonicalWebsite(business.website),

    /**
     * Accessibility features this listing reports on Google.
     *
     * This section exists because packages/core/src/faq.ts already tells every
     * visitor "Each listing page shows which features it reports" — inside
     * FAQPage structured data, on ~800 URLs. Until this rendered, that was a
     * first-party machine-readable claim pointing at a page that did not show it.
     *
     * The data was never the problem: 10,472 of 14,981 records carry at least one
     * accessibility value, and the only consumer was the /search facet panel —
     * a route that is noindex and Disallowed, so nothing indexable ever saw it.
     * "Which pharmacies have a wheelchair-accessible entrance" is the question
     * faq.ts calls the directory's edge, and this is where it gets answered.
     */
    accessibility: [
      ...new Set((business.accessibility ?? []).map(canonicalAmenity)),
    ].map((slug) => ACCESSIBILITY_LABELS[slug] ?? deslugify(slug)),

    /**
     * Payments and service options, the other two attribute groups the crawl
     * already paid for and the site rendered nowhere. Coverage: 9,740 records
     * carry payments and 8,787 carry services, and until now the only consumer
     * was the /search facet panel — a route that is noindex and robots-Disallowed,
     * so nothing indexable ever showed them. faq.ts calls this data the
     * directory's edge over Google, "buried several taps into a listing page";
     * that claim only became true when these rendered.
     */
    payments: paymentLabels(business.payments),
    services: serviceLabels(business.services),
  };
}

/** What the page resolves from the city config and passes in. */
export interface BusinessPlace {
  /** The deployment origin, no trailing slash (lib/site.ts). */
  siteUrl: string;
  city: string;
  countryCode: string | null;
  /** The neighbourhood's display name, not its slug. */
  areaName: string;
}

/**
 * LocalBusiness JSON-LD, built only from fields we actually hold.
 *
 * aggregateRating is deliberately absent. The rating is Google's, not
 * first-party review data, and marking it up as our own is a structured-data
 * violation that risks a manual action.
 *
 * Key order is part of the contract: the characterisation test compares bytes,
 * so reordering the spreads below is a visible change, not a refactor.
 */
export function businessJsonLd(
  business: Business,
  facts: BusinessFacts,
  place: BusinessPlace,
) {
  const { website, accessibility, payments, services } = facts;
  const canonical = `${place.siteUrl}/business/${business.slug}`;
  const hours = openingHoursSpecification(business.openHours);

  /**
   * l3 first, then l2 — NOT `l3 ?? l2`.
   *
   * The obvious spelling loses subtypes. l3 is the narrower label ("Seafood")
   * and is usually absent from schema.org's vocabulary, while l2 ("Restaurants")
   * maps cleanly — so `l3 ?? l2` hands schemaTypeFor a word it cannot place and
   * takes the generic fallback, never consulting the label that would have
   * worked. Measured over the corpus: that spelling loses a valid subtype on
   * 1,443 of 14,981 records and gains a better one on zero.
   *
   * The sentinel comes from schemaTypeFor(undefined) rather than from a
   * duplicated "LocalBusiness" literal, so core stays the single owner of what
   * "no type we can stand behind" means.
   */
  const generic = schemaTypeFor(undefined);
  const fromL3 = schemaTypeFor(business.l3);
  const schemaType = fromL3 === generic ? schemaTypeFor(business.l2) : fromL3;

  return {
    "@context": "https://schema.org",
    // Subtyped from the taxonomy that already drives the visible subtitle,
    // so the markup says what the page says. Anything with no exact
    // schema.org term stays generic — valid, forfeits no eligibility —
    // because an invented type is a false claim about what a business IS.
    "@type": schemaType,
    // A stable identifier for this business, and a statement of which page
    // describes it. Without them nothing else — the BreadcrumbList beside it,
    // an ItemList on a listing page — can reference this node, so every mention
    // across the site reads as a different, unrelated business.
    "@id": `${canonical}#business`,
    mainEntityOfPage: canonical,
    name: business.title,
    ...(business.address && {
      address: {
        "@type": "PostalAddress",
        streetAddress: business.address,
        // schema.org defines addressLocality as the CITY. It was the
        // neighbourhood ("Palm Jumeirah"), with the city smuggled into
        // addressRegion as a literal. The neighbourhood is a real fact and
        // keeps its own field below, where it is not claiming to be a city.
        addressLocality: place.city,
        // addressRegion is deliberately absent rather than guessed. For Dubai
        // the emirate and the city share a name, so the old literal happened to
        // be true here and would be false almost anywhere else — and nothing in
        // the city config records a region, so there is no honest value to put.
        ...(place.countryCode && { addressCountry: place.countryCode }),
      },
    }),
    // The neighbourhood, stated as what it is: a place this business sits
    // inside. Assigned from coordinates rather than from the query that found
    // it — 52% of provenance assignments were measured wrong (ADR 0011).
    containedInPlace: {
      "@type": "Place",
      name: place.areaName,
    },
    // Google's own record of this business. placeId is required on every
    // record, so this is the one external identifier that always resolves, and
    // it is what lets an entity resolver join our node to theirs instead of
    // treating them as two businesses that happen to share a name.
    sameAs: [
      `https://www.google.com/maps/place/?q=place_id:${business.placeId}`,
    ],
    ...(business.phoneE164 && { telephone: business.phoneE164 }),
    ...(website && { url: website }),
    ...(business.lat !== undefined &&
      business.lng !== undefined && {
        geo: {
          "@type": "GeoCoordinates",
          latitude: business.lat,
          longitude: business.lng,
        },
      }),
    // Spread from the SAME array the visible section renders. Marking up a
    // feature a visitor cannot see is the structured-data violation this file
    // otherwise avoids by leaving aggregateRating out — so the two ship
    // together or neither does.
    ...(accessibility.length > 0 && {
      amenityFeature: accessibility.map((name) => ({
        "@type": "LocationFeatureSpecification",
        name,
        value: true,
      })),
    }),
    // Same rule, same guard as the visible table: 89.6% of records carry
    // hours and none of them reached the markup. The parser SKIPS any day it
    // cannot resolve rather than guessing, because a wrong opening time sends
    // somebody to a closed shop — a worse outcome than saying nothing.
    ...(hours.length > 0 && { openingHoursSpecification: hours }),
    // paymentAccepted is a plain schema.org string field, so the labels go in
    // comma-separated. Emitted only alongside the visible list, like every
    // other claim on this node.
    ...(payments.length > 0 && { paymentAccepted: payments.join(", ") }),
    ...(services.length > 0 && {
      // Services are not payment methods, so they get schema.org's Offer of a
      // Service rather than being forced into a field that means something
      // else.
      makesOffer: services.map((name) => ({
        "@type": "Offer",
        itemOffered: { "@type": "Service", name },
      })),
    }),
  };
}

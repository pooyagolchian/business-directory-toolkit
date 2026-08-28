import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ACCESSIBILITY_LABELS,
  businessDescription,
  canonicalAmenity,
  serializeJsonLd,
} from "@directory/core";
import { BusinessList } from "@/components/business-card";
import { byRank } from "@/lib/rows";
import { Breadcrumbs, Page } from "@/components/chrome";
import {
  allBusinesses,
  areaLabel,
  byAreaCategory,
  cityName,
  getBySlug,
  slugify,
} from "@/lib/data";

const DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

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
 * Prerender only the most-reviewed listings at build time.
 *
 * Building all ~10,000 pages would make deploys unmanageable. The long tail
 * renders on first request and is then cached at the edge — which is what keeps
 * the site feeling local despite a us-east-1 origin (ADR 0003).
 */
export async function generateStaticParams() {
  return allBusinesses()
    .slice(0, 500)
    .map((b) => ({ slug: b.slug }));
}

export const dynamicParams = true;
export const revalidate = 86_400;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const business = getBySlug(slug);
  if (!business) return { title: "Not found" };

  const where = areaLabel(business.area);
  const what = business.l3 ?? business.l2;
  return {
    title: `${business.title} — ${what ?? "Business"} in ${where}`,
    // Built in core so the length cap and the plural-agreement fix are tested.
    // The old frame here read "Atlantis - The Palm is a hotels in Palm
    // Jumeirah" on 9,102 of these 14,981 pages.
    description: businessDescription({
      title: business.title,
      what,
      area: where,
      city: cityName(),
      phoneRaw: business.phoneRaw,
      address: business.address,
    }),
    alternates: { canonical: `/business/${business.slug}` },
  };
}

export default async function BusinessPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const business = getBySlug(slug);
  if (!business) notFound();

  const categorySlug = business.l2 ? slugify(business.l2) : null;
  /**
   * Recommendations: the same category, the same neighbourhood, ranked.
   *
   * Ordered by rankScore rather than by whatever order the data happened to be
   * in — a recommendation list that leads with a 5.0 from three reviews is
   * worse than none. SearchApi's google_maps_place returns a
   * `people_also_search_for` block that would fill this from Google's own
   * co-visitation data; that is a 1-credit-per-business upgrade to the same
   * slot, not a rewrite.
   */
  const nearby = categorySlug
    ? byRank(
        byAreaCategory(business.area, categorySlug).filter(
          (b) => b.placeId !== business.placeId,
        ),
      ).slice(0, 6)
    : [];

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
  const accessibility = [
    ...new Set((business.accessibility ?? []).map(canonicalAmenity)),
  ].map((slug) => ACCESSIBILITY_LABELS[slug] ?? deslugify(slug));

  /**
   * LocalBusiness JSON-LD, built only from fields we actually hold.
   *
   * aggregateRating is deliberately absent. The rating is Google's, not
   * first-party review data, and marking it up as our own is a structured-data
   * violation that risks a manual action.
   */
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: business.title,
    ...(business.address && {
      address: {
        "@type": "PostalAddress",
        streetAddress: business.address,
        addressLocality: areaLabel(business.area),
        addressRegion: "Dubai",
        addressCountry: "AE",
      },
    }),
    ...(business.phoneE164 && { telephone: business.phoneE164 }),
    ...(business.website && { url: business.website }),
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
  };

  return (
    <Page>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />

      <Breadcrumbs
        trail={[
          { href: "/", label: "Home" },
          { href: `/area/${business.area}`, label: areaLabel(business.area) },
          ...(categorySlug && business.l2
            ? [
                {
                  href: `/area/${business.area}/${categorySlug}`,
                  label: business.l2,
                },
              ]
            : []),
          { label: business.title },
        ]}
      />

      <article>
        <h1
          dir="auto"
          className="font-[family-name:var(--font-display)] text-3xl sm:text-5xl"
        >
          {business.title}
        </h1>

        <p className="mt-3 label text-[var(--muted)]">
          {[business.l3, business.l2, areaLabel(business.area)]
            .filter(Boolean)
            .join(" · ")}
        </p>

        <dl className="mt-10 grid gap-px bg-[var(--rule)] sm:grid-cols-2">
          {business.phoneRaw && (
            <div className="bg-[var(--bg)] p-6">
              <dt className="label text-[var(--muted)]">Phone</dt>
              <dd className="tabular mt-2 text-xl">
                <a
                  href={`tel:${business.phoneE164}`}
                  className="underline underline-offset-4"
                >
                  {business.phoneRaw}
                </a>
              </dd>
              {business.phoneE164 && (
                <dd className="tabular mt-2 text-sm text-[var(--muted)]">
                  {business.phoneE164}
                  {business.phoneType && ` · ${business.phoneType}`}
                </dd>
              )}
            </div>
          )}

          {business.rating !== undefined && (
            <div className="bg-[var(--bg)] p-6">
              <dt className="label text-[var(--muted)]">Rating</dt>
              <dd className="tabular mt-2 text-xl">
                {business.rating.toFixed(1)}
                {business.reviews !== undefined && (
                  <span className="text-base text-[var(--muted)]">
                    {" "}
                    from {business.reviews.toLocaleString()} reviews
                  </span>
                )}
              </dd>
              <dd className="mt-2 text-sm text-[var(--muted)]">
                Rating from Google, not collected here.
              </dd>
            </div>
          )}

          {business.address && (
            <div className="bg-[var(--bg)] p-6">
              <dt className="label text-[var(--muted)]">Address</dt>
              <dd dir="auto" className="mt-2">
                {business.address}
              </dd>
              {business.lat !== undefined && business.lng !== undefined && (
                <dd className="mt-2">
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${business.lat},${business.lng}`}
                    className="text-sm underline underline-offset-4"
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    Open in Maps
                  </a>
                </dd>
              )}
            </div>
          )}

          {business.website && (
            <div className="bg-[var(--bg)] p-6">
              <dt className="label text-[var(--muted)]">Website</dt>
              <dd className="mt-2 truncate">
                <a
                  href={business.website}
                  className="underline underline-offset-4"
                  rel="nofollow noopener noreferrer"
                  target="_blank"
                >
                  {business.domain ?? business.website}
                </a>
              </dd>
            </div>
          )}
        </dl>

        {business.openHours && (
          <section className="mt-12">
            <h2 className="font-[family-name:var(--font-display)] text-2xl">
              Opening hours
            </h2>
            <table className="mt-5 w-full max-w-md">
              <tbody>
                {DAYS.filter((d) => business.openHours?.[d]).map((day) => (
                  <tr key={day} className="border-t border-[var(--rule)]">
                    <th
                      scope="row"
                      className="py-2.5 text-left font-normal capitalize text-[var(--muted)]"
                    >
                      {day}
                    </th>
                    <td className="tabular py-2.5 text-right">
                      {business.openHours?.[day]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {accessibility.length > 0 && (
          <section className="mt-12">
            <h2 className="font-[family-name:var(--font-display)] text-2xl">
              Accessibility
            </h2>
            <p className="mt-3 max-w-xl text-[var(--muted)]">
              Reported on Google by this business. Absence of a feature here
              means it was not reported, not that it is missing — confirm before
              travelling.
            </p>
            <ul className="mt-4 flex flex-wrap gap-2">
              {accessibility.map((label) => (
                <li
                  key={label}
                  className="border border-[var(--rule)] px-3 py-1.5 label text-[var(--muted)]"
                >
                  {label}
                </li>
              ))}
            </ul>
          </section>
        )}

        {business.types.length > 0 && (
          <section className="mt-12">
            <h2 className="font-[family-name:var(--font-display)] text-2xl">
              Categories on Google
            </h2>
            <p className="mt-3 max-w-xl text-[var(--muted)]">
              Google returns these unranked and alphabetised. The taxonomy above
              is derived from them.
            </p>
            <ul className="mt-4 flex flex-wrap gap-2">
              {business.types.map((type) => (
                <li
                  key={type}
                  className="border border-[var(--rule)] px-3 py-1.5 label text-[var(--muted)]"
                >
                  {type}
                </li>
              ))}
            </ul>
          </section>
        )}

        {nearby.length > 0 && business.l2 && (
          <section className="mt-16">
            <h2 className="font-[family-name:var(--font-display)] text-2xl">
              Other {business.l2.toLowerCase()} in {areaLabel(business.area)}
            </h2>
            <BusinessList businesses={nearby} />
            <Link
              href={`/area/${business.area}/${categorySlug}`}
              className="mt-4 inline-block label text-[var(--muted)] hover:text-[var(--fg)]"
            >
              See all →
            </Link>
          </section>
        )}
      </article>
    </Page>
  );
}

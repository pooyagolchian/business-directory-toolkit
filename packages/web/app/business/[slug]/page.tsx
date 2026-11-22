import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import {
  businessDescription,
  isolateArabicRuns,
  serializeJsonLd,
} from "@directory/core";
import { Bilingual } from "@/components/bilingual";
import { SITE_URL } from "@/lib/site";
import { businessFacts, businessJsonLd } from "@/lib/business-jsonld";
import { BusinessList } from "@/components/business-card";
import { TagList } from "@/components/tag-list";
import { byRank } from "@/lib/rows";
import { Breadcrumbs, Page } from "@/components/chrome";
import {
  allBusinesses,
  areaLabel,
  byAreaCategory,
  cityName,
  countryCode,
  resolveBusinessSlug,
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
 * One cell of the contact card. Renders "Not listed" when it has nothing to say.
 *
 * All four cells always render. A listing with no phone or website used to
 * collapse to two cells, which read as a broken layout rather than as missing
 * data — and said nothing about whether the page or the listing was at fault.
 * "Not listed" states the fact: Google's record for this business has no value.
 */
function Fact({
  label,
  children,
}: {
  label: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="bg-[var(--bg)] p-6">
      <dt className="label text-[var(--muted)]">{label}</dt>
      {children ?? <dd className="mt-2 text-[var(--muted)]">Not listed</dd>}
    </div>
  );
}

/**
 * An address, laid out left-to-right with each Arabic run isolated.
 *
 * NOT `dir="auto"`, which is right for titles and wrong here. 79 addresses in
 * the Dubai corpus open with an Arabic word — Aster Hospital's is
 * "الرفاعة Kuwait Street ,Al Raffa - … - Mankhool - Dubai" — so auto resolved
 * the whole line right-to-left: it right-aligned, and the Latin segments that
 * make up most of it came out in reverse order. An address on an English page
 * is read in the page's direction; the Arabic part is a phrase inside it.
 *
 * Each Arabic run goes in a `<bdi>`, which keeps its letters in their own order
 * and places it as one unit, and carries `lang="ar"` for the same screen-reader
 * reason Bilingual exists. isolateArabicRuns keeps the separators at a run's
 * edges outside the isolate — inside it, "الكرامة - " would draw its dash on
 * the wrong side.
 */
function Address({ text }: { text: string }) {
  return (
    <dd dir="ltr" className="mt-2">
      {isolateArabicRuns(text).map((run, i) =>
        run.lang ? (
          // Derived from one string and never reordered, as in Bilingual.
          <bdi key={i} lang={run.lang}>
            {run.text}
          </bdi>
        ) : (
          run.text
        ),
      )}
    </dd>
  );
}

/**
 * The business for a slug, or a permanent redirect if Google renamed it.
 *
 * Called from BOTH generateMetadata and the page. Metadata can resolve before
 * the body streams, and a redirect thrown once streaming has started degrades
 * to a client-side meta refresh — which search engines do not treat as a 308.
 * Redirecting from the first of the two to run keeps it a real HTTP redirect.
 */
function businessOrRedirect(slug: string) {
  const resolved = resolveBusinessSlug(slug);
  if (!resolved) return undefined;
  if (!resolved.canonical) {
    permanentRedirect(`/business/${resolved.business.slug}`);
  }
  return resolved.business;
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
  const business = businessOrRedirect(slug);
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
  const business = businessOrRedirect(slug);
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

  // Derived once, rendered below AND marked up — see BusinessFacts.
  const facts = businessFacts(business);
  const { website, accessibility, payments, services } = facts;
  const jsonLd = businessJsonLd(business, facts, {
    siteUrl: SITE_URL,
    city: cityName(),
    countryCode: countryCode(),
    areaName: areaLabel(business.area),
  });

  const hasHours = DAYS.some((d) => business.openHours?.[d]);
  const hasFacts =
    accessibility.length > 0 ||
    payments.length > 0 ||
    services.length > 0 ||
    business.types.length > 0;

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
          <Bilingual text={business.title} />
        </h1>

        <p className="mt-3 label text-[var(--muted)]">
          {[business.l3, business.l2, areaLabel(business.area)]
            .filter(Boolean)
            .join(" · ")}
        </p>

        {/*
          -mx-6 cancels the cells' p-6, so a cell's text starts on the same
          edge as the h1 above and the h2s below while the hairline rules run
          past it to the gutter. With the padding left in place, every fact sat
          24px inside the column — a second left edge for no reason, in a
          design where alignment is most of the hierarchy. At 320px the gutter
          is exactly 24px, so the rules reach the viewport edge and no further.
        */}
        <dl className="-mx-6 mt-10 grid gap-px bg-[var(--rule)] sm:grid-cols-2">
          <Fact label="Phone">
            {business.phoneRaw ? (
              <>
                <dd className="tabular mt-2 text-xl">
                  {/* No E.164 means libphonenumber could not place the number,
                      and `tel:undefined` dials nothing. Show it unlinked. */}
                  {business.phoneE164 ? (
                    <a
                      href={`tel:${business.phoneE164}`}
                      className="underline underline-offset-4"
                    >
                      {business.phoneRaw}
                    </a>
                  ) : (
                    business.phoneRaw
                  )}
                </dd>
                {business.phoneE164 && (
                  <dd className="tabular mt-2 text-sm text-[var(--muted)]">
                    {business.phoneE164}
                    {business.phoneType && ` · ${business.phoneType}`}
                  </dd>
                )}
              </>
            ) : undefined}
          </Fact>

          <Fact label="Rating">
            {business.rating !== undefined ? (
              <>
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
              </>
            ) : undefined}
          </Fact>

          <Fact label="Address">
            {business.address ? (
              <>
                <Address text={business.address} />
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
              </>
            ) : undefined}
          </Fact>

          <Fact label="Website">
            {website ? (
              <dd className="mt-2 truncate">
                <a
                  href={website}
                  className="underline underline-offset-4"
                  rel="nofollow noopener noreferrer"
                  target="_blank"
                >
                  {business.domain ?? business.website}
                </a>
              </dd>
            ) : undefined}
          </Fact>
        </dl>

        {/*
          One rhythm for every section: 48px above a section, 16px from its
          heading to what it heads, 12px between a section's caveat and its
          list. More space above a heading than below is what binds the heading
          to its own content rather than to the section before it.

          From lg the hours sit beside the other facts instead of above them.
          Stacked, a seven-row table of short times left the right half of a
          976px column empty and pushed everything else a screen further down.

          Equal columns, not a narrower hours column, because of the card
          above: its right-hand cells start at the column's midpoint, and with
          gap-12 the second column here starts there too (to within half a
          pixel). A 28rem hours column put the facts 17px left of the RATING
          and WEBSITE labels — two edges a few hundred pixels apart, which in
          this design reads as a mistake. The table keeps its max-w-md, so the
          times stay close to their days.

          The two-column template applies only when both sides have something
          in them, so a listing with no hours does not leave an empty column.
        */}
        {(hasHours || hasFacts) && (
          <div
            className={`mt-12 grid gap-12 ${hasHours && hasFacts ? "lg:grid-cols-2" : ""}`}
          >
            {hasHours && (
              <section>
                <h2 className="font-[family-name:var(--font-display)] text-2xl">
                  Opening hours
                </h2>
                <table className="mt-4 w-full max-w-md">
                  <tbody>
                    {DAYS.filter((d) => business.openHours?.[d]).map((day) => (
                      <tr key={day} className="border-t border-[var(--rule)]">
                        <th
                          scope="row"
                          className="py-2.5 text-start font-normal capitalize text-[var(--muted)]"
                        >
                          {day}
                        </th>
                        <td className="tabular py-2.5 text-end">
                          {business.openHours?.[day]}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {hasFacts && (
              <div className="grid content-start gap-12">
                {accessibility.length > 0 && (
                  <section>
                    <h2 className="font-[family-name:var(--font-display)] text-2xl">
                      Accessibility
                    </h2>
                    <p className="mt-4 max-w-xl text-[var(--muted)]">
                      Reported on Google by this business. Absence of a feature
                      here means it was not reported, not that it is missing —
                      confirm before travelling.
                    </p>
                    <TagList items={accessibility} className="mt-3" />
                  </section>
                )}

                {(payments.length > 0 || services.length > 0) && (
                  <section>
                    <h2 className="font-[family-name:var(--font-display)] text-2xl">
                      Payments and services
                    </h2>
                    {/* Self-contained on purpose: this used to open "As with
                        accessibility", on pages that have no accessibility
                        section for it to refer to. */}
                    <p className="mt-4 max-w-xl text-[var(--muted)]">
                      Reported on Google by this business. An option missing
                      from this list was not reported, which is not the same as
                      refused.
                    </p>
                    <TagList
                      items={[...payments, ...services]}
                      className="mt-3"
                    />
                  </section>
                )}

                {business.types.length > 0 && (
                  <section>
                    <h2 className="font-[family-name:var(--font-display)] text-2xl">
                      Categories on Google
                    </h2>
                    <p className="mt-4 max-w-xl text-[var(--muted)]">
                      Google returns these unranked and alphabetised. The
                      taxonomy above is derived from them.
                    </p>
                    <TagList items={business.types} className="mt-3" />
                  </section>
                )}
              </div>
            )}
          </div>
        )}

        {nearby.length > 0 && business.l2 && (
          <section className="mt-12">
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

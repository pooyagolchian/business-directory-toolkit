import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FilterableBusinessList } from "@/components/filterable";
import { byRank, toRow } from "@/lib/rows";
import { Breadcrumbs, Page } from "@/components/chrome";
import { Faq } from "@/components/faq";
import { buildFaq, itemListJsonLd, serializeJsonLd } from "@directory/core";
import { SITE_URL } from "@/lib/site";
import {
  areaLabel,
  areas,
  byAreaCategory,
  categories,
  categoriesInArea,
  cityName,
  MIN_FOR_INDEX,
} from "@/lib/data";
import { demandedPages, popularQueries } from "@/lib/demand";

/**
 * These are the money pages — "Italian restaurants in Marina" is the query
 * shape people actually search. There are ~2,000 possible combinations, so
 * only the substantial ones are prerendered; the rest render on demand and
 * cache at the edge.
 */
export async function generateStaticParams() {
  const seen = new Set<string>();
  const params: Array<{ area: string; l2: string }> = [];

  const add = (area: string, l2: string) => {
    const key = `${area}/${l2}`;
    if (seen.has(key)) return;
    if (byAreaCategory(area, l2).length < MIN_FOR_INDEX) return;
    seen.add(key);
    params.push({ area, l2 });
  };

  // DEMAND FIRST. These combinations came back from Google's own autocomplete,
  // ordered by real query popularity, so they are the pages people actually
  // look for. Prerendering by supply would have put 1,164 restaurants ahead of
  // a nursery query that people type far more often.
  for (const page of demandedPages()) add(page.area, page.l2Slug);

  // Then fill with supply, so a combination nobody has searched yet still
  // exists — it just does not get the build-time slot.
  for (const area of areas()) {
    for (const category of categoriesInArea(area.slug)) {
      add(area.slug, category.slug);
    }
  }

  return params.slice(0, 1000);
}

export const dynamicParams = true;
export const revalidate = 86_400;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ area: string; l2: string }>;
}): Promise<Metadata> {
  const { area, l2 } = await params;
  const facet = categories().find((c) => c.slug === l2);
  if (!facet) return { title: "Not found" };

  const count = byAreaCategory(area, l2).length;
  const where = areaLabel(area);

  return {
    title: `${facet.label} in ${where}, ${cityName()}`,
    // "with phone numbers and ratings", not "and opening hours". A list row
    // renders title, category, area, phone, rating and review count — hours
    // exist only on the individual listing page, so the old copy promised a
    // column that has never been there.
    description: `${count} ${facet.label.toLowerCase()} in ${where}, ${cityName()}, with phone numbers and ratings.`,
    alternates: { canonical: `/area/${area}/${l2}` },
    // A page with almost nothing on it stays reachable but out of the index.
    // This is the single most important guard on a programmatic site.
    ...(count < MIN_FOR_INDEX && {
      robots: { index: false, follow: true },
    }),
  };
}

export default async function AreaCategoryPage({
  params,
}: {
  params: Promise<{ area: string; l2: string }>;
}) {
  const { area, l2 } = await params;
  const facet = categories().find((c) => c.slug === l2);
  const areaFacet = areas().find((a) => a.slug === area);
  if (!facet || !areaFacet) notFound();

  const businesses = byAreaCategory(area, l2);
  if (businesses.length === 0) notFound();

  const withPhone = businesses.filter((b) => b.phoneE164).length;
  const rated = businesses.filter((b) => b.rating !== undefined);
  const avgRating =
    rated.length > 0
      ? rated.reduce((sum, b) => sum + (b.rating ?? 0), 0) / rated.length
      : null;

  // Sibling neighbourhoods that also have this category — internal linking is
  // the whole game at this scale, since an orphan page never gets crawled.
  const alsoIn = areas()
    .filter(
      (a) =>
        a.slug !== area && byAreaCategory(a.slug, l2).length >= MIN_FOR_INDEX,
    )
    .slice(0, 8);

  const queries = popularQueries(facet.label, 8);
  const faq = buildFaq({
    city: cityName(),
    category: facet.label,
    area: areaLabel(area),
    businesses,
  });

  const otherHere = categoriesInArea(area)
    .filter((c) => c.slug !== l2)
    .slice(0, 8);

  // The rows the visitor actually sees, resolved ONCE and handed to both the
  // list and its markup. On this route there is no slice, so the ItemList is
  // every matching business — but it is still built from `rows` rather than
  // from `businesses.length`, because the two agreeing here is a property of
  // this page and not a rule the next one will keep.
  const rows = byRank(businesses).map(toRow);
  const itemList = itemListJsonLd(
    rows.map((r) => ({ name: r.title, url: r.href })),
    SITE_URL,
    { name: `${facet.label} in ${areaLabel(area)}` },
  );

  return (
    <Page>
      {itemList && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(itemList) }}
        />
      )}

      <Breadcrumbs
        trail={[
          { href: "/", label: "Home" },
          { href: "/areas", label: "Areas" },
          { href: `/area/${area}`, label: areaLabel(area) },
          { label: facet.label },
        ]}
      />

      <h1 className="font-[family-name:var(--font-display)] text-3xl sm:text-4xl">
        {facet.label} in {areaLabel(area)}
      </h1>

      {/*
        Every page needs something derived from its own data, or the template
        reads as duplicated across thousands of URLs with only a noun swapped.
      */}
      <p className="mt-4 max-w-2xl text-[var(--muted)]">
        <span className="tabular">{businesses.length}</span>{" "}
        {facet.label.toLowerCase()} in {areaLabel(area)}, {cityName()}.{" "}
        <span className="tabular">{withPhone}</span> list a phone number
        {avgRating !== null && (
          <>
            , and the average Google rating across{" "}
            <span className="tabular">{rated.length}</span> rated listings is{" "}
            <span className="tabular">{avgRating.toFixed(1)}</span>
          </>
        )}
        .
      </p>

      <div className="mt-8">
        <FilterableBusinessList
          rows={rows}
          noun="shown"
          placeholder={`Filter ${facet.label.toLowerCase()} in ${areaLabel(area)}`}
          searchAllHref={`/search?q=${encodeURIComponent(facet.label)}`}
        />
      </div>

      {queries.length > 0 && (
        <section className="mt-14">
          <h2 className="label text-[var(--muted)]">What people search for</h2>
          {/*
            Straight from Google autocomplete, in popularity order. It tells a
            visitor what is worth asking, and it is content no other directory
            page has, because it is measured rather than generated.
          */}
          <ul className="mt-3 flex flex-wrap gap-2">
            {queries.map((q) => (
              <li
                key={q}
                className="border border-[var(--rule)] px-3 py-1.5 text-sm text-[var(--muted)]"
              >
                {q}
              </li>
            ))}
          </ul>
        </section>
      )}

      {alsoIn.length > 0 && (
        <section className="mt-16">
          <h2 className="label text-[var(--muted)]">
            {facet.label} elsewhere in {cityName()}
          </h2>
          <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2.5">
            {alsoIn.map((a) => (
              <li key={a.slug}>
                <Link
                  href={`/area/${a.slug}/${l2}`}
                  className="underline underline-offset-4 hover:opacity-60"
                >
                  {a.label}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {otherHere.length > 0 && (
        <section className="mt-10">
          <h2 className="label text-[var(--muted)]">
            Other categories in {areaLabel(area)}
          </h2>
          <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2.5">
            {otherHere.map((c) => (
              <li key={c.slug}>
                <Link
                  href={`/area/${area}/${c.slug}`}
                  className="underline underline-offset-4 hover:opacity-60"
                >
                  {c.label}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Faq entries={faq} />
    </Page>
  );
}

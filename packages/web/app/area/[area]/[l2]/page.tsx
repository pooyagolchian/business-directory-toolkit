import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FilterableBusinessList } from "@/components/filterable";
import { toRow } from "@/lib/rows";
import { Breadcrumbs, Page } from "@/components/chrome";
import {
  areaLabel,
  areas,
  byAreaCategory,
  categories,
  categoriesInArea,
} from "@/lib/data";

/**
 * Below this, a page has nothing to say and should not be in the index.
 * Thousands of one-result pages drag down a whole domain, not just themselves.
 */
const MIN_FOR_INDEX = 3;

/**
 * These are the money pages — "Italian restaurants in Marina" is the query
 * shape people actually search. There are ~2,000 possible combinations, so
 * only the substantial ones are prerendered; the rest render on demand and
 * cache at the edge.
 */
export async function generateStaticParams() {
  const params: Array<{ area: string; l2: string }> = [];
  for (const area of areas()) {
    for (const category of categoriesInArea(area.slug)) {
      if (category.count < MIN_FOR_INDEX) continue;
      params.push({ area: area.slug, l2: category.slug });
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
    title: `${facet.label} in ${where}, Dubai`,
    description: `${count} ${facet.label.toLowerCase()} in ${where}, Dubai, with phone numbers and opening hours.`,
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

  const otherHere = categoriesInArea(area)
    .filter((c) => c.slug !== l2)
    .slice(0, 8);

  return (
    <Page>
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
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
        <span className="tabular">{businesses.length}</span>{" "}
        {facet.label.toLowerCase()} in {areaLabel(area)}, Dubai.{" "}
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
          rows={businesses.map(toRow)}
          noun="shown"
          placeholder={`Filter ${facet.label.toLowerCase()} in ${areaLabel(area)}`}
          searchAllHref={`/search?q=${encodeURIComponent(facet.label)}`}
        />
      </div>

      {alsoIn.length > 0 && (
        <section className="mt-16">
          <h2 className="font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]">
            {facet.label} elsewhere in Dubai
          </h2>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm">
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
          <h2 className="font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]">
            Other categories in {areaLabel(area)}
          </h2>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm">
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
    </Page>
  );
}

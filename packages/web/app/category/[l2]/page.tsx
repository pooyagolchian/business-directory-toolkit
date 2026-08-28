import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FilterableBusinessList } from "@/components/filterable";
import { byRank, toRow } from "@/lib/rows";
import { Breadcrumbs, FacetGrid, Page } from "@/components/chrome";
import { Faq } from "@/components/faq";
import { buildFaq, itemListJsonLd, serializeJsonLd } from "@directory/core";
import { SITE_URL } from "@/lib/site";
import {
  areasInCategory,
  byCategory,
  categories,
  cityName,
  MIN_FOR_INDEX,
} from "@/lib/data";

export async function generateStaticParams() {
  return categories().map((c) => ({ l2: c.slug }));
}

/**
 * How many rows to hand the client filter.
 *
 * The filter narrows what is on the page, so the page has to hold enough to be
 * worth narrowing — but shipping 1,164 restaurants as JSON to filter in the
 * browser is a payload, not a feature. Beyond this, the real search is offered.
 */
const PAGE_SIZE = 120;

export const dynamicParams = true;
export const revalidate = 86_400;

/** "Restaurants" -> "Restaurant". Only ever used for the n=1 sentence. */
function singular(label: string): string {
  return label.replace(/ies$/, "y").replace(/s$/, "");
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ l2: string }>;
}): Promise<Metadata> {
  const { l2 } = await params;
  const facet = categories().find((c) => c.slug === l2);
  if (!facet) return { title: "Not found" };
  return {
    title: `${facet.label} in Dubai`,
    // Pluralised and formatted, because at n=1 this read "1 catering in Dubai".
    description:
      facet.count === 1
        ? `The one ${singular(facet.label).toLowerCase()} listed in ${cityName()}.`
        : `${facet.count.toLocaleString()} ${facet.label.toLowerCase()} in ${cityName()}, by neighbourhood.`,
    alternates: { canonical: `/category/${l2}` },
    // Same guard the money pages have carried all along. Nine categories have
    // fewer than three listings; they stay reachable and out of the index.
    ...(facet.count < MIN_FOR_INDEX && {
      robots: { index: false, follow: true },
    }),
  };
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ l2: string }>;
}) {
  const { l2 } = await params;
  const facet = categories().find((c) => c.slug === l2);
  if (!facet) notFound();

  const businesses = byCategory(l2);
  const areaFacets = areasInCategory(l2);
  const faq = buildFaq({ category: facet.label, businesses });

  // AFTER the slice, deliberately. This page knows two numbers about itself —
  // facet.count, which can be 1,164, and PAGE_SIZE, which is 120 — and only the
  // second is true of the document a crawler fetches. Marking up the larger one
  // would be the same class of false claim as publishing Google's ratings as
  // first-party review data, which this codebase already refuses to do.
  const rows = byRank(businesses).slice(0, PAGE_SIZE).map(toRow);
  const itemList = itemListJsonLd(
    rows.map((r) => ({ name: r.title, url: r.href })),
    SITE_URL,
    { name: `${facet.label} in ${cityName()}` },
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
          { href: "/categories", label: "Categories" },
          { label: facet.label },
        ]}
      />

      <h1 className="font-[family-name:var(--font-display)] text-3xl sm:text-4xl">
        {facet.label} in Dubai
      </h1>
      <p className="mt-3 text-[var(--muted)]">
        <span className="tabular">{facet.count.toLocaleString()}</span> listings
        across <span className="tabular">{areaFacets.length}</span>{" "}
        {areaFacets.length === 1 ? "neighbourhood" : "neighbourhoods"}.
      </p>

      {areaFacets.length > 1 && (
        <section className="mt-10">
          <h2 className="label text-[var(--muted)]">By neighbourhood</h2>
          <div className="mt-3">
            <FacetGrid
              items={areaFacets}
              hrefFor={(slug) => `/area/${slug}/${l2}`}
            />
          </div>
        </section>
      )}

      <section className="mt-12">
        <h2 className="font-[family-name:var(--font-display)] text-2xl">
          Most reviewed
        </h2>
        <p className="mt-2 mb-5 text-sm text-[var(--muted)]">
          Showing the {Math.min(businesses.length, PAGE_SIZE)} most reviewed of{" "}
          {facet.count.toLocaleString()}. Narrow by neighbourhood above, or
          filter this list.
        </p>
        <FilterableBusinessList
          rows={rows}
          noun="shown"
          placeholder={`Filter ${facet.label.toLowerCase()} by name, area, or phone`}
          searchAllHref={`/search?q=${encodeURIComponent(facet.label)}`}
        />
      </section>
      <Faq entries={faq} />
    </Page>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FilterableBusinessList } from "@/components/filterable";
import { byRank, toRow } from "@/lib/rows";
import { Breadcrumbs, FacetGrid, Page } from "@/components/chrome";
import { itemListJsonLd, serializeJsonLd } from "@directory/core";
import {
  areaLabel,
  areas,
  byArea,
  categoriesInArea,
  cityName,
  MIN_FOR_INDEX,
} from "@/lib/data";
import { SITE_URL } from "@/lib/site";

export async function generateStaticParams() {
  return areas().map((a) => ({ area: a.slug }));
}

/** How many rows this hub renders — and therefore how many the ItemList claims. */
const ROWS_SHOWN = 120;

export const dynamicParams = true;
export const revalidate = 86_400;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ area: string }>;
}): Promise<Metadata> {
  const { area } = await params;
  const facet = areas().find((a) => a.slug === area);
  if (!facet) return { title: "Not found" };
  return {
    title: `Businesses in ${facet.label}, Dubai`,
    description:
      facet.count === 1
        ? `The one business listed in ${facet.label}, ${cityName()}.`
        : `${facet.count.toLocaleString()} businesses in ${facet.label}, ${cityName()}, by category.`,
    alternates: { canonical: `/area/${area}` },
    ...(facet.count < MIN_FOR_INDEX && {
      robots: { index: false, follow: true },
    }),
  };
}

export default async function AreaPage({
  params,
}: {
  params: Promise<{ area: string }>;
}) {
  const { area } = await params;
  const facet = areas().find((a) => a.slug === area);
  if (!facet) notFound();

  const categoryFacets = categoriesInArea(area);
  const businesses = byArea(area);

  // After the slice — see the note on the category route. This hub renders 120
  // of a possibly much larger set.
  const rows = byRank(businesses).slice(0, ROWS_SHOWN).map(toRow);
  const itemList = itemListJsonLd(
    rows.map((r) => ({ name: r.title, url: r.href })),
    SITE_URL,
    { name: `Businesses in ${areaLabel(area)}` },
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
          { label: areaLabel(area) },
        ]}
      />

      <h1 className="font-[family-name:var(--font-display)] text-3xl sm:text-4xl">
        Businesses in {areaLabel(area)}
      </h1>
      <p className="mt-3 text-[var(--muted)]">
        <span className="tabular">{facet.count.toLocaleString()}</span> listings
        across <span className="tabular">{categoryFacets.length}</span>{" "}
        {categoryFacets.length === 1 ? "category" : "categories"}.
      </p>

      <section className="mt-10">
        <h2 className="label text-[var(--muted)]">By category</h2>
        <div className="mt-3">
          <FacetGrid
            items={categoryFacets}
            hrefFor={(slug) => `/area/${area}/${slug}`}
          />
        </div>
      </section>

      <section className="mt-12">
        <h2 className="font-[family-name:var(--font-display)] text-2xl">
          Most reviewed
        </h2>
        <p className="mt-2 mb-5 text-sm text-[var(--muted)]">
          Showing the {Math.min(businesses.length, ROWS_SHOWN)} most reviewed of{" "}
          {facet.count.toLocaleString()}.
        </p>
        <FilterableBusinessList
          rows={rows}
          noun="shown"
          placeholder={`Filter businesses in ${areaLabel(area)}`}
          searchAllHref={`/search?q=${encodeURIComponent(areaLabel(area))}`}
        />
      </section>
    </Page>
  );
}

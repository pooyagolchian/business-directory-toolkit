import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FilterableBusinessList } from "@/components/filterable";
import { byRank, toRow } from "@/lib/rows";
import { Breadcrumbs, FacetGrid, Page } from "@/components/chrome";
import { buildFaq, itemListJsonLd, serializeJsonLd } from "@directory/core";
import { Faq } from "@/components/faq";
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
    title: `Businesses in ${facet.label}, ${cityName()}`,
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

  /*
    The 40 neighbourhood hubs had no FAQ while their 81 category siblings all
    had one. The blocker was in core, not here: FaqInput.category was required,
    so buildFaq could not be called for a page that spans every category. Now
    that it is optional, the hub asks the questions a hub can answer — about the
    neighbourhood as a whole rather than about one category in it.

    Built from the WHOLE set, not the 120 rendered rows: "how many businesses
    are in Al Barsha" is a fact about the neighbourhood, and answering it with
    the page size would be false.
  */
  const faq = buildFaq({
    city: cityName(),
    area: areaLabel(area),
    businesses,
  });
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
          Top rated
        </h2>
        <p className="mt-2 mb-5 text-sm text-[var(--muted)]">
          {/*
            This said "Most reviewed", and it was false. The rows come from
            byRank(), which orders by a credibility-weighted rating (ADR 0010),
            not by review count. Measured on /category/restaurants: 73 of the 120
            rows shown are NOT among the 120 most reviewed, and the top row has
            3,895 reviews against 32,881 for the actual leader — so the heading
            described an ordering the page has never used.
          */}
          Showing {Math.min(businesses.length, ROWS_SHOWN)} of{" "}
          {facet.count.toLocaleString()}, ranked by rating and weighted for
          review volume — so a 4.9 from 400 reviews outranks a 4.9 from four.
        </p>
        <FilterableBusinessList
          rows={rows}
          noun="shown"
          placeholder={`Filter businesses in ${areaLabel(area)}`}
          searchAllHref={`/search?q=${encodeURIComponent(areaLabel(area))}`}
        />
      </section>
      <Faq entries={faq} />
    </Page>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FilterableBusinessList } from "@/components/filterable";
import { byRank, toRow } from "@/lib/rows";
import { Breadcrumbs, FacetGrid, Page } from "@/components/chrome";
import { Faq } from "@/components/faq";
import { buildFaq } from "@directory/core";
import { areasInCategory, byCategory, categories } from "@/lib/data";

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
    description: `${facet.count} ${facet.label.toLowerCase()} in Dubai, by neighbourhood.`,
    alternates: { canonical: `/category/${l2}` },
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

  return (
    <Page>
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
          rows={byRank(businesses).slice(0, PAGE_SIZE).map(toRow)}
          noun="shown"
          placeholder={`Filter ${facet.label.toLowerCase()} by name, area, or phone`}
          searchAllHref={`/search?q=${encodeURIComponent(facet.label)}`}
        />
      </section>
      <Faq entries={faq} />
    </Page>
  );
}

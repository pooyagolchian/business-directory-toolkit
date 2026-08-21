import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FilterableBusinessList } from "@/components/filterable";
import { byRank, toRow } from "@/lib/rows";
import { Breadcrumbs, FacetGrid, Page } from "@/components/chrome";
import { areaLabel, areas, byArea, categoriesInArea } from "@/lib/data";

export async function generateStaticParams() {
  return areas().map((a) => ({ area: a.slug }));
}

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
    description: `${facet.count} businesses in ${facet.label}, Dubai, by category.`,
    alternates: { canonical: `/area/${area}` },
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

  return (
    <Page>
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
          Showing the {Math.min(businesses.length, 120)} most reviewed of{" "}
          {facet.count.toLocaleString()}.
        </p>
        <FilterableBusinessList
          rows={byRank(businesses).slice(0, 120).map(toRow)}
          noun="shown"
          placeholder={`Filter businesses in ${areaLabel(area)}`}
          searchAllHref={`/search?q=${encodeURIComponent(areaLabel(area))}`}
        />
      </section>
    </Page>
  );
}

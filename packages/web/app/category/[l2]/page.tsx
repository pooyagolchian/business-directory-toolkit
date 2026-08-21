import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BusinessList } from "@/components/business-card";
import { Breadcrumbs, FacetGrid, Page } from "@/components/chrome";
import { areasInCategory, byCategory, categories } from "@/lib/data";

export async function generateStaticParams() {
  return categories().map((c) => ({ l2: c.slug }));
}

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
      <p className="mt-2 text-sm text-[var(--muted)]">
        <span className="tabular">{facet.count.toLocaleString()}</span> listings
        across <span className="tabular">{areaFacets.length}</span>{" "}
        {areaFacets.length === 1 ? "neighbourhood" : "neighbourhoods"}.
      </p>

      {areaFacets.length > 1 && (
        <section className="mt-10">
          <h2 className="font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]">
            By neighbourhood
          </h2>
          <div className="mt-3">
            <FacetGrid
              items={areaFacets}
              hrefFor={(slug) => `/area/${slug}/${l2}`}
            />
          </div>
        </section>
      )}

      <section className="mt-12">
        <h2 className="font-[family-name:var(--font-display)] text-xl">
          Most reviewed
        </h2>
        <BusinessList businesses={businesses.slice(0, 50)} />
      </section>
    </Page>
  );
}

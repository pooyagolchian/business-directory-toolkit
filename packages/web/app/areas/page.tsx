import type { Metadata } from "next";
import { Breadcrumbs, Page } from "@/components/chrome";
import { FilterableFacetGrid } from "@/components/filterable";
import { areas, cityName } from "@/lib/data";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "All neighbourhoods",
    description: `Browse ${cityName()} businesses by neighbourhood.`,
    alternates: { canonical: "/areas" },
  };
}

export default function AreasPage() {
  const all = areas();
  return (
    <Page>
      <Breadcrumbs trail={[{ href: "/", label: "Home" }, { label: "Areas" }]} />
      <h1 className="font-[family-name:var(--font-display)] text-3xl sm:text-4xl">
        {all.length} neighbourhoods
      </h1>
      <div className="mt-8">
        <FilterableFacetGrid
          items={all}
          hrefPrefix="/area"
          noun="neighbourhoods"
          placeholder="Filter neighbourhoods — try marina, deira"
        />
      </div>
    </Page>
  );
}

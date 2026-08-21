import type { Metadata } from "next";
import { Breadcrumbs, Page } from "@/components/chrome";
import { FilterableFacetGrid } from "@/components/filterable";
import { categories } from "@/lib/data";

export const metadata: Metadata = {
  title: "All categories",
  description: "Browse Dubai businesses by category.",
  alternates: { canonical: "/categories" },
};

export default function CategoriesPage() {
  const all = categories();
  return (
    <Page>
      <Breadcrumbs
        trail={[{ href: "/", label: "Home" }, { label: "Categories" }]}
      />
      <h1 className="font-[family-name:var(--font-display)] text-3xl sm:text-4xl">
        {all.length} categories
      </h1>
      <div className="mt-8">
        <FilterableFacetGrid
          items={all}
          hrefPrefix="/category"
          noun="categories"
          placeholder="Filter categories — try spa, pharmacy, laundry"
        />
      </div>
    </Page>
  );
}

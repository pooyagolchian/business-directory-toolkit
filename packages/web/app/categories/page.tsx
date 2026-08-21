import type { Metadata } from "next";
import { FacetGrid, Breadcrumbs, Page } from "@/components/chrome";
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
        <FacetGrid items={all} hrefFor={(slug) => `/category/${slug}`} />
      </div>
    </Page>
  );
}

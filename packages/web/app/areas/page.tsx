import type { Metadata } from "next";
import { FacetGrid, Breadcrumbs, Page } from "@/components/chrome";
import { areas } from "@/lib/data";

export const metadata: Metadata = {
  title: "All neighbourhoods",
  description: "Browse Dubai businesses by neighbourhood.",
  alternates: { canonical: "/areas" },
};

export default function AreasPage() {
  const all = areas();
  return (
    <Page>
      <Breadcrumbs trail={[{ href: "/", label: "Home" }, { label: "Areas" }]} />
      <h1 className="font-[family-name:var(--font-display)] text-3xl sm:text-4xl">
        {all.length} neighbourhoods
      </h1>
      <div className="mt-8">
        <FacetGrid items={all} hrefFor={(slug) => `/area/${slug}`} />
      </div>
    </Page>
  );
}

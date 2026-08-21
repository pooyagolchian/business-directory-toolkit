import type { Metadata } from "next";
import { BusinessList } from "@/components/business-card";
import { Page } from "@/components/chrome";
import { SearchBox } from "@/components/search-box";
import { search } from "@/lib/data";

export const metadata: Metadata = {
  title: "Search",
  // A search results page has nothing unique to offer an index, and thousands
  // of query-string permutations are exactly the crawl-budget sink that hurts
  // a programmatic site. Keep it out.
  robots: { index: false, follow: true },
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const result = search(q);

  return (
    <Page>
      <div className="max-w-2xl">
        <SearchBox initialQuery={q} autoFocus />
      </div>

      {q.trim() && (
        <p className="mt-6 font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]">
          {result.total === 0
            ? "No matches"
            : `${result.total.toLocaleString()} ${result.total === 1 ? "match" : "matches"}`}
          {result.matchedByPhone && " · matched by phone number"}
          {result.total > result.businesses.length &&
            ` · showing first ${result.businesses.length}`}
        </p>
      )}

      {result.matchedByPhone && (
        <p className="mt-4 max-w-xl text-sm text-[var(--muted)]">
          That number belongs to a business listing. Phone numbers are stored in
          E.164 so a search matches however you type it.
        </p>
      )}

      {q.trim() ? (
        <BusinessList
          businesses={result.businesses}
          emptyMessage={`Nothing matched “${q}”. Try a category like “restaurants”, a neighbourhood, or a +971 number.`}
        />
      ) : (
        <p className="py-12 text-[var(--muted)]">
          Type to search businesses, categories, neighbourhoods, or a phone
          number.
        </p>
      )}
    </Page>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { BusinessList } from "@/components/business-card";
import { Page } from "@/components/chrome";
import { Pagination } from "@/components/pagination";
import { SearchBox } from "@/components/search-box";
import { SearchFilters } from "@/components/search-filters";
import { searchHref } from "@/lib/search-url";
import { searchView } from "@/lib/search-view";

export const metadata: Metadata = {
  title: "Search",
  // A search results page has nothing unique to offer an index, and thousands
  // of query-string permutations are exactly the crawl-budget sink that hurts
  // a programmatic site. Keep it out.
  //
  // It is also what lets the filters live in the URL at all. On an indexed page
  // seven facet groups would multiply into a combinatorial crawl trap; here the
  // permutations cost nothing and buy back shareable, back-button-safe filters.
  robots: { index: false, follow: true },
};

export default async function SearchPage(props: PageProps<"/search">) {
  const view = searchView(await props.searchParams);
  const { query, filter, sort, slice } = view;

  return (
    <Page>
      {/*
        The one heading nothing else on this page can supply.

        Every other route opens with a display-serif <h1>; here the search box
        IS the subject, and a visible title above it would be a label for a
        control that already has one. Hidden keeps the design intact and stops
        the page being what it was: a flat run of ~57 <h3>s with no <h1> and no
        <h2>, which is unnavigable by heading.
      */}
      <h1 className="sr-only">
        {query.trim() ? `Search results for “${query}”` : "Search"}
      </h1>

      <div className="max-w-2xl">
        <SearchBox initialQuery={query} />
      </div>

      {!query.trim() && (
        <p className="py-12 text-[var(--muted)]">
          Type to search businesses, categories, neighbourhoods, or a phone
          number.
        </p>
      )}

      {query.trim() && (
        <>
          <p className="mt-6 label text-[var(--muted)]">
            <ResultCount view={view} />
          </p>

          {view.matchedByPhone && (
            <p className="mt-5 max-w-xl text-[var(--muted)]">
              That number belongs to a business listing. Phone numbers are
              stored in E.164 so a search matches however you type it.
            </p>
          )}

          {/* Filters are dropped for a phone lookup — see searchView() for why
              an exact-match answer is not something to offer facets on. */}
          {!view.matchedByPhone && view.matches > 0 && (
            <SearchFilters
              query={query}
              filter={filter}
              sort={sort}
              facets={view.facets}
              hasFilters={view.hasFilters}
            />
          )}

          {slice.items.length > 0 ? (
            <>
              {/* Sibling of the filter panel's heading, so the business titles
                  below nest under "Results" rather than under "Access". */}
              <h2 className="sr-only">Results</h2>
              <BusinessList businesses={slice.items} />
              <Pagination
                page={slice.page}
                pages={slice.pages}
                hrefFor={(page) => searchHref({ query, filter, sort, page })}
              />
            </>
          ) : (
            <EmptyState view={view} />
          )}
        </>
      )}
    </Page>
  );
}

/**
 * The count line.
 *
 * It states the filtered total against the unfiltered one whenever they differ,
 * because "312 matches" alone reads as the whole answer when it is a tenth of
 * it. The page range is spelled out for the same reason: the previous version
 * said "showing first 50" and there was no way to reach the other 1,446.
 */
function ResultCount({ view }: { view: ReturnType<typeof searchView> }) {
  const { matches, filtered, slice, matchedByPhone, hasFilters } = view;

  if (matches === 0) return <>No matches</>;

  const total = hasFilters
    ? `${filtered.toLocaleString()} of ${matches.toLocaleString()} ${matches === 1 ? "match" : "matches"}`
    : `${matches.toLocaleString()} ${matches === 1 ? "match" : "matches"}`;

  return (
    <>
      {total}
      {matchedByPhone && " · matched by phone number"}
      {slice.pages > 1 &&
        ` · showing ${slice.from.toLocaleString()}–${slice.to.toLocaleString()}`}
    </>
  );
}

/**
 * Two different empty states, because they have two different remedies.
 *
 * Filtering to nothing is the recoverable one, and the message says which
 * filters did it rather than blaming the query — the old copy would have told
 * someone who had just clicked "4.5+" that nothing matched "restaurant".
 */
function EmptyState({ view }: { view: ReturnType<typeof searchView> }) {
  const { query, sort, matches, hasFilters } = view;

  if (matches > 0 && hasFilters) {
    return (
      <div className="py-12">
        <p className="text-[var(--muted)]">
          No results left after filtering.{" "}
          <span className="tabular">{matches.toLocaleString()}</span>{" "}
          {matches === 1 ? "business matches" : "businesses match"} &ldquo;
          {query}&rdquo; without the filters.
        </p>
        <Link
          href={searchHref({ query, sort })}
          prefetch={false}
          className="mt-3 inline-block underline underline-offset-4"
        >
          Clear the filters
        </Link>
      </div>
    );
  }

  return (
    <p className="py-12 text-[var(--muted)]">
      Nothing matched &ldquo;{query}&rdquo;. Try a category like
      &ldquo;restaurants&rdquo;, a neighbourhood, or a +971 number.
    </p>
  );
}

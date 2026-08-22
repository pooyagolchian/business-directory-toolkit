import type { Metadata } from "next";
import Link from "next/link";
import { toCardRow } from "@/components/business-card";
import { Page } from "@/components/chrome";
import { SearchBox } from "@/components/search-box";
import { SearchFilters } from "@/components/search-filters";
import { SearchResults } from "@/components/search-results";
import { searchHref } from "@/lib/search-url";
import { PAGE_SIZE, searchView } from "@/lib/search-view";

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
  // Cumulative: ?page=3 means "the 150 rows the reader had scrolled past", so a
  // reload or a shared link restores all of them rather than dropping the
  // reader into a disconnected batch. See paginate() in packages/core.
  const view = searchView(await props.searchParams, { cumulative: true });
  const { query, filter, sort, slice } = view;

  const hrefForPage = Array.from({ length: slice.pages }, (_, i) =>
    searchHref({ query, filter, sort, page: i + 1 }),
  );

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
            <SearchResults
              /*
                Remount whenever the query, filters or sort change. The appended
                rows are client state, and without a key React would keep them
                across a navigation — leaving the previous filter's results
                stacked under the new one's.

                Page 1's href is the natural identity: it is exactly the search
                minus which batch you are on.
              */
              key={hrefForPage[0]}
              initialRows={slice.items.map(toCardRow)}
              initialPage={slice.page}
              pages={slice.pages}
              total={view.filtered}
              matches={view.matches}
              hasFilters={view.hasFilters}
              matchedByPhone={view.matchedByPhone}
              perPage={PAGE_SIZE}
              hrefForPage={hrefForPage}
            />
          ) : (
            <>
              <p className="mt-6 label text-[var(--muted)]">
                {view.matches === 0
                  ? "No matches"
                  : `0 of ${view.matches.toLocaleString()} matches`}
              </p>
              <EmptyState view={view} />
            </>
          )}

          {view.matchedByPhone && (
            <p className="mt-8 max-w-xl text-[var(--muted)]">
              That number belongs to a business listing. Phone numbers are
              stored in E.164 so a search matches however you type it.
            </p>
          )}
        </>
      )}
    </Page>
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

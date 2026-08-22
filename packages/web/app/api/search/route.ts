import { NextResponse } from "next/server";
import { SEARCH_PARAMS, parsePage } from "@directory/core";
import { toCardRow } from "@/components/business-card";
import type { SearchBatch } from "@/lib/search-batch";
import { searchView } from "@/lib/search-view";

/**
 * One more batch of search results, for the scroll-append on /search.
 *
 * The second API route in the app, and CLAUDE.md is right to make that need an
 * argument: Next Server Components query the data directly, and inserting a
 * hop is normally a latency bug. The argument is the same one typeahead makes.
 * Appending fifty rows to a list already on screen must not re-render the page
 * it is being appended to — re-rendering /search means redoing the search, the
 * filter, and all six facet counts to produce markup the browser then throws
 * away.
 *
 * It takes the SAME query string the page does and calls the SAME searchView(),
 * so the filter semantics cannot drift from the page's. The only difference is
 * `cumulative: false`: the page restores every row up to the batch, this hands
 * back one batch.
 *
 * Rows arrive display-ready because a Business cannot cross to the client —
 * resolving one needs the city config off disk. See CardRow.
 */
export const dynamic = "force-dynamic";

/**
 * Reshape a query string into what Next hands a page.
 *
 * Not `Object.fromEntries(searchParams)`, which keeps the LAST value of a
 * repeated key while Next gives you an array and parseFilter takes the first.
 * `?area=deira&area=downtown` would then filter this endpoint by downtown and
 * the page by deira — the two disagreeing about what the reader asked for, in
 * the one place the whole design depends on them agreeing.
 */
function toSearchQuery(url: URL): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    query[key] = values.length > 1 ? values : (values[0] ?? "");
  }
  return query;
}

export function GET(request: Request) {
  const query = toSearchQuery(new URL(request.url));
  const view = searchView(query);

  /**
   * Past the last batch, hand back nothing.
   *
   * paginate() clamps, which is right for the page — ?page=999 is a stale link
   * and showing the last batch beats a 404. It is wrong here: this endpoint
   * appends, so clamping means answering "give me batch 4 of 1" with batch 1
   * again, and the caller adds fifty rows it already has. The client's own
   * guard makes that unreachable today, and an appending API that silently
   * re-serves is not something to leave resting on a caller getting it right.
   */
  const beyondEnd = parsePage(query[SEARCH_PARAMS.page]) > view.slice.pages;

  const body: SearchBatch = {
    rows: beyondEnd ? [] : view.slice.items.map(toCardRow),
    page: view.slice.page,
    pages: view.slice.pages,
    from: view.slice.from,
    to: view.slice.to,
    total: view.filtered,
  };

  return NextResponse.json(body, {
    headers: {
      // The dataset is fixed for the life of a deployment, so the same query
      // and page always produce the same batch — exactly the typeahead
      // argument, and the reason this can be cached at the edge rather than
      // recomputed per scroll.
      "cache-control": "public, max-age=3600, s-maxage=86400",
    },
  });
}

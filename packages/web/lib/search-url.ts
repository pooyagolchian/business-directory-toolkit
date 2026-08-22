import { SEARCH_PARAMS, filterToQuery } from "@directory/core";
import type { BusinessFilter, SortKey } from "@directory/core";

/**
 * Build a /search URL.
 *
 * One function so the query-string scheme is written in exactly one place. The
 * filter chips, the sort chips, "Clear all" and the pager all route through
 * here, and a param name spelled two ways would silently drop a filter.
 */
export function searchHref({
  query,
  filter,
  sort,
  page,
}: {
  query: string;
  filter?: BusinessFilter;
  sort?: SortKey;
  /**
   * Omitted by every filter and sort link on purpose. Changing what you are
   * filtering by invalidates where you were in the old result set — page 7 of
   * "restaurants" is not page 7 of "restaurants in Deira", and landing on a
   * clamped last page after every click is how a filtered list feels broken.
   */
  page?: number;
}): string {
  const params = new URLSearchParams();

  if (query) params.set(SEARCH_PARAMS.query, query);
  for (const [name, value] of Object.entries(filterToQuery(filter ?? {}))) {
    params.set(name, value);
  }
  // The defaults stay out of the URL, so an unfiltered search is still just
  // ?q=restaurant — the link people actually paste to each other.
  if (sort && sort !== "relevance") params.set(SEARCH_PARAMS.sort, sort);
  if (page && page > 1) params.set(SEARCH_PARAMS.page, String(page));

  const search = params.toString();
  return search ? `/search?${search}` : "/search";
}

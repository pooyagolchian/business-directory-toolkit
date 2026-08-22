import {
  SEARCH_PARAMS,
  facetSearch,
  hasActiveFilter,
  paginate,
  parseFilter,
  parsePage,
  parseSortKey,
  sortBusinesses,
} from "@directory/core";
import type {
  Business,
  BusinessFilter,
  FacetGroups,
  PageSlice,
  SearchQuery,
  SortKey,
} from "@directory/core";
import { areaLabel, search } from "./data";
import { rankPrior } from "./rows";

/**
 * How many results one page of /search shows.
 *
 * Same 50 the page has always rendered. What changed is what it is 50 OF: the
 * filters and their counts run over every match, and paginate() walks the rest,
 * so the cap no longer decides which businesses are reachable at all.
 */
export const PAGE_SIZE = 50;

export interface SearchView {
  query: string;
  filter: BusinessFilter;
  sort: SortKey;
  /** True when the query was read as a phone number rather than a name. */
  matchedByPhone: boolean;
  /** Matches before filtering — the denominator on the count line. */
  matches: number;
  /** Matches after filtering. */
  filtered: number;
  facets: FacetGroups;
  slice: PageSlice<Business>;
  hasFilters: boolean;
}

/**
 * Everything /search needs, assembled from the query string.
 *
 * The order is the whole design: search the corpus, filter the matches, count
 * the facets against those matches, sort what survived, and only then cut a
 * page out of it. Truncating any earlier would make the counts describe a set
 * the reader cannot see.
 */
export function searchView(
  params: SearchQuery,
  options?: {
    /**
     * Return every row up to `page` rather than just that page's batch.
     *
     * The page renders cumulatively, because ?page=3 now means "the 150 rows
     * the reader had scrolled past" — reloading a shared link has to restore
     * all of them. The append endpoint renders a single batch, because that is
     * exactly what it is adding to the bottom of a list already on screen.
     */
    cumulative?: boolean;
  },
): SearchView {
  const raw = params[SEARCH_PARAMS.query];
  const query = (Array.isArray(raw) ? raw[0] : raw) ?? "";

  const result = search(query);
  const sort = parseSortKey(params[SEARCH_PARAMS.sort]);

  // A phone lookup is already the whole answer — one or two exact matches — so
  // the filters are dropped rather than applied to it. Offering six rows of
  // chips above a single result would be noise, and applying a filter the page
  // does not display is worse: it would hide the listing without saying why.
  const filter = result.matchedByPhone ? {} : parseFilter(params);

  const faceted = facetSearch(result.businesses, filter);
  const sorted = sortBusinesses(faceted.items, sort, rankPrior());
  const slice = paginate(
    sorted,
    parsePage(params[SEARCH_PARAMS.page]),
    PAGE_SIZE,
    {
      cumulative: options?.cumulative ?? false,
    },
  );

  return {
    query,
    filter,
    sort,
    matchedByPhone: result.matchedByPhone,
    matches: result.total,
    filtered: faceted.total,
    // Neighbourhood names live in the city config, which core cannot read
    // without doing I/O, so it hands back slugs and they are resolved here.
    facets: {
      ...faceted.facets,
      area: faceted.facets.area.map((facet) => ({
        ...facet,
        label: areaLabel(facet.value),
      })),
    },
    slice,
    hasFilters: hasActiveFilter(filter),
  };
}

import type { RawLocalResult } from "@directory/core";
import type { CrawlJob } from "./plan";

export interface SearchParams {
  q: string;
  lat: number;
  lng: number;
  zoom: number;
  page: number;
  tileId: string;
  /**
   * Google's country-of-search, lowercase ISO-3166 alpha-2, taken from the
   * city config's `countryCode`.
   *
   * Required rather than defaulted, deliberately. This value spent the whole
   * of v0.1 hard-coded to "ae" inside `buildSearchUrl`, which meant every
   * crawl in every city asked Google as if it were searching from the UAE. A
   * default is what made that invisible; a required field makes the compiler
   * name every request path that forgot to say where it is searching.
   */
  gl: string;
}

export interface SearchResponse {
  local_results?: RawLocalResult[];
}

/**
 * Injected so the crawl can be driven by recorded fixtures in tests. Nothing in
 * this module opens a socket — that keeps the suite free and offline.
 */
export type SearchClient = (params: SearchParams) => Promise<SearchResponse>;

/** Provenance stamped onto each record: which query surfaced this business. */
export interface SourceRef {
  tileId: string;
  q: string;
  page: number;
}

export type SourcedResult = RawLocalResult & { _source?: SourceRef };

export interface CrawlOptions {
  /** Hard ceiling on requests. The crawl stops here regardless of remaining jobs. */
  budget: number;
  /** Lowercase ISO-3166 alpha-2 for `SearchParams.gl`, from the city config. */
  gl: string;
  /** Below this share of new businesses, a further page is not worth a credit. */
  minNewUniqueRatio?: number;
  /** Called with the untouched response before parsing — the S3 archive hook. */
  onRaw?: (
    params: SearchParams,
    response: SearchResponse,
  ) => Promise<void> | void;
  onProgress?: (issued: number, budget: number) => void;
}

export interface CrawlOutcome {
  records: SourcedResult[];
  requestsIssued: number;
  duplicatesSkipped: number;
  errors: Array<{ params: SearchParams; message: string }>;
  stoppedOnBudget: boolean;
}

const FULL_PAGE = 20;
const DEFAULT_MIN_NEW_RATIO = 0.3;

export interface PageOutcome {
  page: number;
  maxPages: number;
  resultCount: number;
  newUnique: number;
}

/**
 * Decide whether the next page of a (tile, category) pair is worth a credit.
 *
 * Three measured facts drive this: a page returns 20 results, page 11 returns
 * zero (the ~200-result ceiling), and ~12% of results inside one query stream
 * are repeats. So a short page means Google is out of results, and a full page
 * of mostly-seen businesses means we have hit the useful end of this query
 * before the hard ceiling.
 */
export function shouldFetchNextPage(
  outcome: PageOutcome,
  minNewUniqueRatio = DEFAULT_MIN_NEW_RATIO,
): boolean {
  if (outcome.page >= outcome.maxPages) return false;
  if (outcome.resultCount === 0) return false;
  if (outcome.resultCount < FULL_PAGE) return false;
  return outcome.newUnique / outcome.resultCount >= minNewUniqueRatio;
}

/**
 * Stage 1 — walk the crawl plan, paginating adaptively, deduplicating as it
 * goes, and archiving every raw response.
 *
 * A failing request is recorded and skipped rather than thrown: one rate-limited
 * tile must not cost the remaining ~1,249 requests of a run.
 */
export async function runCrawl(
  jobs: CrawlJob[],
  client: SearchClient,
  options: CrawlOptions,
): Promise<CrawlOutcome> {
  const {
    budget,
    gl,
    minNewUniqueRatio = DEFAULT_MIN_NEW_RATIO,
    onRaw,
    onProgress,
  } = options;

  const seen = new Set<string>();
  const records: SourcedResult[] = [];
  const errors: CrawlOutcome["errors"] = [];
  let requestsIssued = 0;
  let duplicatesSkipped = 0;
  let stoppedOnBudget = false;

  for (const job of jobs) {
    let page = 1;

    while (page <= job.maxPages) {
      if (requestsIssued >= budget) {
        stoppedOnBudget = true;
        return {
          records,
          requestsIssued,
          duplicatesSkipped,
          errors,
          stoppedOnBudget,
        };
      }

      const params: SearchParams = {
        q: job.q,
        lat: job.lat,
        lng: job.lng,
        zoom: job.zoom,
        page,
        tileId: job.tileId,
        gl,
      };

      let response: SearchResponse;
      try {
        response = await client(params);
        requestsIssued++;
      } catch (error) {
        requestsIssued++;
        errors.push({
          params,
          message: error instanceof Error ? error.message : String(error),
        });
        break; // abandon this job's pagination, keep the rest of the crawl
      }

      onProgress?.(requestsIssued, budget);

      // Archive before parsing. If anything downstream is wrong, the run can be
      // replayed from S3 without spending credits again.
      await onRaw?.(params, response);

      const results = response.local_results ?? [];
      let newUnique = 0;
      for (const result of results) {
        const id = result.place_id;
        if (!id) continue;
        if (seen.has(id)) {
          duplicatesSkipped++;
          continue;
        }
        seen.add(id);
        newUnique++;
        records.push({
          ...result,
          _source: { tileId: job.tileId, q: job.q, page },
        });
      }

      const keepGoing = shouldFetchNextPage(
        {
          page,
          maxPages: job.maxPages,
          resultCount: results.length,
          newUnique,
        },
        minNewUniqueRatio,
      );
      if (!keepGoing) break;
      page++;
    }
  }

  return {
    records,
    requestsIssued,
    duplicatesSkipped,
    errors,
    stoppedOnBudget,
  };
}

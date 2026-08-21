import type { SearchClient, SearchParams, SearchResponse } from "./fetch";

const ENDPOINT = "https://www.searchapi.io/api/v1/search";

/**
 * Build the request URL.
 *
 * The API key is deliberately absent — it travels in the Authorization header,
 * so it never lands in an access log, an error message, or a retry trace.
 */
export function buildSearchUrl(params: SearchParams): URL {
  const url = new URL(ENDPOINT);
  url.searchParams.set("engine", "google_maps");
  url.searchParams.set("q", params.q);
  // Google's own location format: @lat,lng,zoomz
  url.searchParams.set("ll", `@${params.lat},${params.lng},${params.zoom}z`);
  url.searchParams.set("hl", "en");
  url.searchParams.set("gl", "ae");
  if (params.page > 1) url.searchParams.set("page", String(params.page));
  return url;
}

/**
 * Rate limits and server errors are worth retrying; a 400 or a 401 will fail
 * identically forever and retrying only burns time and credits.
 */
export function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

export interface ClientOptions {
  maxRetries?: number;
  timeoutMs?: number;
  /** Injectable so tests can assert backoff without actually sleeping. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The live SearchApi client. Every call spends a credit, so this is never used
 * in tests — `runCrawl` takes the client as a parameter and the suite passes a
 * fixture-backed one instead.
 */
export function createSearchApiClient(
  apiKey: string,
  options: ClientOptions = {},
): SearchClient {
  const { maxRetries = 3, timeoutMs = 30_000, sleep = defaultSleep } = options;

  return async function search(params: SearchParams): Promise<SearchResponse> {
    let lastError = "";

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        // Exponential backoff. A 429 means we are ahead of the rate limit, so
        // slowing down is the only thing that helps.
        await sleep(2 ** attempt * 500);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(buildSearchUrl(params), {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: controller.signal,
        });

        if (response.ok) return (await response.json()) as SearchResponse;

        lastError = `HTTP ${response.status}`;
        if (!isRetryable(response.status)) {
          throw new Error(
            `SearchApi ${lastError} for "${params.q}" @${params.tileId}`,
          );
        }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("SearchApi ")) {
          throw error; // non-retryable, already described
        }
        lastError = error instanceof Error ? error.message : String(error);
      } finally {
        clearTimeout(timer);
      }
    }

    throw new Error(
      `SearchApi failed after ${maxRetries + 1} attempts for "${params.q}" @${params.tileId}: ${lastError}`,
    );
  };
}

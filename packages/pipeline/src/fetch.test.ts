import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import type { RawLocalResult } from "@directory/core";
import { runCrawl, shouldFetchNextPage } from "./fetch";
import type { CrawlJob } from "./plan";
import type { SearchParams, SearchResponse } from "./fetch";

function fixture(name: string): SearchResponse {
  return JSON.parse(
    readFileSync(
      new URL(`../../../fixtures/searchapi/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as SearchResponse;
}

const PAGE1 = fixture("google_maps_downtown_page1");
const PAGE2 = fixture("google_maps_downtown_page2");
const EMPTY = fixture("google_maps_downtown_page11_empty");

const job = (over: Partial<CrawlJob> = {}): CrawlJob => ({
  tileId: "downtown",
  lat: 25.1972,
  lng: 55.2744,
  zoom: 15,
  q: "restaurants",
  page: 1,
  maxPages: 5,
  ...over,
});

/** A client backed entirely by recorded fixtures. Never touches the network. */
function fixtureClient(pages: SearchResponse[]) {
  const calls: SearchParams[] = [];
  const client = async (params: SearchParams): Promise<SearchResponse> => {
    calls.push(params);
    return pages[params.page - 1] ?? EMPTY;
  };
  return { client, calls };
}

describe("shouldFetchNextPage", () => {
  test("stops at the job's page cap", () => {
    expect(
      shouldFetchNextPage({
        page: 5,
        maxPages: 5,
        resultCount: 20,
        newUnique: 20,
      }),
    ).toBe(false);
  });

  test("stops on an empty page, which is how the ~200 ceiling shows up", () => {
    expect(
      shouldFetchNextPage({
        page: 2,
        maxPages: 5,
        resultCount: 0,
        newUnique: 0,
      }),
    ).toBe(false);
  });

  test("stops on a partial page, since Google has run out of results", () => {
    expect(
      shouldFetchNextPage({
        page: 2,
        maxPages: 5,
        resultCount: 12,
        newUnique: 12,
      }),
    ).toBe(false);
  });

  test("stops when a full page is mostly businesses already seen", () => {
    // Paying a credit for 2 new businesses is not worth it.
    expect(
      shouldFetchNextPage({
        page: 2,
        maxPages: 5,
        resultCount: 20,
        newUnique: 2,
      }),
    ).toBe(false);
  });

  test("continues when a full page is still yielding new businesses", () => {
    expect(
      shouldFetchNextPage({
        page: 2,
        maxPages: 5,
        resultCount: 20,
        newUnique: 18,
      }),
    ).toBe(true);
  });
});

describe("runCrawl", () => {
  test("issues one request per job when the first page ends pagination", async () => {
    const { client, calls } = fixtureClient([PAGE1, EMPTY]);
    const outcome = await runCrawl([job({ maxPages: 1 })], client, {
      budget: 100,
      gl: "ae",
    });
    expect(calls).toHaveLength(1);
    expect(outcome.requestsIssued).toBe(1);
  });

  test("follows pagination while a page is still productive", async () => {
    const { client, calls } = fixtureClient([PAGE1, PAGE2, EMPTY]);
    await runCrawl([job()], client, { budget: 100, gl: "ae" });
    // page1 full and all-new -> fetch page2; page2 is partial (10) -> stop.
    expect(calls.map((c) => c.page)).toEqual([1, 2]);
  });

  test("deduplicates businesses repeated across pages", async () => {
    const { client } = fixtureClient([PAGE1, PAGE2, EMPTY]);
    const outcome = await runCrawl([job()], client, { budget: 100, gl: "ae" });
    const ids = outcome.records.map((r) => r.place_id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(outcome.duplicatesSkipped).toBe(4);
  });

  test("never exceeds the credit budget", async () => {
    const { client, calls } = fixtureClient([
      PAGE1,
      PAGE1,
      PAGE1,
      PAGE1,
      PAGE1,
    ]);
    const jobs = [job(), job({ q: "cafes" }), job({ q: "gyms" })];
    const outcome = await runCrawl(jobs, client, { budget: 2, gl: "ae" });
    expect(calls.length).toBeLessThanOrEqual(2);
    expect(outcome.stoppedOnBudget).toBe(true);
  });

  test("hands every raw response to the archive sink before parsing", async () => {
    // Raw-to-S3 is what makes later stages re-runnable without re-spending.
    const { client } = fixtureClient([PAGE1, EMPTY]);
    const archived: SearchParams[] = [];
    await runCrawl([job({ maxPages: 1 })], client, {
      budget: 10,
      gl: "ae",
      onRaw: (params) => {
        archived.push(params);
      },
    });
    expect(archived).toHaveLength(1);
    expect(archived[0]?.q).toBe("restaurants");
  });

  test("records a failed request instead of aborting the whole crawl", async () => {
    // One bad tile must not cost the other 1,249 requests.
    let call = 0;
    const client = async (): Promise<SearchResponse> => {
      call++;
      if (call === 1) throw new Error("429 rate limited");
      return PAGE1;
    };
    const outcome = await runCrawl(
      [job({ maxPages: 1 }), job({ q: "cafes", maxPages: 1 })],
      client,
      {
        budget: 10,
        gl: "ae",
      },
    );
    expect(outcome.errors).toHaveLength(1);
    expect(outcome.errors[0]?.message).toContain("429");
    expect(outcome.records.length).toBeGreaterThan(0);
  });

  test("sends the city's country of search on every request", async () => {
    // The reason gl is a required option rather than a defaulted one: for the
    // whole of v0.1 it was the literal "ae" inside buildSearchUrl, so a
    // Portuguese crawl asked Google from the UAE and paid for the answer.
    const { client, calls } = fixtureClient([PAGE1, PAGE2, EMPTY]);
    await runCrawl([job()], client, { budget: 100, gl: "pt" });
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.every((c) => c.gl === "pt")).toBe(true);
  });

  test("tags each record with the query that found it, for provenance", async () => {
    const { client } = fixtureClient([PAGE1, EMPTY]);
    const outcome = await runCrawl([job({ maxPages: 1 })], client, {
      budget: 10,
      gl: "ae",
    });
    expect(outcome.records[0]?._source).toEqual({
      tileId: "downtown",
      q: "restaurants",
      page: 1,
    });
  });
});

// Type-level guard: records carry provenance without losing the raw shape.
export type _Check = RawLocalResult;

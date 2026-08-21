import { describe, expect, test } from "vitest";
import { buildSearchUrl, isRetryable } from "./searchapi";

describe("buildSearchUrl", () => {
  const params = {
    q: "restaurants",
    lat: 25.1972,
    lng: 55.2744,
    zoom: 15,
    page: 1,
    tileId: "downtown",
  };

  test("targets the google_maps engine", () => {
    expect(buildSearchUrl(params).searchParams.get("engine")).toBe(
      "google_maps",
    );
  });

  test("encodes the tile as Google's @lat,lng,zoomz location string", () => {
    expect(buildSearchUrl(params).searchParams.get("ll")).toBe(
      "@25.1972,55.2744,15z",
    );
  });

  test("pins results to the UAE so the engine returns local listings", () => {
    const url = buildSearchUrl(params);
    expect(url.searchParams.get("gl")).toBe("ae");
    expect(url.searchParams.get("hl")).toBe("en");
  });

  test("omits page 1, which the engine treats as the default", () => {
    expect(buildSearchUrl(params).searchParams.get("page")).toBeNull();
  });

  test("sends the page number for deeper pages", () => {
    expect(
      buildSearchUrl({ ...params, page: 3 }).searchParams.get("page"),
    ).toBe("3");
  });

  test("never puts the API key in the URL, which would leak it into logs", () => {
    // The key travels in the Authorization header instead.
    expect(buildSearchUrl(params).toString()).not.toMatch(/api_key|key=/i);
  });
});

describe("isRetryable", () => {
  test("retries rate limiting", () => {
    expect(isRetryable(429)).toBe(true);
  });

  test("retries server errors", () => {
    expect(isRetryable(503)).toBe(true);
  });

  test("does not retry a bad request, which will fail identically forever", () => {
    expect(isRetryable(400)).toBe(false);
  });

  test("does not retry an auth failure — that needs a human, not a retry", () => {
    expect(isRetryable(401)).toBe(false);
  });
});

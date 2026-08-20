import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { dedupeByPlaceId } from "./dedupe.js";
import type { RawLocalResult } from "./types.js";

function fixture(name: string): RawLocalResult[] {
  const raw = readFileSync(
    new URL(`../../../fixtures/searchapi/${name}.json`, import.meta.url),
    "utf8",
  );
  return (
    (JSON.parse(raw) as { local_results?: RawLocalResult[] }).local_results ??
    []
  );
}

const page1 = fixture("google_maps_downtown_page1");
const page2 = fixture("google_maps_downtown_page2");
const deira = fixture("google_maps_deira_page1");

describe("dedupeByPlaceId", () => {
  test("collapses the duplicates that Google repeats across pages", () => {
    // Recorded fixtures: page 2 genuinely repeats 4 businesses from page 1.
    const result = dedupeByPlaceId([...page1, ...page2]);
    expect(result.duplicatesRemoved).toBe(4);
    expect(result.unique).toHaveLength(page1.length + page2.length - 4);
  });

  test("keeps disjoint tiles fully intact", () => {
    // Downtown and Deira measured 0 overlap; dedup must not erode that.
    const result = dedupeByPlaceId([...page1, ...deira]);
    expect(result.duplicatesRemoved).toBe(0);
    expect(result.unique).toHaveLength(page1.length + deira.length);
  });

  test("preserves first-seen order", () => {
    const result = dedupeByPlaceId([...page1, ...page2]);
    expect(result.unique[0]?.place_id).toBe(page1[0]?.place_id);
  });

  test("keeps the first occurrence, not the last", () => {
    const a: RawLocalResult = { place_id: "X", title: "First" };
    const b: RawLocalResult = { place_id: "X", title: "Second" };
    expect(dedupeByPlaceId([a, b]).unique[0]?.title).toBe("First");
  });

  test("drops records with no place_id, since they cannot be deduped safely", () => {
    const result = dedupeByPlaceId([{ title: "No id" }, { place_id: "X" }]);
    expect(result.unique).toHaveLength(1);
    expect(result.skippedNoPlaceId).toBe(1);
  });

  test("handles an empty input", () => {
    const result = dedupeByPlaceId([]);
    expect(result.unique).toEqual([]);
    expect(result.duplicatesRemoved).toBe(0);
  });
});

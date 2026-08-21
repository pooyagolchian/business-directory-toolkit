import { describe, expect, test } from "vitest";
import { dropSuppressed, parseSuppressionList } from "./suppression";

/**
 * TAKEDOWN.md promises that a removed business stays removed. That promise is
 * only worth making if the crawl cannot put it back, so the check belongs on
 * the load path — the one place both a fresh crawl and a replay from the raw
 * archive have to pass through.
 */
describe("dropSuppressed", () => {
  const records = [
    { place_id: "keep1", title: "Kept Cafe" },
    { place_id: "gone1", title: "Removed Clinic" },
    { place_id: "keep2", title: "Kept Hotel" },
  ];

  test("removes a suppressed record", () => {
    const out = dropSuppressed(records, new Set(["gone1"]));
    expect(out.kept.map((r) => r.place_id)).toEqual(["keep1", "keep2"]);
  });

  test("reports how many it removed, so a load cannot drop records silently", () => {
    expect(dropSuppressed(records, new Set(["gone1"])).removed).toBe(1);
    expect(dropSuppressed(records, new Set()).removed).toBe(0);
  });

  test("an empty list changes nothing", () => {
    expect(dropSuppressed(records, new Set()).kept).toHaveLength(3);
  });

  test("a suppressed id that is not in the crawl is not an error", () => {
    // A business can be delisted from Google after we suppress it.
    const out = dropSuppressed(records, new Set(["never-seen"]));
    expect(out.kept).toHaveLength(3);
    expect(out.removed).toBe(0);
  });

  test("a record with no place_id is kept, because it cannot be identified", () => {
    // dedupeByPlaceId drops these first; this only guarantees suppression
    // never becomes a second, silent reason for a record to vanish.
    const anonymous: Array<{ title: string; place_id?: string }> = [
      { title: "Anonymous" },
    ];
    const out = dropSuppressed(anonymous, new Set(["gone1"]));
    expect(out.kept).toHaveLength(1);
  });
});

/**
 * The file is edited by hand under time pressure, during a takedown request.
 * It should fail loudly on malformed input rather than silently suppressing
 * nothing — a suppression list that quietly does nothing is worse than none,
 * because it implies a guarantee that is not kept.
 */
describe("parseSuppressionList", () => {
  test("reads an array of place ids", () => {
    expect(parseSuppressionList('["a", "b"]')).toEqual(new Set(["a", "b"]));
  });

  test("accepts an empty list", () => {
    expect(parseSuppressionList("[]")).toEqual(new Set());
  });

  test("ignores blank entries and trims whitespace", () => {
    expect(parseSuppressionList('["  a  ", "", "  "]')).toEqual(new Set(["a"]));
  });

  test("rejects anything that is not an array of strings", () => {
    expect(() => parseSuppressionList('{"a": 1}')).toThrow();
    expect(() => parseSuppressionList("[1, 2]")).toThrow();
    expect(() => parseSuppressionList("not json")).toThrow();
  });
});

test("accepts the normalised camelCase shape as well as the raw one", () => {
  // Raw engine records carry place_id; normalised Business records carry
  // placeId. Suppression has to work on both, or it silently protects only
  // half the pipeline.
  const ids = new Set(["SUPPRESSED"]);
  const result = dropSuppressed(
    [{ placeId: "SUPPRESSED" }, { placeId: "KEPT" }],
    ids,
  );
  expect(result.removed).toBe(1);
  expect(result.kept).toEqual([{ placeId: "KEPT" }]);
});

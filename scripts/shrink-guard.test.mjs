import { describe, expect, test } from "vitest";
import { SHRINK_FLOOR_PERCENT, shrinkVerdict } from "./shrink-guard.mjs";

/**
 * `pnpm dataset:push` is the last step before a dataset becomes the live site.
 * A push that publishes a much smaller directory 404s every page that fell out,
 * so a large drop is refused unless the operator says it is intended. The
 * decision is a pure function so it can be tested without AWS.
 */
describe("shrinkVerdict", () => {
  test("the floor is 95% of the remote count", () => {
    expect(SHRINK_FLOOR_PERCENT).toBe(95);
  });

  test("no remote dataset is a first push, and is allowed", () => {
    const v = shrinkVerdict({ remote: null, next: 10, allowShrink: false });
    expect(v.allowed).toBe(true);
    expect(v.reason).toBe("first-push");
  });

  test("growth is allowed", () => {
    const v = shrinkVerdict({ remote: 100, next: 120, allowShrink: false });
    expect(v).toMatchObject({ allowed: true, reason: "within-threshold" });
  });

  test("exactly 95% is allowed", () => {
    const v = shrinkVerdict({
      remote: 14_980,
      next: 14_231,
      allowShrink: false,
    });
    expect(v).toMatchObject({ allowed: true, reason: "within-threshold" });
  });

  test("one record under 95% is refused", () => {
    // 95% of 14,980 is 14,231; 14,230 is the first count that should stop.
    const v = shrinkVerdict({
      remote: 14_980,
      next: 14_230,
      allowShrink: false,
    });
    expect(v).toMatchObject({ allowed: false, reason: "refused" });
  });

  test("the refusal names both counts, the percentage and the override", () => {
    const v = shrinkVerdict({
      remote: 14_980,
      next: 13_600,
      allowShrink: false,
    });
    expect(v.allowed).toBe(false);
    expect(v.message).toContain("13,600");
    expect(v.message).toContain("14,980");
    expect(v.message).toContain("90.8%");
    expect(v.message).toContain("--allow-shrink");
  });

  test("--allow-shrink lets a large drop through, and says so", () => {
    const v = shrinkVerdict({
      remote: 14_980,
      next: 13_600,
      allowShrink: true,
    });
    expect(v).toMatchObject({ allowed: true, reason: "override" });
    expect(v.message).toContain("90.8%");
  });

  test("rejects counts that are not non-negative integers", () => {
    for (const bad of [-1, 1.5, Number.NaN, "10", undefined]) {
      expect(() =>
        shrinkVerdict({ remote: 10, next: bad, allowShrink: false }),
      ).toThrow();
      expect(() =>
        shrinkVerdict({ remote: bad, next: 10, allowShrink: false }),
      ).toThrow();
    }
  });
});

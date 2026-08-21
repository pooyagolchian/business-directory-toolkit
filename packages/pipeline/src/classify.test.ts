import { describe, expect, test } from "vitest";
import type { TaxonomyMap } from "@directory/core";
import {
  batchCategories,
  buildClassificationPrompt,
  categoriesNeedingClassification,
  estimateCost,
  mergeTaxonomy,
  parseClassification,
} from "./classify";

const existing: TaxonomyMap = {
  Restaurant: { l1: "Food & Drink", l2: "Restaurants" },
};

describe("categoriesNeedingClassification", () => {
  test("skips categories already in the committed map", () => {
    // This is the whole cost saving: the LLM sees each string exactly once,
    // ever, across every future crawl.
    expect(
      categoriesNeedingClassification(["Restaurant", "Bakery"], existing),
    ).toEqual(["Bakery"]);
  });

  test("returns nothing when the map already covers the corpus", () => {
    expect(categoriesNeedingClassification(["Restaurant"], existing)).toEqual(
      [],
    );
  });

  test("deduplicates its input", () => {
    expect(
      categoriesNeedingClassification(["Bakery", "Bakery"], existing),
    ).toEqual(["Bakery"]);
  });
});

describe("mergeTaxonomy", () => {
  test("never overwrites a human correction with model output", () => {
    // data/taxonomy-map.json is fixable by pull request. Re-running the
    // classifier must not silently undo those fixes.
    const corrected: TaxonomyMap = {
      Bakery: { l1: "Food & Drink", l2: "Bakeries", l3: "Artisan" },
    };
    const modelOutput: TaxonomyMap = {
      Bakery: { l1: "Retail", l2: "Food Shops" },
    };
    expect(mergeTaxonomy(corrected, modelOutput).Bakery).toEqual(
      corrected.Bakery,
    );
  });

  test("adds categories the map did not have", () => {
    const merged = mergeTaxonomy(existing, {
      Bakery: { l1: "Food & Drink", l2: "Bakeries" },
    });
    expect(merged.Bakery?.l2).toBe("Bakeries");
    expect(merged.Restaurant?.l2).toBe("Restaurants");
  });
});

describe("batchCategories", () => {
  test("splits work into batches the model can handle in one call", () => {
    const categories = Array.from({ length: 120 }, (_, i) => `cat-${i}`);
    const batches = batchCategories(categories, 50);
    expect(batches).toHaveLength(3);
    expect(batches[0]).toHaveLength(50);
    expect(batches[2]).toHaveLength(20);
  });

  test("returns no batches for no work, so no request is made", () => {
    expect(batchCategories([], 50)).toEqual([]);
  });
});

describe("buildClassificationPrompt", () => {
  test("asks about the categories it was given", () => {
    const prompt = buildClassificationPrompt(["Shawarma restaurant"]);
    expect(prompt).toContain("Shawarma restaurant");
  });

  test("supplies the existing level-2 vocabulary so the model reuses it", () => {
    // Without this the model invents a new l2 per batch and the taxonomy
    // fragments into near-duplicate browse pages.
    const prompt = buildClassificationPrompt(
      ["Bakery"],
      ["Restaurants", "Cafes"],
    );
    expect(prompt).toContain("Restaurants");
    expect(prompt).toContain("Cafes");
  });

  test("tells the model it is in Dubai, so local vocabulary lands correctly", () => {
    expect(buildClassificationPrompt(["Cafeteria"]).toLowerCase()).toContain(
      "dubai",
    );
  });
});

describe("parseClassification", () => {
  test("reads a well-formed response", () => {
    const map = parseClassification(
      JSON.stringify([
        {
          category: "Bakery",
          l1: "Food & Drink",
          l2: "Bakeries",
          l3: "Artisan",
        },
      ]),
    );
    expect(map.Bakery).toEqual({
      l1: "Food & Drink",
      l2: "Bakeries",
      l3: "Artisan",
    });
  });

  test("tolerates the model wrapping JSON in prose or a code fence", () => {
    const map = parseClassification(
      'Here you go:\n```json\n[{"category":"Bakery","l1":"Food","l2":"Bakeries"}]\n```',
    );
    expect(map.Bakery?.l2).toBe("Bakeries");
  });

  test("omits l3 when the model did not supply one", () => {
    const map = parseClassification(
      JSON.stringify([{ category: "Bakery", l1: "Food", l2: "Bakeries" }]),
    );
    expect(map.Bakery).not.toHaveProperty("l3");
  });

  test("drops entries missing a required level rather than half-filing them", () => {
    const map = parseClassification(
      JSON.stringify([
        { category: "Bakery", l1: "Food" },
        { category: "Cafe", l1: "Food", l2: "Cafes" },
      ]),
    );
    expect(map.Bakery).toBeUndefined();
    expect(map.Cafe).toBeDefined();
  });

  test("throws on unparseable output rather than returning a silent empty map", () => {
    // Returning {} here would look like "nothing to classify" and quietly
    // leave the whole corpus untagged.
    expect(() => parseClassification("the model refused")).toThrow();
  });
});

describe("estimateCost", () => {
  test("prices a run from real token counts", () => {
    const cost = estimateCost({ inputTokens: 1_000_000, outputTokens: 0 });
    expect(cost.usd).toBeGreaterThan(0);
  });

  test("halves the price when the Batch API is used", () => {
    const normal = estimateCost({
      inputTokens: 1_000_000,
      outputTokens: 500_000,
    });
    const batch = estimateCost({
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      batch: true,
    });
    expect(batch.usd).toBeCloseTo(normal.usd / 2, 5);
  });

  test("reports marginal cost per 1,000 businesses as zero once mapped", () => {
    // The headline metric. A crawl that adds no new categories adds no tokens.
    const cost = estimateCost({ inputTokens: 0, outputTokens: 0 });
    expect(cost.usd).toBe(0);
  });
});

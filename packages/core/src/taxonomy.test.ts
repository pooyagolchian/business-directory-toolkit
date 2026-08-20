import { describe, expect, test } from "vitest";
import { applyTaxonomy, distinctCategories } from "./taxonomy.js";
import type { RawLocalResult, TaxonomyMap } from "./types.js";

const MAP: TaxonomyMap = {
  Restaurant: { l1: "Food & Drink", l2: "Restaurants" },
  "Seafood restaurant": {
    l1: "Food & Drink",
    l2: "Restaurants",
    l3: "Seafood",
  },
  "Steak house": { l1: "Food & Drink", l2: "Restaurants", l3: "Steakhouse" },
  "Cocktail bar": { l1: "Food & Drink", l2: "Bars", l3: "Cocktail" },
};

describe("applyTaxonomy", () => {
  test("prefers a specific category over a generic one", () => {
    // This is the real nine-category business from the probe. Mapping it to
    // the bare "Restaurant" would discard everything useful about it.
    const nineCategories: RawLocalResult = {
      type: "Restaurant",
      types: [
        "Restaurant",
        "Bar & grill",
        "Brunch restaurant",
        "Cocktail bar",
        "Live music bar",
        "Live music venue",
        "Oyster bar restaurant",
        "Seafood restaurant",
        "Steak house",
      ],
    };
    expect(applyTaxonomy(nineCategories, MAP)).toEqual({
      l1: "Food & Drink",
      l2: "Restaurants",
      l3: "Seafood",
    });
  });

  test("breaks ties by the order Google returned the categories", () => {
    // Both map at l3 depth; "Cocktail bar" comes first here so it wins.
    const r: RawLocalResult = { types: ["Cocktail bar", "Seafood restaurant"] };
    expect(applyTaxonomy(r, MAP)?.l3).toBe("Cocktail");
  });

  test("falls back to a generic mapping when nothing specific matches", () => {
    expect(applyTaxonomy({ types: ["Restaurant"] }, MAP)).toEqual({
      l1: "Food & Drink",
      l2: "Restaurants",
    });
  });

  test("uses the primary type field when types is absent", () => {
    expect(applyTaxonomy({ type: "Restaurant" }, MAP)?.l2).toBe("Restaurants");
  });

  test("returns null when no category maps, rather than inventing Other", () => {
    // Unmapped categories must surface for a real decision, never be buried.
    expect(applyTaxonomy({ types: ["Camel racing track"] }, MAP)).toBeNull();
  });

  test("returns null for a record with no categories at all", () => {
    expect(applyTaxonomy({}, MAP)).toBeNull();
  });
});

describe("distinctCategories", () => {
  test("collects the unique category vocabulary across a corpus", () => {
    const records: RawLocalResult[] = [
      { type: "Restaurant", types: ["Restaurant", "Seafood restaurant"] },
      { type: "Restaurant", types: ["Restaurant", "Steak house"] },
    ];
    expect(distinctCategories(records)).toEqual([
      "Restaurant",
      "Seafood restaurant",
      "Steak house",
    ]);
  });

  test("returns a sorted list so the mapping file diffs cleanly", () => {
    const records: RawLocalResult[] = [{ types: ["Zoo", "Bakery"] }];
    expect(distinctCategories(records)).toEqual(["Bakery", "Zoo"]);
  });

  test("is the input to the cost saving, so it must not repeat entries", () => {
    const records: RawLocalResult[] = Array.from({ length: 50 }, () => ({
      type: "Restaurant",
      types: ["Restaurant"],
    }));
    expect(distinctCategories(records)).toEqual(["Restaurant"]);
  });
});

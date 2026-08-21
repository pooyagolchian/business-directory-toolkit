import { describe, expect, test } from "vitest";
import { applyTaxonomy, distinctCategories } from "./taxonomy";
import type { RawLocalResult, TaxonomyMap } from "./types";

const MAP: TaxonomyMap = {
  Restaurant: { l1: "Food & Drink", l2: "Restaurants" },
  // "Bar & grill" sorts before "Seafood restaurant", so it is the category
  // that competes with — and wrongly beats — the right answer under a naive
  // first-match rule. It belongs in this map for the tests to mean anything.
  "Bar & grill": { l1: "Food & Drink", l2: "Restaurants", l3: "Grill" },
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
      description:
        "Upmarket venue for seafood & steak. Striking choice in the acclaimed Opus spotlighting steaks, oysters & seafood, plus cocktails & wine.",
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

  test("uses the description to pick between competing sub-categories", () => {
    // Measured: 85% of types[] tails come back alphabetically sorted, so array
    // order carries NO relevance signal. Taking the first match filed this
    // seafood-and-steak restaurant under "Grill", purely because "Bar & grill"
    // sorts before "Seafood restaurant". The business describes itself.
    const maine: RawLocalResult = {
      type: "Restaurant",
      types: ["Restaurant", "Bar & grill", "Seafood restaurant", "Steak house"],
      description:
        "Upmarket venue for seafood & steak. Striking choice in the acclaimed Opus spotlighting steaks, oysters & seafood, plus cocktails & wine.",
    };
    expect(applyTaxonomy(maine, MAP)?.l3).toBe("Seafood");
  });

  test("uses the title when the description is absent", () => {
    const r: RawLocalResult = {
      title: "Al Mahara Seafood",
      types: ["Restaurant", "Bar & grill", "Seafood restaurant"],
    };
    expect(applyTaxonomy(r, MAP)?.l3).toBe("Seafood");
  });

  test("falls back to array order when the text gives no signal at all", () => {
    // Deterministic rather than correct — and deliberately so. Without a
    // signal there is nothing better than a stable choice.
    const r: RawLocalResult = {
      type: "Restaurant",
      types: ["Restaurant", "Seafood restaurant", "Steak house"],
      description: "A place to eat.",
    };
    expect(applyTaxonomy(r, MAP)?.l3).toBe("Seafood");
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

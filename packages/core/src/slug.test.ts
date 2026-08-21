import { describe, expect, test } from "vitest";
import { toSlug } from "./slug";

// Titles below are verbatim from the live SearchApi Google Maps engine for
// Dubai on 2026-08-20. Dubai listings are messy: bilingual, punctuation-heavy,
// and sometimes marketing sentences rather than names.

const PLACE_A = "ChIJpabd1tppXz4RjwONpXIjsp8";
const PLACE_B = "ChIJqYf1NNVXwokR-YQOOco7kcE";

describe("toSlug", () => {
  test("lowercases and hyphenates a plain title", () => {
    expect(toSlug("Urla Restaurant & Lounge", PLACE_A)).toMatch(
      /^urla-restaurant-lounge-[a-z0-9]{6}$/,
    );
  });

  test("strips Arabic script but keeps the Latin part readable", () => {
    // "Shamiat Restaurant مطعم شاميات - Dubai"
    expect(toSlug("Shamiat Restaurant مطعم شاميات - Dubai", PLACE_A)).toMatch(
      /^shamiat-restaurant-dubai-[a-z0-9]{6}$/,
    );
  });

  test("folds accented Latin characters to ASCII", () => {
    // "Trèsind" must not become "tr-sind".
    expect(toSlug("Carnival by Trèsind", PLACE_A)).toMatch(
      /^carnival-by-tresind-[a-z0-9]{6}$/,
    );
  });

  test("drops apostrophes rather than turning them into hyphens", () => {
    expect(toSlug("O'lio Restaurant", PLACE_A)).toMatch(
      /^olio-restaurant-[a-z0-9]{6}$/,
    );
  });

  test("collapses runs of punctuation into a single hyphen", () => {
    expect(toSlug("Massimo's Italian Restaurant - City Walk", PLACE_A)).toMatch(
      /^massimos-italian-restaurant-city-walk-[a-z0-9]{6}$/,
    );
  });

  test("truncates a marketing-sentence title to a usable URL length", () => {
    const long =
      "Maison De Curry | Restaurant with the best views of Burj Khalifa & Dubai Fountains";
    const slug = toSlug(long, PLACE_A);
    expect(slug.length).toBeLessThanOrEqual(70);
    expect(slug).toMatch(/^maison-de-curry-/);
  });

  test("never emits doubled or dangling hyphens", () => {
    const long =
      "Maison De Curry | Restaurant with the best views of Burj Khalifa & Dubai Fountains";
    const slug = toSlug(long, PLACE_A);
    expect(slug).not.toMatch(/-{2,}/);
    expect(slug.startsWith("-")).toBe(false);
    expect(slug.endsWith("-")).toBe(false);
  });

  test("is deterministic for the same title and place", () => {
    expect(toSlug("Dunes Cafe", PLACE_A)).toBe(toSlug("Dunes Cafe", PLACE_A));
  });

  test("disambiguates two businesses that share a name", () => {
    // Chains are common in Dubai; identical titles must not collide.
    expect(toSlug("Dunes Cafe", PLACE_A)).not.toBe(
      toSlug("Dunes Cafe", PLACE_B),
    );
  });

  test("still produces a usable slug for a title with no Latin characters", () => {
    expect(toSlug("مطعم شاميات", PLACE_A)).toMatch(/^business-[a-z0-9]{6}$/);
  });

  test("still produces a usable slug for an empty title", () => {
    expect(toSlug("", PLACE_A)).toMatch(/^business-[a-z0-9]{6}$/);
  });
});

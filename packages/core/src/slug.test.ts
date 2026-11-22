import { describe, expect, test } from "vitest";
import { buildSlugIndex, resolveSlug, toSlug } from "./slug";

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

describe("resolveSlug", () => {
  // Real renames from the 2026-11-22 Dubai re-crawl: Google renamed the
  // listing, so the readable prefix changed while the place_id suffix did not.
  const wyndham = {
    slug: toSlug("Wyndham Downtown Dubai", PLACE_A),
    title: "Wyndham Downtown Dubai",
  };
  const other = { slug: toSlug("Dunes Cafe", PLACE_B), title: "Dunes Cafe" };
  const index = buildSlugIndex([wyndham, other]);
  const oldSlug = `${toSlug("Ramada by Wyndham Downtown Dubai", PLACE_A)}`;

  test("finds an exact slug and marks it canonical", () => {
    expect(resolveSlug(wyndham.slug, index)).toEqual({
      business: wyndham,
      canonical: true,
    });
  });

  test("finds a renamed business by its place_id suffix, not canonical", () => {
    // The old URL is still in Google's index; it must land on the new page.
    expect(oldSlug).not.toBe(wyndham.slug);
    expect(resolveSlug(oldSlug, index)).toEqual({
      business: wyndham,
      canonical: false,
    });
  });

  test("returns undefined for an unknown suffix", () => {
    // A taken-down business is absent from the data, so its old slug must
    // fall through to a 404 rather than redirect anywhere.
    expect(resolveSlug("velokar-auto-repairing-f3w1vx", index)).toBeUndefined();
  });

  test("refuses to guess when two businesses share a suffix", () => {
    const twin = { slug: `twin-${wyndham.slug.slice(-6)}`, title: "Twin" };
    const ambiguous = buildSlugIndex([wyndham, twin]);
    expect(
      resolveSlug(`renamed-${wyndham.slug.slice(-6)}`, ambiguous),
    ).toBeUndefined();
    // An exact match still wins over the ambiguity.
    expect(resolveSlug(twin.slug, ambiguous)?.canonical).toBe(true);
  });

  test("ignores slugs that do not end in a 6-character suffix", () => {
    for (const bad of [
      "",
      "wyndham",
      "wyndham-abc",
      "wyndham-ABCDEF",
      `-${"x".repeat(7)}`,
    ]) {
      expect(resolveSlug(bad, index)).toBeUndefined();
    }
  });
});

import { describe, expect, test } from "vitest";
import { toItems, typeaheadPrefixes } from "./items";
import type { Business } from "./normalize";

const business: Business = {
  placeId: "ChIJpabd1tppXz4RjwONpXIjsp8",
  slug: "the-maine-land-brasserie-abc123",
  title: "The MAINE Land Brasserie",
  area: "business-bay",
  phoneRaw: "04 577 6680",
  phoneE164: "+97145776680",
  phoneType: "landline",
  rating: 4.8,
  reviews: 2060,
  l1: "Food & Drink",
  l2: "Restaurants",
  l3: "Seafood",
  types: ["Restaurant", "Seafood restaurant"],
};

const mainItem = (b: Business) => toItems(b).find((i) => i.SK === "A#META")!;

describe("toItems", () => {
  test("keys the business on its place_id", () => {
    expect(mainItem(business).PK).toBe("BIZ#ChIJpabd1tppXz4RjwONpXIjsp8");
  });

  test("indexes the phone for reverse lookup", () => {
    const item = mainItem(business);
    expect(item.GSI1PK).toBe("PH#+97145776680");
    expect(item.GSI1SK).toBe("BIZ#ChIJpabd1tppXz4RjwONpXIjsp8");
  });

  test("omits the phone index entirely when there is no phone", () => {
    const { phoneE164, ...noPhone } = business;
    void phoneE164;
    expect(mainItem(noPhone as Business).GSI1PK).toBeUndefined();
  });

  test("indexes category and area together for the SEO browse pages", () => {
    expect(mainItem(business).GSI2PK).toBe("CAT#Restaurants#AREA#business-bay");
  });

  test("sorts popular businesses first within a browse page", () => {
    // DynamoDB sorts ascending, so the sort key must invert review count.
    const popular = mainItem(business).GSI2SK!;
    const quiet = mainItem({ ...business, reviews: 12 }).GSI2SK!;
    expect(popular < quiet).toBe(true);
  });

  test("still sorts a business that has no reviews, placing it last", () => {
    const { reviews, ...noReviews } = business;
    void reviews;
    const withReviews = mainItem(business).GSI2SK!;
    const without = mainItem(noReviews as Business).GSI2SK!;
    expect(withReviews < without).toBe(true);
  });

  test("omits the browse index when the taxonomy is unmapped", () => {
    const { l2, ...unmapped } = business;
    void l2;
    expect(mainItem(unmapped as Business).GSI2PK).toBeUndefined();
  });

  test("never emits an undefined attribute value, which DynamoDB rejects", () => {
    const { phoneE164, l2, rating, ...sparse } = business;
    void phoneE164;
    void l2;
    void rating;
    for (const item of toItems(sparse as Business)) {
      for (const [key, value] of Object.entries(item)) {
        expect(value, `${key} was undefined`).toBeDefined();
      }
    }
  });

  test("emits typeahead items alongside the business", () => {
    const prefixItems = toItems(business).filter((i) =>
      String(i.PK).startsWith("PFX#"),
    );
    expect(prefixItems.length).toBeGreaterThan(0);
  });

  test("denormalises enough onto a typeahead item to render with no extra read", () => {
    const prefixItem = toItems(business).find((i) =>
      String(i.PK).startsWith("PFX#"),
    )!;
    expect(prefixItem.title).toBe("The MAINE Land Brasserie");
    expect(prefixItem.slug).toBe("the-maine-land-brasserie-abc123");
  });
});

describe("typeaheadPrefixes", () => {
  test("indexes 2-to-4 character prefixes of each word", () => {
    expect(typeaheadPrefixes("Dunes Cafe")).toEqual(
      expect.arrayContaining(["du", "dun", "dune", "ca", "caf", "cafe"]),
    );
  });

  test("indexes Arabic tokens, since Dubai titles are bilingual", () => {
    // "Shamiat Restaurant مطعم شاميات"
    const prefixes = typeaheadPrefixes("Shamiat مطعم");
    expect(prefixes.some((p) => /[؀-ۿ]/.test(p))).toBe(true);
  });

  test("ignores one-character words, which match far too much", () => {
    expect(typeaheadPrefixes("A Cafe")).not.toContain("a");
  });

  test("deduplicates prefixes shared by two words", () => {
    const prefixes = typeaheadPrefixes("Cafe Cafeteria");
    expect(prefixes.filter((p) => p === "caf")).toHaveLength(1);
  });

  test("caps output so one long title cannot flood the index", () => {
    const long =
      "The Great Big Wonderful Amazing Spectacular Dubai Restaurant Company Limited";
    expect(typeaheadPrefixes(long).length).toBeLessThanOrEqual(30);
  });

  test("returns nothing for an empty title", () => {
    expect(typeaheadPrefixes("")).toEqual([]);
  });
});

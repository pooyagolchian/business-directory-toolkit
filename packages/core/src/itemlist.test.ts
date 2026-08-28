import { describe, expect, test } from "vitest";
import { itemListJsonLd } from "./itemlist";

const BASE = "https://directory.pooyagolchian.com";

/**
 * Every test here is really the same test asked five ways: the markup describes
 * the rows on the page, and nothing else. The count a listing page knows
 * (facet.count — 1,164 restaurants) and the count it renders (PAGE_SIZE — 120)
 * are different numbers, and only the second one is true of the document.
 */
describe("itemListJsonLd", () => {
  test("numbers positions from 1, as schema.org requires", () => {
    const json = itemListJsonLd(
      [
        { name: "Atlantis The Palm", url: "/business/atlantis-the-palm-7f2a" },
        { name: "Burj Al Arab", url: "/business/burj-al-arab-91c3" },
        { name: "Jumeirah Beach Hotel", url: "/business/jumeirah-beach-4d80" },
      ],
      BASE,
    );
    expect(json?.itemListElement.map((i) => i.position)).toEqual([1, 2, 3]);
  });

  /**
   * The rows carry root-relative hrefs because that is what <a href> takes.
   * Structured data has no document to resolve against, so the base is applied
   * here rather than left to a crawler to guess.
   */
  test("resolves each href against the site base", () => {
    const json = itemListJsonLd(
      [{ name: "Ravi Restaurant", url: "/business/ravi-restaurant-1a2b" }],
      BASE,
    );
    expect(json?.itemListElement[0]?.url).toBe(
      `${BASE}/business/ravi-restaurant-1a2b`,
    );
  });

  test("tolerates a base URL with a trailing slash without doubling it", () => {
    const json = itemListJsonLd(
      [{ name: "Al Mallah", url: "/business/al-mallah-33fe" }],
      `${BASE}/`,
    );
    expect(json?.itemListElement[0]?.url).toBe(
      `${BASE}/business/al-mallah-33fe`,
    );
  });

  /**
   * An ItemList with no items describes nothing while still costing a
   * validation surface. Returning null lets the page skip the <script>, the
   * same contract breadcrumbJsonLd offers for a trail too short to be one.
   */
  test("returns null for an empty list", () => {
    expect(itemListJsonLd([], BASE)).toBeNull();
  });

  /**
   * Titles arrive from Google Maps and are routinely bilingual. The name must
   * survive verbatim — serializeJsonLd does the escaping, so nothing here may
   * pre-mangle, transliterate or strip the Arabic.
   */
  test("passes a bilingual title through unchanged", () => {
    const title = "Shamiat Restaurant مطعم شاميات - Dubai";
    const json = itemListJsonLd(
      [{ name: title, url: "/business/shamiat-5b71" }],
      BASE,
    );
    expect(json?.itemListElement[0]?.name).toBe(title);
  });

  /**
   * THE rule. /category/[l2] renders `.slice(0, PAGE_SIZE)` of a facet that may
   * hold 1,164 businesses, so the list it hands over is 120 long and the markup
   * must be 120 entries. Claiming the facet count on a page showing a page of
   * it is the same class of violation as marking up Google's rating as our own.
   */
  test("marks up exactly the rows it was handed, never a larger total", () => {
    const rendered = [
      { name: "One", url: "/business/one" },
      { name: "Two", url: "/business/two" },
      { name: "Three", url: "/business/three" },
    ];
    const json = itemListJsonLd(rendered, BASE);
    expect(json?.itemListElement).toHaveLength(3);
    expect(json?.itemListElement.map((i) => i.name)).toEqual([
      "One",
      "Two",
      "Three",
    ]);
    // No count field anywhere for a caller to fill with the facet total.
    expect(json).not.toHaveProperty("numberOfItems");
  });

  test("names the list when given a name, and omits the key when not", () => {
    const items = [{ name: "Ravi Restaurant", url: "/business/ravi-1a2b" }];
    const named = itemListJsonLd(items, BASE, {
      name: "Restaurants in Al Barsha",
    });
    expect(named?.name).toBe("Restaurants in Al Barsha");
    expect(itemListJsonLd(items, BASE)).not.toHaveProperty("name");
  });

  test("declares the schema.org type on the list and on every entry", () => {
    const json = itemListJsonLd(
      [{ name: "Ravi Restaurant", url: "/business/ravi-1a2b" }],
      BASE,
    );
    expect(json?.["@context"]).toBe("https://schema.org");
    expect(json?.["@type"]).toBe("ItemList");
    expect(json?.itemListElement[0]?.["@type"]).toBe("ListItem");
  });
});

/**
 * Everything above tests a well-formed row. These test the rows that are not,
 * because the standing rule in this codebase is that a wrong claim costs more
 * than a missing one — it is why the LocalBusiness node omits aggregateRating
 * rather than pass Google's stars off as first-party reviews.
 *
 * The whole corpus of 14,981 records satisfies the happy path today: every
 * title is non-blank, every slug is present and unique, so all 14,981 entries
 * come out with a real name and a distinct URL. None of that is enforced by a
 * type, and `${base}${url}` will concatenate anything it is handed.
 */
describe("itemListJsonLd — entries it cannot honestly describe", () => {
  /**
   * The dangerous one, because the output is a perfectly valid URL and so no
   * validator will ever flag it. An empty href resolves to the site root, which
   * says the first restaurant in Al Barsha is the homepage.
   */
  test("omits url rather than resolve an empty href to the site root", () => {
    const json = itemListJsonLd([{ name: "Ghost", url: "" }], BASE);
    expect(json?.itemListElement[0]).not.toHaveProperty("url");
    expect(json?.itemListElement[0]?.name).toBe("Ghost");
    expect(json?.itemListElement[0]?.position).toBe(1);
  });

  /**
   * `${base}${url}` on an absolute href produces
   * `https://directory.pooyagolchian.comhttps://example.com/x` — a string that
   * is not a URL at all, asserted as one.
   */
  test("omits url rather than concatenate an absolute href onto the base", () => {
    const json = itemListJsonLd(
      [{ name: "Elsewhere", url: "https://example.com/x" }],
      BASE,
    );
    expect(json?.itemListElement[0]).not.toHaveProperty("url");
  });

  /**
   * `//example.com/x` is protocol-relative: as an <a href> the browser sends
   * the visitor off-site, while `${base}//example.com/x` claims a path on our
   * own host. Markup and rendered link disagreeing is the exact failure this
   * module exists to prevent.
   */
  test("omits url for a protocol-relative href, which the page sends off-site", () => {
    const json = itemListJsonLd(
      [{ name: "Elsewhere", url: "//example.com/x" }],
      BASE,
    );
    expect(json?.itemListElement[0]).not.toHaveProperty("url");
  });

  test("omits url for an href with no leading slash, which would fuse into the host", () => {
    const json = itemListJsonLd([{ name: "X", url: "business/x" }], BASE);
    expect(json?.itemListElement[0]).not.toHaveProperty("url");
  });

  /**
   * `name: ""` is not a name, it is an assertion that this item is called
   * nothing. The key comes off, exactly as breadcrumbJsonLd drops `item` from a
   * crumb with nowhere to point.
   */
  test("omits name for a blank or whitespace-only title", () => {
    const blank = itemListJsonLd([{ name: "", url: "/business/x" }], BASE);
    expect(blank?.itemListElement[0]).not.toHaveProperty("name");
    expect(blank?.itemListElement[0]?.url).toBe(`${BASE}/business/x`);

    const spaces = itemListJsonLd([{ name: "   ", url: "/business/x" }], BASE);
    expect(spaces?.itemListElement[0]).not.toHaveProperty("name");
  });

  /**
   * The guard was `if (options.name)`, which catches "" and nothing else. A
   * template that interpolates an empty label — `` `${facet.label} in Dubai` ``
   * with no facet — yields " in Dubai"; a template that yields only whitespace
   * would have been emitted as the list's name.
   */
  test("ignores a whitespace-only list name, and trims the one it keeps", () => {
    const items = [{ name: "Ravi Restaurant", url: "/business/ravi-1a2b" }];
    expect(itemListJsonLd(items, BASE, { name: "   " })).not.toHaveProperty(
      "name",
    );
    expect(itemListJsonLd(items, BASE, { name: "  Restaurants  " })?.name).toBe(
      "Restaurants",
    );
  });

  /**
   * A degraded entry is never dropped. Dropping one would renumber everything
   * below it, and the markup would stop describing the rows the visitor sees —
   * which is the module's entire contract. The position slot is kept and says,
   * honestly, that there is a third item nothing more can be said about.
   */
  test("keeps positions contiguous when an entry cannot be described", () => {
    const json = itemListJsonLd(
      [
        { name: "One", url: "/business/one" },
        { name: "", url: "" },
        { name: "Three", url: "/business/three" },
      ],
      BASE,
    );
    expect(json?.itemListElement.map((i) => i.position)).toEqual([1, 2, 3]);
    expect(json?.itemListElement[1]).toEqual({
      "@type": "ListItem",
      position: 2,
    });
    expect(json?.itemListElement[2]?.name).toBe("Three");
  });

  /**
   * Whitespace around an href is a call-site typo, not a different page. It is
   * trimmed rather than turned into `${base}/business/x%20` — but the name is
   * NOT trimmed anywhere above, because a title is data from Google Maps and
   * this module's job is to pass it through, not tidy it.
   */
  test("trims whitespace around an href before resolving it", () => {
    const json = itemListJsonLd([{ name: "X", url: "  /business/x  " }], BASE);
    expect(json?.itemListElement[0]?.url).toBe(`${BASE}/business/x`);
  });
});

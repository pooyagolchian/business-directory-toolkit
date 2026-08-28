import { describe, expect, test } from "vitest";
import { breadcrumbJsonLd } from "./breadcrumbs";

const BASE = "https://directory.pooyagolchian.com";

/**
 * The visible breadcrumb and its markup are built from one array, so the two
 * cannot disagree. These tests pin the contract that lets that be true.
 */
describe("breadcrumbJsonLd", () => {
  test("numbers positions from 1, as schema.org requires", () => {
    const json = breadcrumbJsonLd(
      [
        { href: "/", label: "Home" },
        { href: "/areas", label: "Areas" },
        { label: "Al Barsha" },
      ],
      BASE,
    );
    expect(json?.itemListElement.map((i) => i.position)).toEqual([1, 2, 3]);
  });

  test("resolves each href against the site base", () => {
    const json = breadcrumbJsonLd(
      [
        { href: "/", label: "Home" },
        { href: "/area/al-barsha", label: "Al Barsha" },
        { label: "Restaurants" },
      ],
      BASE,
    );
    expect(json?.itemListElement[0]?.item).toBe(`${BASE}/`);
    expect(json?.itemListElement[1]?.item).toBe(`${BASE}/area/al-barsha`);
  });

  /**
   * The last crumb is the page you are already on. Google's guidance is that it
   * carries no `item`, and giving it a self-link is the most common way this
   * markup gets flagged.
   */
  test("omits item on the final crumb", () => {
    const json = breadcrumbJsonLd(
      [{ href: "/", label: "Home" }, { label: "Atlantis - The Palm" }],
      BASE,
    );
    const last = json?.itemListElement.at(-1);
    expect(last?.name).toBe("Atlantis - The Palm");
    expect(last).not.toHaveProperty("item");
  });

  /**
   * A single crumb is not a trail, and marking one up says nothing while still
   * costing a validation surface. Returning null lets the component skip the
   * script entirely rather than emit an empty list.
   */
  test("returns null for a trail too short to describe a hierarchy", () => {
    expect(breadcrumbJsonLd([], BASE)).toBeNull();
    expect(breadcrumbJsonLd([{ label: "Home" }], BASE)).toBeNull();
  });

  /**
   * A crumb with no href in the middle of a trail has no URL to point at.
   * Emitting `item: undefined` would serialise the key away silently; emitting
   * the base URL would be a lie. It simply carries a name.
   */
  test("omits item on a mid-trail crumb that has no href", () => {
    const json = breadcrumbJsonLd(
      [{ href: "/", label: "Home" }, { label: "Ungrouped" }, { label: "Leaf" }],
      BASE,
    );
    expect(json?.itemListElement[1]).not.toHaveProperty("item");
    expect(json?.itemListElement[1]?.name).toBe("Ungrouped");
  });

  test("tolerates a base URL with a trailing slash without doubling it", () => {
    const json = breadcrumbJsonLd(
      [{ href: "/areas", label: "Areas" }, { label: "Deira" }],
      `${BASE}/`,
    );
    expect(json?.itemListElement[0]?.item).toBe(`${BASE}/areas`);
  });

  /**
   * Business titles reach this from Google and are routinely bilingual. The
   * name must survive verbatim — serializeJsonLd handles the escaping, so this
   * must not pre-mangle anything.
   */
  test("passes a bilingual title through unchanged", () => {
    const title = "Shamiat Restaurant مطعم شاميات - Dubai";
    const json = breadcrumbJsonLd(
      [{ href: "/", label: "Home" }, { label: title }],
      BASE,
    );
    expect(json?.itemListElement[1]?.name).toBe(title);
  });

  test("declares the schema.org type", () => {
    const json = breadcrumbJsonLd(
      [{ href: "/", label: "Home" }, { label: "Areas" }],
      BASE,
    );
    expect(json?.["@context"]).toBe("https://schema.org");
    expect(json?.["@type"]).toBe("BreadcrumbList");
  });
});

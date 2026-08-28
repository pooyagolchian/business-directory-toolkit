import { describe, expect, test } from "vitest";
import { DESCRIPTION_MAX, businessDescription } from "./meta";

const base = {
  title: "Atlantis - The Palm",
  what: "Hotels",
  area: "Palm Jumeirah",
  city: "Dubai",
};

/**
 * The meta description for the largest page tier on the site — 14,981 URLs.
 *
 * The frame it replaces was `${title} is a ${what.toLowerCase()} in ${where}`,
 * which produced "Atlantis - The Palm is a hotels in Palm Jumeirah" on 9,102
 * pages: taxonomy labels are plural, so the article never agreed. An appositive
 * takes no article at all, which is why the whole class of agreement bugs —
 * plural nouns and vowel-initial nouns alike — disappears rather than being
 * special-cased one at a time.
 */
describe("businessDescription", () => {
  test("uses an appositive, so a plural category needs no article", () => {
    const out = businessDescription(base);
    expect(out).not.toMatch(/is a hotels/);
    expect(out).toContain(
      "Atlantis - The Palm — Hotels in Palm Jumeirah, Dubai.",
    );
  });

  test("a vowel-initial category needs no 'an' either", () => {
    const out = businessDescription({ ...base, what: "Opticians" });
    expect(out).not.toMatch(/\bis an?\b/);
    expect(out).toContain("Opticians in Palm Jumeirah, Dubai.");
  });

  test("keeps the category label's own casing rather than lowercasing it", () => {
    // Lowercasing only ever existed to serve "is a …". Without the article the
    // label reads as the proper noun the taxonomy made it.
    expect(businessDescription(base)).toContain("— Hotels in");
  });

  test("drops the category clause entirely when the taxonomy has no label", () => {
    const out = businessDescription({ ...base, what: undefined });
    expect(out).toContain("Atlantis - The Palm — Palm Jumeirah, Dubai.");
    expect(out).not.toContain("undefined");
    expect(out).not.toContain("Business");
  });

  test("includes the phone as the reader would dial it, not in E.164", () => {
    const out = businessDescription({ ...base, phoneRaw: "04 426 2000" });
    expect(out).toContain("Phone 04 426 2000.");
  });

  test("appends the address when there is room", () => {
    const out = businessDescription({
      ...base,
      phoneRaw: "04 426 2000",
      address: "Crescent Rd, Palm Jumeirah",
    });
    expect(out).toContain("Crescent Rd, Palm Jumeirah");
  });

  // ------------------------------------------------------------ the length cap

  test("stays inside the cap on a record that used to run to 343 characters", () => {
    const out = businessDescription({
      title: "Al Maktoum International Airport Passenger Terminal Building",
      what: "Airports",
      area: "Jebel Ali",
      city: "Dubai",
      phoneRaw: "04 887 2222",
      address:
        "Dubai World Central, Jebel Ali, Airport Rd, near Expo 2020 site, PO Box 12345, Dubai, United Arab Emirates",
    });
    expect(out.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });

  /**
   * The phone is the single most useful fact in a directory snippet, and half a
   * phone number is worse than none. When something has to go, it is the tail
   * of the address.
   */
  test("truncates the address, never the phone", () => {
    const out = businessDescription({
      title: "A".repeat(60),
      what: "Restaurants",
      area: "Business Bay",
      city: "Dubai",
      phoneRaw: "04 123 4567",
      address: "B".repeat(120),
    });
    expect(out).toContain("Phone 04 123 4567.");
    expect(out.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });

  test("drops the address rather than emitting a useless stub of it", () => {
    const out = businessDescription({
      title: "C".repeat(100),
      what: "Restaurants",
      area: "Business Bay",
      city: "Dubai",
      phoneRaw: "04 123 4567",
      address: "Somewhere along a very long road indeed",
    });
    expect(out).not.toContain("Somewhere");
    expect(out).toContain("Phone 04 123 4567.");
  });

  test("truncates the address at a word boundary, not mid-word", () => {
    const out = businessDescription({
      ...base,
      address:
        "Sheikh Zayed Road opposite the Dubai World Trade Centre roundabout, Trade Centre 2, near the Museum of the Future",
    });
    const tail = out.slice(out.indexOf("Sheikh"));
    expect(tail).toMatch(/…$/);
    // Whatever survives is whole words, with no space stranded before the ellipsis.
    expect(tail.replace(/…$/, "")).not.toMatch(/\s$/);
    expect(out.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });

  /**
   * A title alone can exceed the cap. Truncating a business name is worse than
   * a long description — Google rewrites descriptions freely, and a mangled
   * name is what a reader actually notices.
   */
  test("never truncates the title, even when it alone blows the cap", () => {
    const title = "D".repeat(200);
    const out = businessDescription({ ...base, title });
    expect(out).toContain(title);
  });

  // ------------------------------------------------------------ hygiene

  test("collapses newlines and runs of whitespace in an address", () => {
    const out = businessDescription({
      ...base,
      address: "Shop 4,\n  Marina Walk\t\tTower",
    });
    expect(out).toContain("Shop 4, Marina Walk Tower");
    expect(out).not.toMatch(/[\n\t]/);
  });

  test("passes a bilingual title through verbatim", () => {
    const title = "Shamiat Restaurant مطعم شاميات - Dubai";
    expect(businessDescription({ ...base, title })).toContain(title);
  });

  test("leaves an ampersand alone — React escapes it correctly in the tag", () => {
    const out = businessDescription({ ...base, title: "Bloom & Petal" });
    expect(out).toContain("Bloom & Petal");
    expect(out).not.toContain("&amp;");
  });

  test("emits no double spaces and no leading space when fields are missing", () => {
    const out = businessDescription({ ...base, phoneRaw: undefined });
    expect(out).not.toMatch(/ {2}/);
    expect(out).toBe(out.trim());
  });
});

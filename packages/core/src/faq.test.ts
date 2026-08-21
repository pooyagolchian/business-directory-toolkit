import { describe, expect, test } from "vitest";
import { buildFaq } from "./faq";

/**
 * An FAQ block is only worth having if every answer comes from this page's own
 * data. A generic "What are the opening hours?" repeated across 800 pages is
 * the definition of thin content, and it is the pattern Google's
 * helpful-content system targets — it would cost rankings, not earn them.
 *
 * So every question here is generated only when the data can answer it, and
 * the answer contains a number this page actually knows.
 */
const businesses = [
  {
    title: "A",
    rating: 4.8,
    reviews: 900,
    phoneE164: "+97141",
    openHours: { monday: "Open 24 hours" },
    accessibility: ["wheelchair-accessible-entrance"],
  },
  {
    title: "B",
    rating: 4.2,
    reviews: 120,
    phoneE164: "+97142",
    openHours: { monday: "9 AM–9 PM" },
  },
  {
    title: "C",
    rating: 3.9,
    reviews: 40,
    accessibility: ["wheelchair-accessible-entrance"],
  },
];

const ctx = { category: "Pharmacies", area: "Deira", businesses };

describe("buildFaq", () => {
  test("answers how many, with the real count", () => {
    const faq = buildFaq(ctx);
    const q = faq.find((f) => /how many/i.test(f.question));
    expect(q?.answer).toContain("3");
  });

  test("names the highest-rated business, not a placeholder", () => {
    const faq = buildFaq(ctx);
    expect(faq.some((f) => f.answer.includes("A"))).toBe(true);
  });

  test("answers the accessibility question from real attributes", () => {
    // The differentiator: Google has this data but buries it.
    const faq = buildFaq(ctx);
    const q = faq.find((f) => /wheelchair|accessible/i.test(f.question));
    expect(q).toBeDefined();
    expect(q?.answer).toContain("2");
  });

  test("omits the accessibility question when nothing has the attribute", () => {
    const faq = buildFaq({ ...ctx, businesses: [{ title: "X", rating: 4 }] });
    expect(faq.some((f) => /wheelchair|accessible/i.test(f.question))).toBe(
      false,
    );
  });

  test("answers the 24-hour question only when something is open 24 hours", () => {
    const faq = buildFaq(ctx);
    expect(faq.some((f) => /24 hours/i.test(f.question))).toBe(true);

    const noneOpen = buildFaq({
      ...ctx,
      businesses: [{ title: "X", openHours: { monday: "9 AM–5 PM" } }],
    });
    expect(noneOpen.some((f) => /24 hours/i.test(f.question))).toBe(false);
  });

  test("reports how many list a phone number", () => {
    const faq = buildFaq(ctx);
    const q = faq.find((f) => /phone/i.test(f.question));
    expect(q?.answer).toContain("2");
  });

  test("names the place in every question, so no two pages share one", () => {
    // Identical questions across 800 URLs is duplicate content.
    for (const entry of buildFaq(ctx)) {
      expect(entry.question).toMatch(/Deira|Pharmacies/i);
    }
  });

  test("returns nothing at all for an empty page", () => {
    expect(buildFaq({ ...ctx, businesses: [] })).toEqual([]);
  });

  test("works without an area, for a city-wide category page", () => {
    const faq = buildFaq({ category: "Pharmacies", businesses });
    expect(faq.length).toBeGreaterThan(0);
    expect(faq.every((f) => !/undefined/.test(f.question + f.answer))).toBe(
      true,
    );
  });
});

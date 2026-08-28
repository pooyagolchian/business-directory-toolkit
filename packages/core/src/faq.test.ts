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
 *
 * Two further properties are easy to lose in an edit and expensive to lose in
 * production, so they have tests of their own below: the city is whatever the
 * caller serves rather than a literal (ADR 0005 — a city is data, not code),
 * and no answer describes a feature the site does not render.
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

const ctx = {
  category: "Pharmacies",
  area: "Deira",
  city: "Dubai",
  businesses,
};

/** A neighbourhood hub: one area, every category, so no category noun. */
const hub = { area: "Al Barsha", city: "Dubai", businesses };

/**
 * Affordances this site does not have, in the words an answer would use to
 * promise them.
 *
 * This tripwire exists because of a specific escape. The accessibility answer
 * ends "Each listing page shows which features it reports" — a first-party,
 * machine-readable claim inside FAQPage markup on ~800 URLs — and for months no
 * listing page rendered accessibility at all. The data was there; the page was
 * not. It is true today only because
 * packages/web/app/business/[slug]/page.tsx grew the section.
 *
 * The rule that follows: an answer may describe another page only after
 * somebody has opened that page and checked. These patterns are the promises
 * nobody has checked, so nothing may make them.
 */
const UNRENDERED = [
  /filter (them |these |the results )?by/i,
  /sort(ed)? (them |these )?by/i,
  /\bon the map\b/i,
  /\bdownload\b/i,
  /\bexport\b/i,
  /\bbook\b/i,
  /leave a review/i,
  /\bopen now\b/i,
];

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
    const faq = buildFaq({ category: "Pharmacies", city: "Dubai", businesses });
    expect(faq.length).toBeGreaterThan(0);
    expect(faq.every((f) => !/undefined/.test(f.question + f.answer))).toBe(
      true,
    );
  });

  describe("the city is data, not code", () => {
    test("names the caller's city, and never Dubai's dialling code either", () => {
      // The bug this guards: packages/core is the reusable layer of a toolkit
      // whose central claim is that a city is data (ADR 0005). A fork crawling
      // Lisbon must not publish answers announcing Dubai — or +971, which is
      // the same defect wearing a different hat.
      const faq = buildFaq({ ...ctx, area: "Alfama", city: "Lisbon" });
      expect(faq.length).toBeGreaterThan(0);

      for (const entry of faq) {
        expect(entry.question).toContain("Lisbon");
        expect(entry.question + entry.answer).not.toMatch(/Dubai|\+971/);
      }
    });

    test("names the city alone on a page with no area", () => {
      const faq = buildFaq({
        category: "Pharmacies",
        city: "Lisbon",
        businesses,
      });
      const q = faq.find((f) => /how many/i.test(f.question));
      expect(q?.answer).toContain("pharmacies in Lisbon");
    });

    test("emits nothing when it cannot name a place at all", () => {
      // Every question is unique only because it says where it is about. With
      // no area and no city there is nowhere to name, so the questions would be
      // both malformed and shared — the duplication this file exists to avoid.
      expect(
        buildFaq({ category: "Pharmacies", city: "  ", businesses }),
      ).toEqual([]);
    });
  });

  describe("neighbourhood hub, with no category", () => {
    test("asks about the neighbourhood itself, counting its listings", () => {
      // 40 area hubs render 120 rows and 62 category facets each and had no FAQ
      // at all, because `category` used to be required. Nothing about these
      // questions needs a category — the subject is simply the listings.
      const faq = buildFaq(hub);
      const q = faq.find((f) => /how many/i.test(f.question));
      expect(q?.question).toContain("Al Barsha");
      expect(q?.answer).toContain("3");
      expect(q?.answer).toContain("businesses");
    });

    test("names the place in every hub question too", () => {
      const faq = buildFaq(hub);
      expect(faq.length).toBeGreaterThan(3);
      for (const entry of faq) {
        expect(entry.question).toContain("Al Barsha, Dubai");
        expect(entry.question + entry.answer).not.toMatch(/undefined|\s,/);
      }
    });

    test("keeps the 50-review gate on the highest-rated claim", () => {
      // A 5.0 from two reviews is not the best business in a neighbourhood, and
      // calling it that in structured data is worse than saying nothing.
      const faq = buildFaq({
        ...hub,
        businesses: [
          { title: "Two reviews", rating: 5, reviews: 2 },
          { title: "Credible", rating: 4.1, reviews: 300 },
        ],
      });
      const q = faq.find((f) => /rated highest/i.test(f.question));
      expect(q?.answer).toContain("Credible");
      expect(q?.answer).not.toContain("Two reviews");
      expect(q?.answer).toMatch(/Google/);
    });

    test("omits the highest-rated claim when nothing clears the gate", () => {
      const faq = buildFaq({
        ...hub,
        businesses: [{ title: "Two reviews", rating: 5, reviews: 2 }],
      });
      expect(faq.some((f) => /rated highest/i.test(f.question))).toBe(false);
    });

    test("counts accessibility and phones for the hub as well", () => {
      const faq = buildFaq(hub);
      expect(
        faq.find((f) => /wheelchair|accessible/i.test(f.question))?.answer,
      ).toContain("2");
      expect(faq.find((f) => /phone/i.test(f.question))?.answer).toContain("2");
    });

    test("returns nothing at all for an empty hub", () => {
      expect(buildFaq({ ...hub, businesses: [] })).toEqual([]);
    });
  });

  test("no answer promises a feature the site does not render", () => {
    for (const entry of [...buildFaq(ctx), ...buildFaq(hub)]) {
      for (const promise of UNRENDERED) {
        expect(entry.answer).not.toMatch(promise);
      }
    }
  });
});

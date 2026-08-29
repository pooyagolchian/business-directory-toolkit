import { describe, expect, test } from "vitest";
import { buildFaq, faqJsonLd } from "./faq";

/**
 * An FAQ block is only worth having if every answer comes from this page's own
 * data. A generic "What are the opening hours?" repeated across 800 pages is
 * the definition of thin content, and it is the pattern Google's
 * helpful-content system targets — it would cost rankings, not earn them.
 *
 * So every question here is generated only when the data can answer it, and
 * the answer contains a number this page actually knows.
 *
 * Four further properties are easy to lose in an edit and expensive to lose in
 * production, so they have tests of their own below: the city is whatever the
 * caller serves rather than a literal (ADR 0005 — a city is data, not code),
 * the category label is data on the same terms and is never inflected, every
 * sentence agrees with the number it carries, and no answer describes a feature
 * the site does not render.
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
    openHours: { monday: "9 AM-9 PM" },
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
    // The whole clause, not just the digit: `toContain("3")` also passes on
    // "13", on "4.3", and on a stray 3 anywhere else in the sentence.
    expect(q?.answer).toContain(
      "This directory lists 3 pharmacies in Deira, Dubai",
    );
  });

  test("names the highest-rated business, not a placeholder", () => {
    const faq = buildFaq(ctx);
    const q = faq.find((f) => /rated highest/i.test(f.question));
    expect(q?.answer).toContain(
      "A has the highest rating at 4.8 from 900 reviews",
    );
  });

  test("answers the accessibility question from real attributes", () => {
    // The differentiator: Google has this data but buries it.
    const faq = buildFaq(ctx);
    const q = faq.find((f) => /wheelchair|accessible/i.test(f.question));
    expect(q).toBeDefined();
    expect(q?.answer).toContain(
      "2 of the pharmacies listed in Deira, Dubai record",
    );
  });

  test("omits the accessibility question when nothing has the attribute", () => {
    // Two listings, deliberately: with one the FAQ is empty for a different
    // reason entirely, and this test would pass without proving anything.
    const faq = buildFaq({
      ...ctx,
      businesses: [
        { title: "X", rating: 4, reviews: 80 },
        { title: "Y", rating: 4.4, reviews: 90 },
      ],
    });
    expect(faq.length).toBeGreaterThan(0);
    expect(faq.some((f) => /wheelchair|accessible/i.test(f.question))).toBe(
      false,
    );
  });

  test("answers the 24-hour question only when something is open 24 hours", () => {
    const faq = buildFaq(ctx);
    expect(faq.some((f) => /24 hours/i.test(f.question))).toBe(true);

    const noneOpen = buildFaq({
      ...ctx,
      businesses: [
        { title: "X", openHours: { monday: "9 AM-5 PM" } },
        { title: "Y", openHours: { monday: "10 AM-6 PM" } },
      ],
    });
    expect(noneOpen.length).toBeGreaterThan(0);
    expect(noneOpen.some((f) => /24 hours/i.test(f.question))).toBe(false);
  });

  test("reports how many list a phone number", () => {
    const faq = buildFaq(ctx);
    const q = faq.find((f) => /phone/i.test(f.question));
    expect(q?.answer).toContain("2 of the 3 pharmacies listed here include");
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

  describe("the category label is data on the same terms", () => {
    /*
     * The highest-rated question used to derive a singular with
     * `.replace(/s$/, "")`. Run over the shipped corpus that produced 135 live
     * questions built on a word that does not exist — "Which pharmacie in
     * Dubai is rated highest?", "Which parks & beache...", "Which universitie
     * ...", "Which travel agencie...". Two of the eighty-two labels in the
     * taxonomy are ampersand compounds that no suffix rule can reach at all.
     *
     * The deeper problem is the one ADR 0005 already names. A label arrives
     * from data/taxonomy-map.json, so applying English morphology to it
     * assumes a fact about the deployment that belongs to the deployment —
     * exactly the defect that a hard-coded "Dubai" or "+971" was. A Portuguese
     * fork's "Farmácias" and an Arabic label have no reason to obey it.
     *
     * So the label is never inflected. Questions are phrased to take it
     * verbatim, whatever it is.
     */
    const labels = [
      "Pharmacies",
      "Parks & Beaches",
      "Universities",
      "Electronics",
      "Farmácias",
      "صيدليات",
    ];

    for (const category of labels) {
      test(`asks about "${category}" verbatim, inventing no singular for it`, () => {
        const faq = buildFaq({ ...ctx, category });
        const q = faq.find((f) => /rated highest/i.test(f.question));
        expect(q).toBeDefined();
        expect(q?.question).toContain(category.toLowerCase());
      });
    }

    test("a blank category falls back to the generic noun, not to a hole", () => {
      // `category: ""` already fell back, but `"  "` is truthy, so it reached
      // the sentence and printed as a run of spaces mid-question.
      const faq = buildFaq({ ...ctx, category: "   " });
      expect(faq.length).toBeGreaterThan(0);
      expect(faq[0]?.question).toContain("businesses");
      for (const entry of faq) {
        expect(entry.question + entry.answer).not.toMatch(/ {2}/);
      }
    });

    test("collapses whitespace inside a label rather than reprinting it", () => {
      // A label carrying a newline put a line break inside a Question node's
      // name. Trimming the ends is not enough when the middle is data too.
      const faq = buildFaq({ ...ctx, category: "Books &\n  Stationery" });
      for (const entry of faq) {
        expect(entry.question + entry.answer).not.toMatch(/\s{2}|\n/);
      }
      expect(faq[0]?.question).toContain("books & stationery");
    });
  });

  describe("a rating this file cannot state is not stated", () => {
    /*
     * `rating !== undefined` is true of NaN and of Infinity, and `.toFixed(1)`
     * turns both into a word. That published "has the highest rating at NaN
     * from 100 reviews" as prose and as an acceptedAnswer at the same time.
     *
     * It is the same judgement the LocalBusiness node already makes by omitting
     * aggregateRating: a claim this codebase cannot stand behind is not
     * downgraded, it is dropped.
     */
    for (const rating of [NaN, Infinity, -Infinity]) {
      test(`skips the superlative when the top rating is ${rating}`, () => {
        const faq = buildFaq({
          ...ctx,
          businesses: [
            { title: "Broken", rating, reviews: 4000 },
            { title: "Fine", rating: 4.4, reviews: 100 },
          ],
        });
        const q = faq.find((f) => /rated highest/i.test(f.question));
        expect(q?.answer).toContain("Fine has the highest rating at 4.4");
        expect(faq.map((f) => f.answer).join(" ")).not.toMatch(/NaN|Infinity/);
      });
    }

    test("says nothing at all when no credible rating is a real number", () => {
      const faq = buildFaq({
        ...ctx,
        businesses: [
          { title: "Broken", rating: NaN, reviews: 4000 },
          { title: "Also broken", rating: NaN, reviews: 900 },
        ],
      });
      expect(faq.length).toBeGreaterThan(0);
      expect(faq.some((f) => /rated highest/i.test(f.question))).toBe(false);
    });
  });

  describe("every sentence agrees with the number it carries", () => {
    /*
     * Measured over the shipped corpus: 728 answers read "1 of the businesses
     * listed in Jebel Ali, Dubai show 24-hour opening", and 263 read "This
     * directory lists 1 businesses in Academic City, Dubai". Both shipped
     * inside FAQPage markup, which is to say inside a machine-readable claim.
     */
    const oneOfEach = [
      {
        title: "Only",
        rating: 4.5,
        reviews: 200,
        phoneE164: "+35121",
        openHours: { monday: "Open 24 hours" },
        accessibility: ["wheelchair-accessible-entrance"],
      },
      { title: "Plain", rating: 4.1, reviews: 90 },
    ];

    test("uses the singular verb when exactly one listing qualifies", () => {
      const text = buildFaq({ ...ctx, businesses: oneOfEach })
        .map((f) => f.answer)
        .join(" ");

      expect(text).toContain(
        "1 of the pharmacies listed in Deira, Dubai shows 24-hour opening",
      );
      expect(text).toContain(
        "1 of the pharmacies listed in Deira, Dubai records at least one",
      );
      expect(text).toContain("1 of the 2 pharmacies listed here includes");
      expect(text).not.toMatch(/\b1 of the [^.]*\b(show|record|include)\b/);
    });

    test("emits nothing for a single listing, which is not a set", () => {
      // "How many pharmacies are there?" answered "This directory lists 1
      // pharmacies" is broken English; "Which of the pharmacies is rated
      // highest?" over a set of one is a question with a false premise. Both
      // are worse than no FAQ, which is the judgement this file already makes
      // for an empty page.
      const alone = businesses.slice(0, 1);
      expect(buildFaq({ ...ctx, businesses: alone })).toEqual([]);
      expect(buildFaq({ ...hub, businesses: alone })).toEqual([]);
    });

    test("two listings are a set, and still get an FAQ", () => {
      const faq = buildFaq({ ...ctx, businesses: businesses.slice(0, 2) });
      expect(faq.length).toBeGreaterThan(0);
      expect(faq[0]?.answer).toContain("lists 2 pharmacies");
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
      expect(q?.answer).toContain(
        "This directory lists 3 businesses in Al Barsha, Dubai",
      );
    });

    test("names the place in every hub question too", () => {
      const faq = buildFaq(hub);
      expect(faq.length).toBeGreaterThan(3);
      for (const entry of faq) {
        expect(entry.question).toContain("Al Barsha, Dubai");
        expect(entry.question + entry.answer).not.toMatch(/undefined|\s,/);
      }
    });

    test("asks different questions from a category page in the same area", () => {
      // Both routes exist for Al Barsha. If the hub reused the category page's
      // wording the two would collide, which is the duplication the whole file
      // is arranged to avoid.
      const hubQs = buildFaq(hub).map((f) => f.question);
      const catQs = buildFaq({ ...ctx, area: "Al Barsha" }).map(
        (f) => f.question,
      );
      expect(hubQs.filter((q) => catQs.includes(q))).toEqual([]);
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
        businesses: [
          { title: "Two reviews", rating: 5, reviews: 2 },
          { title: "Three reviews", rating: 4.9, reviews: 3 },
        ],
      });
      expect(faq.length).toBeGreaterThan(0);
      expect(faq.some((f) => /rated highest/i.test(f.question))).toBe(false);
    });

    test("counts accessibility and phones for the hub as well", () => {
      const faq = buildFaq(hub);
      expect(
        faq.find((f) => /wheelchair|accessible/i.test(f.question))?.answer,
      ).toContain("2 of the businesses listed in Al Barsha, Dubai record");
      expect(faq.find((f) => /phone/i.test(f.question))?.answer).toContain(
        "2 of the 3 businesses listed here include",
      );
    });

    test("returns nothing at all for an empty hub", () => {
      expect(buildFaq({ ...hub, businesses: [] })).toEqual([]);
    });
  });

  test("names the same business whichever order the listings arrive in", () => {
    /*
     * 357 of the 1,264 shipped pages have two or more listings tied at the top
     * rating — one Al Barsha hub ties 51 businesses at 5.0. Sorting on rating
     * alone leaves the winner to `Array.prototype.sort`'s stability, which is
     * to say to the order the caller happened to pass.
     *
     * That looks correct today only by accident: .data/businesses.json is
     * sorted by review count descending, so the most-reviewed of a tie floats
     * to the front on its own. A DynamoDB query returns key order instead, and
     * the same page would then name a different business as "rated highest" —
     * a first-party superlative that changed because the storage changed.
     */
    const tied = [
      { title: "Few reviews", rating: 5, reviews: 60 },
      { title: "Many reviews", rating: 5, reviews: 4000 },
    ];

    for (const order of [tied, [...tied].reverse()]) {
      const q = buildFaq({ ...ctx, businesses: order }).find((f) =>
        /rated highest/i.test(f.question),
      );
      expect(q?.answer).toContain("Many reviews");
    }
  });

  test("no answer promises a feature the site does not render", () => {
    for (const entry of [...buildFaq(ctx), ...buildFaq(hub)]) {
      for (const promise of UNRENDERED) {
        expect(entry.answer).not.toMatch(promise);
      }
    }
  });
});

describe("faqJsonLd", () => {
  // The serialiser had no test of its own, which is how a malformed Question
  // node would have reached the index unnoticed.
  test("wraps every entry as a Question with its own Answer", () => {
    const entries = buildFaq(ctx);
    const node = faqJsonLd(entries) as {
      "@context": string;
      "@type": string;
      mainEntity: Array<{
        "@type": string;
        name: string;
        acceptedAnswer: { "@type": string; text: string };
      }>;
    };

    expect(node["@context"]).toBe("https://schema.org");
    expect(node["@type"]).toBe("FAQPage");
    expect(node.mainEntity).toHaveLength(entries.length);

    for (const [i, question] of node.mainEntity.entries()) {
      expect(question["@type"]).toBe("Question");
      expect(question.acceptedAnswer["@type"]).toBe("Answer");
      expect(question.name).toBe(entries[i]?.question);
      expect(question.acceptedAnswer.text).toBe(entries[i]?.answer);
    }
  });

  test("an empty entry list produces an empty mainEntity, never a fake one", () => {
    // A FAQPage with no Question is invalid structured data, so the guard is
    // that the caller must not render the block at all — packages/web's Faq
    // component returns null on an empty list. This pins the contract that
    // makes that guard sufficient: nothing is invented to fill the gap.
    expect(faqJsonLd([]).mainEntity).toEqual([]);
  });
});

describe("the 24-hour answer agrees with the hours parser", () => {
  /**
   * hours.ts and this file both read the same Google day-strings, and they
   * disagreed. `openingHoursSpecification` was hardened to treat any value
   * containing "closed" as closed — anchoring only on "24 hours" claimed a shop
   * open around the clock on a day its own string calls closed, and the failure
   * ran in the dangerous direction, asserting MORE openness than the source.
   * This file's predicate kept the original unanchored test, so the two modules
   * answered one string two different ways.
   *
   * Absent from the Dubai corpus today — its only 24-hour string is
   * "Open 24 hours" — so this guards a shape another city's crawl can produce
   * rather than a live defect.
   *
   * Three businesses, because a single-listing page emits no FAQ at all.
   */
  const others = [
    { title: "B", openHours: { monday: "9 AM–5 PM" } },
    { title: "C", rating: 4.8, reviews: 120 },
  ];
  const asks24h = (value: string) =>
    buildFaq({
      city: "Dubai",
      category: "Pharmacies",
      businesses: [{ title: "A", openHours: { monday: value } }, ...others],
    }).some((e) => /24 hours/i.test(e.question));

  test("does not count a day that says closed as open around the clock", () => {
    expect(asks24h("Closed 24 hours")).toBe(false);
  });

  test("still counts a genuine all-day listing", () => {
    expect(asks24h("Open 24 hours")).toBe(true);
  });
});

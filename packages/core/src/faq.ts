/**
 * Generate an FAQ block from a page's own data.
 *
 * An FAQ is worth having for two reasons — it answers what people actually ask,
 * and FAQPage structured data can earn an expanded search result. Both depend
 * on the same thing: the answers must be real.
 *
 * A generic "What are the opening hours?" repeated across 800 URLs is the
 * definition of thin, duplicated content, and it is precisely the pattern
 * Google's helpful-content system targets. It would cost rankings rather than
 * earn them. So every question below is emitted ONLY when this page's data can
 * answer it, every answer carries a number this page actually knows, and every
 * question names the place so no two pages share one.
 *
 * One rule is not visible in the code and is the easiest to break: an answer
 * may describe another page only if somebody has opened that page and checked.
 * The accessibility answer says "Filter them by accessibility, or see which features each one reports. Each listing page shows which features it
 * reports", which was false for months while shipping inside FAQPage markup —
 * true now only because packages/web/app/business/[slug]/page.tsx renders the
 * section. faq.test.ts keeps a tripwire for the next such sentence.
 */

export interface FaqEntry {
  question: string;
  answer: string;
}

export interface FaqInput {
  /**
   * The city this deployment serves — "Dubai", "Lisbon", whatever
   * `data/cities/<id>.json` says. Required, and deliberately not defaulted:
   * this package is the reusable layer of a toolkit whose central claim is that
   * a city is data and not code (ADR 0005), and every literal "Dubai" that used
   * to be here would have shipped a Lisbon fork answers announcing the wrong
   * emirate. A default would let a call site keep doing exactly that, silently,
   * which is the bug — required makes the compiler ask.
   */
  city: string;
  /** Omitted on a neighbourhood hub, which spans every category at once. */
  category?: string;
  /** Omitted on a city-wide page. */
  area?: string;
  businesses: Array<{
    title?: string;
    rating?: number | undefined;
    reviews?: number | undefined;
    phoneE164?: string | undefined;
    openHours?: Record<string, string> | undefined;
    accessibility?: string[] | undefined;
  }>;
}

function isOpen24Hours(hours: Record<string, string> | undefined): boolean {
  if (!hours) return false;
  return Object.values(hours).some((v) => /24\s*hours/i.test(v));
}

export function buildFaq(input: FaqInput): FaqEntry[] {
  const { category, businesses } = input;
  if (businesses.length === 0) return [];

  // Assembled rather than interpolated, so the comma only appears when there is
  // something on both sides of it. `${area}, ${city}` with either half missing
  // reads "Al Barsha, " or ", Dubai" — stray punctuation that is invisible in
  // review and permanent in the index once it is inside a Question node.
  const where = [input.area?.trim(), input.city.trim()].filter(Boolean).join(
    ", ",
  );

  // Nowhere to name, so nothing to say. Every question below is unique only
  // because it states where it is about; without that, hundreds of pages would
  // ship one identical question, which is the duplication this file exists to
  // avoid. Better to emit no FAQ than a shared one.
  if (!where) return [];

  // The subject of every question. A neighbourhood hub spans all 62 of its
  // categories, so it has no category noun to use — and needs none, because
  // these questions are about a set of listings and "businesses" is what that
  // set is. The hub is a different noun, not a different FAQ, which is why the
  // 40 hub pages get the same five questions rather than a parallel set to keep
  // in step.
  const what = category ? category.toLowerCase() : "businesses";
  const one = category ? what.replace(/s$/, "") : "business";
  const entries: FaqEntry[] = [];

  entries.push({
    question: `How many ${what} are there in ${where}?`,
    answer:
      `This directory lists ${businesses.length.toLocaleString()} ${what} in ` +
      `${where}, compiled from Google Maps data.`,
  });

  // Highest rated, but only among businesses with enough reviews to mean it —
  // naming a 5.0 with two reviews as "the best" is worse than saying nothing.
  // The gate matters more on a hub, not less: across every category in a
  // neighbourhood there are far more two-review 5.0s to trip over.
  const credible = businesses
    .filter((b) => b.rating !== undefined && (b.reviews ?? 0) >= 50)
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  const best = credible[0];
  if (best?.title && best.rating !== undefined) {
    entries.push({
      question: `Which ${one} in ${where} is rated highest?`,
      answer:
        `${best.title} has the highest rating at ${best.rating.toFixed(1)}` +
        (best.reviews ? ` from ${best.reviews.toLocaleString()} reviews` : "") +
        `. Ratings come from Google and are not collected by this directory.`,
    });
  }

  const open24 = businesses.filter((b) => isOpen24Hours(b.openHours));
  if (open24.length > 0) {
    entries.push({
      question: `Are any ${what} in ${where} open 24 hours?`,
      answer:
        `Yes — ${open24.length.toLocaleString()} of the ${what} listed in ` +
        `${where} show 24-hour opening on Google` +
        (open24[0]?.title ? `, including ${open24[0].title}` : "") +
        `. Hours change, so confirm before travelling.`,
    });
  }

  // The differentiator. Google holds this data but buries it several taps into
  // a listing page, so a directory that surfaces it is genuinely more useful
  // than the source for the people who need it.
  const accessible = businesses.filter(
    (b) => (b.accessibility?.length ?? 0) > 0,
  );
  if (accessible.length > 0) {
    entries.push({
      question: `Which ${what} in ${where} are wheelchair accessible?`,
      answer:
        `${accessible.length.toLocaleString()} of the ${what} listed in ${where} ` +
        `record at least one accessibility feature on Google, such as a ` +
        `wheelchair-accessible entrance or car park. Filter them by accessibility, or see which features each one reports. Each listing page shows ` +
        `which features it reports.`,
    });
  }

  const withPhone = businesses.filter((b) => b.phoneE164);
  if (withPhone.length > 0) {
    entries.push({
      question: `Can I find phone numbers for ${what} in ${where}?`,
      answer:
        `Yes — ${withPhone.length.toLocaleString()} of the ${businesses.length.toLocaleString()} ` +
        `${what} listed here include a phone number, stored in full ` +
        // This sentence used to end "in international +971 format". That is the
        // hard-coded city again in a costume: a dialling code is a fact about
        // the country being crawled, not about this package, and it is the more
        // dangerous of the two because it reads as a technical detail rather
        // than a place name. A Lisbon fork would have advertised +971 beside
        // every Portuguese number it holds. The format is what this file can
        // promise; the code belongs to the data.
        `international format so it dials correctly from abroad.`,
    });
  }

  return entries;
}

/**
 * FAQPage structured data.
 *
 * Only emit this when the answers are genuinely on the page — marking up
 * content a visitor cannot see is a structured-data violation.
 */
export function faqJsonLd(entries: FaqEntry[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: entries.map((entry) => ({
      "@type": "Question",
      name: entry.question,
      acceptedAnswer: { "@type": "Answer", text: entry.answer },
    })),
  };
}

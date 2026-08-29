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
 * The accessibility answer says "Each listing page shows which features it
 * reports", which was false for months while shipping inside FAQPage markup —
 * true now only because packages/web/app/business/[slug]/page.tsx renders the
 * section. faq.test.ts keeps a tripwire for the next such sentence.
 *
 * The second rule is grammatical, which sounds like a smaller thing than it is.
 * These sentences are published twice — as prose a reader sees and as a
 * machine-readable Question node — so a plural verb on a count of one, or a
 * singular invented by stripping a letter off a category label, is a defect in
 * a structured claim rather than a typo. Run over the 1,264 pages this
 * currently generates, an earlier version shipped 135 questions built on a
 * non-word, 728 answers reading "1 of the businesses ... show", and 263 reading
 * "lists 1 businesses". Nothing here inflects a word that arrives from data;
 * only the counts, which this file owns, drive agreement.
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

/**
 * Whether any day of this listing is open around the clock.
 *
 * The `closed` guard is not defensive padding — it keeps this file agreeing
 * with hours.ts, which reads the SAME Google day-strings to build
 * openingHoursSpecification and treats any value containing "closed" as closed.
 * Without it, "Closed 24 hours" counts here as open while hours.ts emits no
 * entry at all, so one string gets two answers on one page. The error also runs
 * in the dangerous direction: it claims more openness than the source does, and
 * this answer ships inside FAQPage markup.
 *
 * The Dubai corpus has only "Open 24 hours", so nothing changes for this
 * deployment — the shape is one a different city's crawl can produce.
 */
function isOpen24Hours(hours: Record<string, string> | undefined): boolean {
  if (!hours) return false;
  return Object.values(hours).some(
    (v) => /24\s*hours/i.test(v) && !/\bclosed\b/i.test(v),
  );
}

/**
 * Subject–verb agreement for a clause of the form "N of the X <verb> ...".
 *
 * Driven by the count, which this file owns, and never by the category label,
 * which it does not — see the note on `what` below. Measured over the shipped
 * corpus, 728 answers read "1 of the businesses ... show 24-hour opening"
 * inside FAQPage markup, which is a grammatical error published as a
 * machine-readable claim.
 */
function agrees(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

export function buildFaq(input: FaqInput): FaqEntry[] {
  const { businesses } = input;

  // Two, not one. Every question below asks something about a *set* — how many
  // there are, which is rated highest, whether any open late — and a set of one
  // answers all of them trivially or falsely: "This directory lists 1
  // pharmacies" is broken English, and "Which of the pharmacies is rated
  // highest?" over a single listing is a superlative with no field to win.
  // Both shipped on 263 of the 1,264 pages this generates. The file already
  // prefers no FAQ to a bad one for an empty page; one listing is the same
  // judgement, one row further along.
  if (businesses.length < 2) return [];

  // Assembled rather than interpolated, so the comma only appears when there is
  // something on both sides of it. `${area}, ${city}` with either half missing
  // reads "Al Barsha, " or ", Dubai" — stray punctuation that is invisible in
  // review and permanent in the index once it is inside a Question node.
  const where = [input.area?.trim(), input.city.trim()]
    .filter(Boolean)
    .join(", ");

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
  //
  // Whitespace collapsed, not just trimmed, before the truthiness test: "   "
  // is truthy and used to reach the sentence as a run of spaces mid-question,
  // and a label carrying a newline put a line break inside a Question node's
  // name. A category that is blank in the data is a category this page cannot
  // name, so it takes the generic noun rather than a hole.
  const label = input.category?.replace(/\s+/g, " ").trim();
  const what = label ? label.toLowerCase() : "businesses";
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
  //
  // Ties broken by review count, explicitly. 357 of the 1,264 pages this
  // generates have two or more listings level at the top — one Al Barsha hub
  // ties 51 businesses at 5.0 — and sorting on rating alone left the winner to
  // `Array.prototype.sort`'s stability, which is to say to the order the caller
  // happened to pass. That reads correctly today only because
  // .data/businesses.json arrives sorted by review count; the deployed path
  // queries DynamoDB, which returns key order, and the same page would then
  // publish a different business as "rated highest" because the storage
  // changed. A superlative that moves with the storage layer is not a fact.
  //
  // `Number.isFinite`, not `!== undefined`. NaN and Infinity both pass an
  // undefined check and both survive `.toFixed(1)` as a word, so a single
  // malformed rating anywhere upstream published "has the highest rating at
  // NaN" as visible prose and as an acceptedAnswer at the same time. This is
  // the judgement the LocalBusiness node already makes by omitting
  // aggregateRating: a number this codebase cannot stand behind is dropped
  // rather than printed.
  const credible = businesses
    .filter((b) => Number.isFinite(b.rating) && (b.reviews ?? 0) >= 50)
    .sort(
      (a, b) =>
        (b.rating ?? 0) - (a.rating ?? 0) ||
        (b.reviews ?? 0) - (a.reviews ?? 0),
    );
  const best = credible[0];
  if (best?.title && best.rating !== undefined) {
    entries.push({
      // "Which of the ${what}", not "Which ${singular}". The label arrives from
      // data/taxonomy-map.json, so deriving a singular from it means applying
      // English morphology to data — the same defect as a hard-coded "Dubai" or
      // "+971", which assume a fact about the deployment that belongs to the
      // deployment. The previous `.replace(/s$/, "")` published 135 questions
      // built on a word that does not exist ("Which pharmacie in Dubai is rated
      // highest?", "Which parks & beache...", "Which universitie..."), and two
      // of the 82 labels are ampersand compounds no suffix rule could reach
      // anyway. A Portuguese fork's "Farmácias" and an Arabic label have no
      // reason to obey English suffixes at all. So the label is never inflected
      // and the question is phrased to take it whole.
      question: `Which of the ${what} in ${where} is rated highest?`,
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
        `${where} ${agrees(open24.length, "shows", "show")} ` +
        `24-hour opening on Google` +
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
        `${agrees(accessible.length, "records", "record")} ` +
        `at least one accessibility feature on Google, such as a ` +
        `wheelchair-accessible entrance or car park. Each listing page shows ` +
        `which features it reports.`,
    });
  }

  const withPhone = businesses.filter((b) => b.phoneE164);
  if (withPhone.length > 0) {
    entries.push({
      question: `Can I find phone numbers for ${what} in ${where}?`,
      answer:
        `Yes — ${withPhone.length.toLocaleString()} of the ${businesses.length.toLocaleString()} ` +
        `${what} listed here ${agrees(withPhone.length, "includes", "include")} ` +
        `a phone number, stored in full ` +
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

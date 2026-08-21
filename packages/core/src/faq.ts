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
 */

export interface FaqEntry {
  question: string;
  answer: string;
}

export interface FaqInput {
  category: string;
  /** Omitted on a city-wide category page. */
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
  const { category, area, businesses } = input;
  if (businesses.length === 0) return [];

  const what = category.toLowerCase();
  const where = area ? `${area}, Dubai` : "Dubai";
  const entries: FaqEntry[] = [];

  entries.push({
    question: `How many ${what} are there in ${where}?`,
    answer:
      `This directory lists ${businesses.length.toLocaleString()} ${what} in ` +
      `${where}, compiled from Google Maps data.`,
  });

  // Highest rated, but only among businesses with enough reviews to mean it —
  // naming a 5.0 with two reviews as "the best" is worse than saying nothing.
  const credible = businesses
    .filter((b) => b.rating !== undefined && (b.reviews ?? 0) >= 50)
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  const best = credible[0];
  if (best?.title && best.rating !== undefined) {
    entries.push({
      question: `Which ${what.replace(/s$/, "")} in ${where} is rated highest?`,
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
        `${what} listed here include a phone number, stored in international ` +
        `+971 format so it dials correctly from anywhere.`,
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

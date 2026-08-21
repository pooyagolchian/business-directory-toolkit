import { faqJsonLd, serializeJsonLd, type FaqEntry } from "@directory/core";

/**
 * FAQ block, rendered at the end of a listing page.
 *
 * Every answer is generated from this page's own data — see buildFaq. That is
 * the difference between an FAQ that earns an expanded search result and one
 * that reads as boilerplate repeated across 800 URLs.
 *
 * The FAQPage markup is emitted only alongside the visible block. Marking up
 * content a visitor cannot see is a structured-data violation, so the two ship
 * together or not at all.
 */
export function Faq({ entries }: { entries: FaqEntry[] }) {
  if (entries.length === 0) return null;

  return (
    <section className="mt-20 border-t border-[var(--rule)] pt-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(faqJsonLd(entries)),
        }}
      />

      <h2 className="font-[family-name:var(--font-display)] text-2xl">
        Common questions
      </h2>

      <dl className="mt-6 space-y-6">
        {entries.map((entry) => (
          <div key={entry.question}>
            <dt className="text-base font-semibold">{entry.question}</dt>
            <dd className="mt-1.5 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
              {entry.answer}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

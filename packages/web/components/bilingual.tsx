// Deep import, NOT the barrel. This component is rendered by filterable.tsx,
// which is a client component, so anything reachable from here ships to the
// browser. Measured via the barrel: the schema.org type map leaked into three
// client chunks ("MedicalClinic" and "DryCleaningOrLaundry" both grep-able in
// .next/static/chunks) — tree-shaking dropped the functions but kept the large
// const object. The subpath export reaches one 60-line module instead.
import { splitScriptRuns } from "@directory/core/bidi";

/**
 * Render a possibly-bilingual string with each Arabic run marked `lang="ar"`.
 *
 * Use this anywhere a BUSINESS NAME or ADDRESS is rendered — those are the two
 * fields Google returns bilingually. It is not needed for our own copy, which
 * is English throughout.
 *
 * WHY IT EXISTS. `dir="auto"` and the font stacks in globals.css already get
 * bilingual titles LOOKING right; between them they were the whole answer. What
 * neither supplies is a language for assistive technology: `<html lang="en">`
 * is the document's only lang attribute, so a screen reader announces
 * `مطعم شاميات` with an English voice reading Arabic letters.
 *
 * WHY IT IS CHEAP. 391 of 14,981 titles (2.6%) contain any Arabic. Everything
 * else takes the fast path below and renders as a bare string with no wrapper
 * element at all, so this costs nothing on 97.4% of rows.
 *
 * Keep `dir="auto"` on the PARENT. This handles language; direction is a
 * separate problem with a separate, already-correct answer.
 */
export function Bilingual({ text }: { text: string }) {
  const runs = splitScriptRuns(text);

  // The overwhelmingly common case: one Latin run. Returning the string itself
  // rather than a single-element fragment keeps the DOM identical to what it
  // was before this component existed.
  if (runs.length === 1 && !runs[0]?.lang) return <>{text}</>;

  return (
    <>
      {runs.map((run, i) =>
        run.lang ? (
          // A stable key is impossible here and unnecessary: this list is
          // derived from a single string and is never reordered or filtered.
          <span key={i} lang={run.lang}>
            {run.text}
          </span>
        ) : (
          <span key={i}>{run.text}</span>
        ),
      )}
    </>
  );
}

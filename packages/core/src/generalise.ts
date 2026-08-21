import type { ReviewSignals } from "./reviews.js";

/**
 * Keep only themes that generalise across businesses.
 *
 * WHY THIS EXISTS — a real defect found in live output.
 *
 * Stripping reviewer identity turned out not to be enough. Reviewers thank
 * individual employees by name ("Nadia was wonderful", "thanks to Umesh"), and
 * TF-IDF rewards precisely that shape: a term frequent for one business and
 * rare everywhere else. The first run produced themes like
 * `Sofitel -> manava, wilbert, umesh` — three staff members named on what would
 * have been a public page. That is the personal data this project promises not
 * to collect, arriving through the back door.
 *
 * The fix is a property, not a blocklist: **a real theme recurs across many
 * businesses; a person's name belongs to one.** Measured on the live corpus,
 * 72% of theme terms appeared for exactly one business — staff names, brand
 * names and noise — while genuine themes like "shisha" (18 businesses) and
 * "seafood" (10) recurred.
 *
 * Requiring recurrence needs no name list, works in any language and script,
 * and cannot be defeated by an unusual name. It also removes one-off brand and
 * place tokens for free, which were never useful themes either.
 */
export function keepGeneralisableThemes(
  signals: Record<string, ReviewSignals>,
  minBusinesses: number,
): Record<string, ReviewSignals> {
  // How many distinct businesses each term was a theme for. Counted over a Set
  // per business, so a term repeated within one business still counts once.
  const businessesPerTerm = new Map<string, number>();
  for (const signal of Object.values(signals)) {
    for (const term of new Set(signal.themes)) {
      businessesPerTerm.set(term, (businessesPerTerm.get(term) ?? 0) + 1);
    }
  }

  const filtered: Record<string, ReviewSignals> = {};
  for (const [id, signal] of Object.entries(signals)) {
    filtered[id] = {
      ...signal,
      // A business whose themes all fail is kept, not deleted: its review count
      // and mean rating are still worth having.
      themes: signal.themes.filter(
        (term) => (businessesPerTerm.get(term) ?? 0) >= minBusinesses,
      ),
    };
  }
  return filtered;
}

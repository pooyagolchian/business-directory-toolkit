import type { ReviewSignals } from "./reviews";

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

/**
 * A theme must recur across at least this many businesses.
 *
 * This is a floor for statistical meaningfulness, not the privacy control.
 * A term seen at one business has a concentration of 1.0 by arithmetic rather
 * than by topicality, so the ratio below only means something once there are
 * a few businesses to spread across. `keepTopicalThemes` is what actually
 * stops a name.
 */
export const MIN_BUSINESSES_PER_THEME = 5;

/**
 * At least this share of a theme's businesses must sit in one top-level
 * category.
 *
 * Chosen from the live corpus rather than by feel. Sorted by concentration,
 * the surviving terms leave a gap: "fountain" at 0.70, then nothing until
 * "terrace" at 0.80. Any threshold inside that gap behaves identically —
 * 0.75 and 0.80 drop exactly the same eight terms — so this is a plateau, not
 * a knife-edge, and "neha" at 0.60 is well clear of it.
 */
export const MIN_CATEGORY_CONCENTRATION = 0.75;

/** The business fields the topicality gate reads. */
export interface CategorisedBusiness {
  placeId: string;
  title: string;
  l1?: string;
  l2?: string;
  l3?: string;
  types: string[];
}

/**
 * Split text the same way the review tokeniser does.
 *
 * Matching it matters: the gate compares a theme against a business's own
 * words, and if the two normalisations disagreed the comparison would
 * silently never match. Splitting on `\p{L}\p{N}` rather than `a-z` is what
 * keeps that true for Arabic titles, which are common here.
 */
function foldWords(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Every word a business uses to describe itself — its name and its categories. */
function vocabularyOf(business: CategorisedBusiness): Set<string> {
  const words = new Set<string>();
  for (const part of [
    business.title,
    business.l1,
    business.l2,
    business.l3,
    ...business.types,
  ]) {
    if (!part) continue;
    for (const word of foldWords(part)) words.add(word);
  }
  return words;
}

/**
 * Keep only themes that are about something.
 *
 * WHY RECURRENCE WAS NOT ENOUGH — the second half of the same defect.
 *
 * `keepGeneralisableThemes` removes a name that belongs to one business. It
 * cannot remove a *common* name, because enough businesses employ a Neha or an
 * Abdul that the name recurs on its own. Measured on the live corpus, "neha"
 * cleared the recurrence bar at exactly 5 businesses and was published as the
 * only theme of two medical facilities — the same defect as before, one
 * threshold further out.
 *
 * Raising the count does not fix it. It fails in the wrong direction: common
 * names recur *more* as the crawl grows, so a count calibrated on 999
 * businesses lets every name through at 11,890, while genuine mid-tier themes
 * are dropped first.
 *
 * The property that separates them is topicality. A real theme belongs to a
 * kind of business — "biryani" is about food wherever it appears. A person's
 * name is not about anything, so it scatters across unrelated verticals: a
 * hospital receptionist and a hotel concierge who happen to share a name. So a
 * term is published only if it is either
 *
 *   (a) a word the business already uses about itself — its name or its
 *       categories, which is how "sheraton" stays on the Sheraton — or
 *   (b) concentrated in a single top-level category.
 *
 * Being a ratio, (b) does not decay as coverage grows, which the count did.
 * Cost on the live corpus, stated honestly: 917 theme instances become 830,
 * and eight terms disappear entirely — "neha" plus "fountain", "brunch",
 * "iftar" and four subjective adjectives that were poor themes anyway.
 *
 * What this still does not catch: a name common within a single vertical.
 * That needs the review text, which this pipeline deliberately does not keep.
 */
export function keepTopicalThemes(
  signals: Record<string, ReviewSignals>,
  businesses: readonly CategorisedBusiness[],
  minConcentration: number,
): Record<string, ReviewSignals> {
  const byId = new Map(businesses.map((b) => [b.placeId, b]));

  // How each term's businesses split across top-level categories. A business
  // with no category still counts in the denominator but can never form the
  // majority: an unclassified business is not evidence that a term is
  // topical, so the gate fails closed rather than open.
  const spread = new Map<
    string,
    { total: number; perL1: Map<string, number> }
  >();
  for (const [placeId, signal] of Object.entries(signals)) {
    const business = byId.get(placeId);
    if (!business) continue;
    for (const term of new Set(signal.themes)) {
      let entry = spread.get(term);
      if (!entry) {
        entry = { total: 0, perL1: new Map() };
        spread.set(term, entry);
      }
      entry.total += 1;
      if (business.l1) {
        entry.perL1.set(business.l1, (entry.perL1.get(business.l1) ?? 0) + 1);
      }
    }
  }

  const concentration = (term: string): number => {
    const entry = spread.get(term);
    if (!entry || entry.total === 0 || entry.perL1.size === 0) return 0;
    return Math.max(...entry.perL1.values()) / entry.total;
  };

  const filtered: Record<string, ReviewSignals> = {};
  for (const [placeId, signal] of Object.entries(signals)) {
    const business = byId.get(placeId);
    // A signal whose business is not in the corpus cannot be judged against
    // any vocabulary, so it keeps its rating and count and publishes nothing.
    const vocabulary = business ? vocabularyOf(business) : new Set<string>();
    filtered[placeId] = {
      ...signal,
      themes: business
        ? signal.themes.filter(
            (term) =>
              vocabulary.has(term) || concentration(term) >= minConcentration,
          )
        : [],
    };
  }
  return filtered;
}

/**
 * Reviews are used as a SOURCE, never as content.
 *
 * Two constraints drive everything here:
 *
 * 1. **No personal data.** The engine returns reviewer names, contributor ids,
 *    profile links and photographs. A reviewer is a private individual, not a
 *    business, and this project indexes business listings only. Identity is
 *    stripped at the boundary so it never reaches storage.
 *
 * 2. **No republication.** Review text is Google's users' content. Displaying
 *    it verbatim at scale is redistribution, and the same reasoning that
 *    produced ADR 0002 applies. So the text is analysed and then discarded:
 *    what gets stored and shown is our derived summary, which is genuinely
 *    original work and cannot be scraped back into a copy of Google's corpus.
 */

/** A review with every trace of its author removed. Never persisted. */
export interface AnonymousReview {
  rating: number;
  text: string;
  isoDate?: string;
  likes?: number;
}

/** What we actually keep. Contains no review text and no reviewer. */
export interface ReviewSignals {
  reviewsAnalysed: number;
  averageRating: number;
  /** Terms distinctive to this business, most distinctive first. */
  themes: string[];
}

/**
 * Take a raw review and keep only the rating and the words.
 *
 * Returns null for anything unusable — a bare star rating carries no
 * information a business's own aggregate rating does not already have.
 */
export function stripReviewIdentity(raw: unknown): AnonymousReview | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;

  const rating = record.rating;
  const text = record.text;
  if (typeof rating !== "number") return null;
  if (typeof text !== "string" || text.trim() === "") return null;

  // Built by allow-list, never by deleting keys off the original: a new field
  // in the API response must not silently become a new field in our store.
  const review: AnonymousReview = { rating, text };
  if (typeof record.iso_date === "string") review.isoDate = record.iso_date;
  if (typeof record.likes === "number") review.likes = record.likes;
  return review;
}

const STOPWORDS = new Set([
  "the", "and", "was", "were", "for", "with", "this", "that", "have", "has",
  "had", "you", "your", "our", "not", "but", "are", "they", "them", "their",
  "from", "very", "all", "can", "will", "would", "there", "here", "when",
  "what", "which", "who", "how", "did", "does", "been", "being", "just",
  "also", "then", "than", "too", "any", "some", "more", "most", "much",
  "get", "got", "one", "two", "out", "about", "into", "over", "after",
  "before", "again", "only", "even", "back", "well", "way", "make", "made",
  "like", "time", "went", "come", "came", "take", "took", "give", "gave",
  "its", "it's", "i've", "i'm", "we", "us", "me", "my", "he", "she", "his",
  "her", "on", "in", "at", "to", "of", "is", "as", "by", "it", "be", "or",
  "if", "so", "up", "do", "no", "yes", "am", "an", "a", "i",
]);

const MIN_TERM_LENGTH = 4;
const MIN_REVIEWS_MENTIONING = 2;
const MAX_THEMES = 6;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= MIN_TERM_LENGTH && !STOPWORDS.has(t));
}

/**
 * Reduce a business's reviews to a few distinctive themes.
 *
 * Scored by how much more common a term is here than across the whole corpus —
 * the TF-IDF intuition. "good" and "place" appear in almost every review in
 * Dubai and say nothing; "breakfast" or "parking" appearing repeatedly for one
 * business is the actual signal.
 *
 * A term must appear in at least two separate reviews, so one reviewer's
 * idiosyncratic vocabulary cannot become a theme.
 */
export function deriveReviewSignals(
  reviews: Array<{ rating: number; text: string }>,
  corpusFrequency: Map<string, number>,
): ReviewSignals {
  if (reviews.length === 0) {
    return { reviewsAnalysed: 0, averageRating: 0, themes: [] };
  }

  const reviewsMentioning = new Map<string, number>();
  for (const review of reviews) {
    for (const term of new Set(tokenize(review.text))) {
      reviewsMentioning.set(term, (reviewsMentioning.get(term) ?? 0) + 1);
    }
  }

  /**
   * Frequency-based stopword detection.
   *
   * The hardcoded STOPWORDS list only catches grammar. It cannot know that in
   * a corpus of Dubai reviews, "good", "place" and "dubai" itself are just as
   * empty — they appear nearly everywhere, so they distinguish nothing. Any
   * term occurring in more than this share of the most common term's documents
   * is treated as a stopword for THIS corpus, which is the IDF half of TF-IDF
   * doing its actual job.
   */
  const maxFrequency = Math.max(1, ...corpusFrequency.values());
  const ubiquityCeiling = maxFrequency * 0.5;

  const scored: Array<{ term: string; score: number }> = [];
  for (const [term, mentions] of reviewsMentioning) {
    if (mentions < MIN_REVIEWS_MENTIONING) continue;

    // A term missing from the corpus map is at least as frequent as its own
    // local mentions; treating it as 0 would make unseen terms score highest.
    const frequency = corpusFrequency.get(term) ?? mentions;
    if (frequency > ubiquityCeiling) continue;

    scored.push({ term, score: mentions / (1 + frequency) });
  }

  scored.sort((a, b) => b.score - a.score || a.term.localeCompare(b.term));

  const averageRating =
    reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;

  return {
    reviewsAnalysed: reviews.length,
    averageRating: Math.round(averageRating * 100) / 100,
    themes: scored.slice(0, MAX_THEMES).map((s) => s.term),
  };
}

/** Corpus-wide term frequency, for scoring what is distinctive. */
export function buildCorpusFrequency(
  allReviews: Array<{ text: string }>,
): Map<string, number> {
  const frequency = new Map<string, number>();
  for (const review of allReviews) {
    for (const term of new Set(tokenize(review.text))) {
      frequency.set(term, (frequency.get(term) ?? 0) + 1);
    }
  }
  return frequency;
}

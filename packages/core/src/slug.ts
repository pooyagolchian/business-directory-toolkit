/** Max length of the readable portion, before the uniqueness suffix. */
const MAX_TITLE_CHARS = 60;
const SUFFIX_CHARS = 6;

/**
 * FNV-1a. Stable across runs and Node versions, unlike `hashCode`-style
 * implementations that depend on engine internals. Slugs end up in URLs and in
 * Google's index, so they must never drift between deploys.
 */
function shortHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(SUFFIX_CHARS, "0").slice(-SUFFIX_CHARS);
}

/**
 * Build a URL slug for a business.
 *
 * Dubai listings are bilingual ("Shamiat Restaurant مطعم شاميات - Dubai") and
 * often marketing sentences rather than names. Arabic script is dropped rather
 * than transliterated: romanisation schemes disagree with each other, and the
 * Latin half of a bilingual title is already the searchable form.
 *
 * The `place_id` suffix is always appended. Chains repeat names constantly, and
 * a deterministic suffix is cheaper and more stable than collision detection
 * across separate crawl runs.
 */
export function toSlug(title: string, placeId: string): string {
  const readable = title
    .normalize("NFKD")
    // Strip combining marks so "Trèsind" folds to "Tresind" rather than "Tr-sind".
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // Drop apostrophes outright: "O'lio" should be "olio", not "o-lio".
    .replace(/['’`]/g, "")
    // Everything that is not ASCII alphanumeric becomes a separator. This is
    // what removes Arabic, CJK, emoji, and punctuation in one pass.
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_TITLE_CHARS)
    // Re-trim: slice() can land mid-word and leave a dangling hyphen.
    .replace(/-+$/g, "");

  return `${readable || "business"}-${shortHash(placeId)}`;
}

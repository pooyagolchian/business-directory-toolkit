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

/**
 * Lookup tables for resolving a business slug, including one Google renamed.
 *
 * WHY THIS EXISTS. The readable half of a slug comes from the business's title,
 * which Google changes: the 2026-11-22 Dubai re-crawl renamed 347 of the
 * 14,980 live listings ("ramada-by-wyndham-downtown-dubai-xqxk8k" became
 * "wyndham-downtown-dubai-xqxk8k"). Every old URL is still in search indexes
 * and other people's links. The suffix is a hash of the place_id, so it
 * survives a rename — which makes it the one part of the URL that still
 * identifies the business.
 */
export interface SlugIndex<T extends { slug: string }> {
  bySlug: ReadonlyMap<string, T>;
  bySuffix: ReadonlyMap<string, readonly T[]>;
}

export interface ResolvedSlug<T> {
  business: T;
  /** False when found by suffix only: the caller should redirect to business.slug. */
  canonical: boolean;
}

const SUFFIX_PATTERN = new RegExp(`-([0-9a-z]{${SUFFIX_CHARS}})$`);

export function buildSlugIndex<T extends { slug: string }>(
  items: readonly T[],
): SlugIndex<T> {
  const bySlug = new Map<string, T>();
  const bySuffix = new Map<string, T[]>();
  for (const item of items) {
    bySlug.set(item.slug, item);
    const suffix = SUFFIX_PATTERN.exec(item.slug)?.[1];
    if (!suffix) continue;
    const list = bySuffix.get(suffix);
    if (list) list.push(item);
    else bySuffix.set(suffix, [item]);
  }
  return { bySlug, bySuffix };
}

/**
 * Resolve a requested slug: exact match first, then by place_id suffix.
 *
 * A suffix match is only trusted when it is unique. Six base-36 characters is
 * about 2.2 billion values, so a collision among a city's listings is unlikely
 * but not impossible, and redirecting to the wrong business is worse than a
 * 404. A suppressed business is not in `items` at all, so a takedown's old URL
 * resolves to nothing and still 404s — this never resurrects one.
 */
export function resolveSlug<T extends { slug: string }>(
  slug: string,
  index: SlugIndex<T>,
): ResolvedSlug<T> | undefined {
  const exact = index.bySlug.get(slug);
  if (exact) return { business: exact, canonical: true };

  const suffix = SUFFIX_PATTERN.exec(slug)?.[1];
  if (!suffix) return undefined;
  const candidates = index.bySuffix.get(suffix);
  if (candidates?.length !== 1) return undefined;
  return { business: candidates[0]!, canonical: false };
}

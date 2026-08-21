import type { Business } from "./normalize";

export type DynamoItem = Record<string, string | number | boolean | string[]>;

const MIN_PREFIX = 2;
const MAX_PREFIX = 4;
const MAX_PREFIXES_PER_TITLE = 30;

/** Reviews are capped well below this, so the inverse never goes negative. */
const REVIEW_CEILING = 9_999_999;

/**
 * DynamoDB sorts range keys ascending, but a browse page wants the most-reviewed
 * business first. Storing the inverse, zero-padded to a fixed width so it sorts
 * lexicographically, gives descending order for free.
 */
function popularitySortKey(
  reviews: number | undefined,
  placeId: string,
): string {
  const inverted = REVIEW_CEILING - (reviews ?? 0);
  return `${String(inverted).padStart(7, "0")}#${placeId}`;
}

/**
 * Prefixes to index a title under for search-as-you-type.
 *
 * Words are split on any non-letter, which keeps Arabic tokens intact — Dubai
 * titles are routinely bilingual ("Shamiat Restaurant مطعم شاميات") and a
 * Latin-only index would miss half of what people actually type.
 *
 * Single characters are skipped: a one-letter prefix matches most of the corpus
 * and produces a hot partition for no useful narrowing.
 */
export function typeaheadPrefixes(title: string): string[] {
  const words = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= MIN_PREFIX);

  const prefixes = new Set<string>();
  for (const word of words) {
    const limit = Math.min(word.length, MAX_PREFIX);
    for (let length = MIN_PREFIX; length <= limit; length++) {
      prefixes.add(word.slice(0, length));
      if (prefixes.size >= MAX_PREFIXES_PER_TITLE) return [...prefixes];
    }
  }
  return [...prefixes];
}

/**
 * Stage 4 — shape a business into its DynamoDB items.
 *
 * Single-table design. One canonical business item, plus one small item per
 * title prefix so typeahead is a single `Query` on a partition rather than a
 * scan. Optional attributes are omitted rather than set to undefined, which
 * DynamoDB rejects outright.
 */
export function toItems(business: Business): DynamoItem[] {
  const main: DynamoItem = {
    PK: `BIZ#${business.placeId}`,
    SK: "A#META",
    placeId: business.placeId,
    slug: business.slug,
    title: business.title,
    area: business.area,
    types: business.types,
  };

  if (business.address) main.address = business.address;
  if (business.lat !== undefined) main.lat = business.lat;
  if (business.lng !== undefined) main.lng = business.lng;
  if (business.phoneRaw) main.phoneRaw = business.phoneRaw;
  if (business.phoneType) main.phoneType = business.phoneType;
  if (business.website) main.website = business.website;
  if (business.domain) main.domain = business.domain;
  if (business.rating !== undefined) main.rating = business.rating;
  if (business.reviews !== undefined) main.reviews = business.reviews;
  if (business.thumbnail) main.thumbnail = business.thumbnail;
  if (business.l1) main.l1 = business.l1;
  if (business.l3) main.l3 = business.l3;

  // GSI1 — reverse phone lookup. Only listings with a usable number appear.
  if (business.phoneE164) {
    main.phoneE164 = business.phoneE164;
    main.GSI1PK = `PH#${business.phoneE164}`;
    main.GSI1SK = `BIZ#${business.placeId}`;
  }

  // GSI2 — category x area browse, which backs the programmatic SEO pages.
  // An unmapped business is deliberately absent: it has no page to appear on.
  if (business.l2) {
    main.l2 = business.l2;
    main.GSI2PK = `CAT#${business.l2}#AREA#${business.area}`;
    main.GSI2SK = popularitySortKey(business.reviews, business.placeId);
  }

  const items: DynamoItem[] = [main];

  for (const prefix of typeaheadPrefixes(business.title)) {
    const item: DynamoItem = {
      PK: `PFX#${prefix}`,
      SK: popularitySortKey(business.reviews, business.placeId),
      placeId: business.placeId,
      // Denormalised so a keystroke renders from one Query with no follow-up read.
      title: business.title,
      slug: business.slug,
      area: business.area,
    };
    if (business.l2) item.l2 = business.l2;
    items.push(item);
  }

  return items;
}

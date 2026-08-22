import type { Business } from "./types";
import { corpusPrior, rankScore, type RankPrior } from "./rank";

/**
 * Faceted filtering for a result set.
 *
 * This exists because /search matches far more than it shows: "restaurant"
 * returns 1,496 businesses and renders 50 of them. A filter that narrowed only
 * the rendered 50 would be filtering 3% of the answer while looking like it
 * filtered all of it — the failure the note on FilterableBusinessList warns
 * about, at twenty times the scale. So filtering happens here, over the whole
 * match set, and the counts shown on every chip are counts of the whole match
 * set too.
 *
 * Kept in core, and pure, for the usual two reasons: it is domain logic rather
 * than presentation, and packages/web has no test runner pointed at it.
 */

export type SortKey = "relevance" | "best" | "reviews" | "rating" | "name";

export const SORT_KEYS: readonly SortKey[] = [
  "relevance",
  "best",
  "reviews",
  "rating",
  "name",
];

/** What each sort is called on the page. */
export const SORT_LABELS: Record<SortKey, string> = {
  relevance: "Relevance",
  best: "Best",
  reviews: "Most reviewed",
  rating: "Top rated",
  name: "A–Z",
};

/** Fields whose mere presence is worth filtering on. */
export type PresenceKey = "phone" | "website" | "hours";

export const PRESENCE_LABELS: Record<PresenceKey, string> = {
  phone: "Has phone",
  website: "Has website",
  hours: "Has opening hours",
};

export const PRESENCE_KEYS = Object.keys(PRESENCE_LABELS) as PresenceKey[];

/**
 * Minimum-rating steps.
 *
 * 4.5 is roughly the corpus mean, so it is a real cut rather than a flattering
 * one — 9,251 of 14,981 Dubai listings clear it.
 */
export const RATING_STEPS = [4, 4.5] as const;

/**
 * Minimum-review steps.
 *
 * The corpus median is 64 reviews, so 50 sits just below typical and 500 marks
 * the genuinely well-established. Both are round numbers a reader can hold;
 * "64+" would be a more precise cut of a distribution nobody asked to see.
 */
export const REVIEW_STEPS = [50, 500] as const;

/**
 * Accessibility attributes we offer as filters, and what we call them.
 *
 * An allow-list, mirroring the one in amenities.ts and for the same reason: the
 * engine invents attribute strings, and a facet row that appears on its own is
 * a publishing decision nobody made.
 *
 * The two smallest values are kept despite matching 57 and 10 listings. A
 * facet that matches ten businesses is noise to everyone except the person who
 * needs it, for whom it is the only filter on the page that matters.
 */
export const ACCESSIBILITY_LABELS: Record<string, string> = {
  "wheelchair-accessible-entrance": "Wheelchair-accessible entrance",
  "wheelchair-accessible-car-park": "Wheelchair-accessible car park",
  "wheelchair-accessible-toilet": "Wheelchair-accessible toilet",
  "wheelchair-accessible-seating": "Wheelchair-accessible seating",
  "assistive-hearing-loop": "Assistive hearing loop",
  "assisted-listening-devices": "Assisted listening devices",
  "auracast-broadcast-audio": "Auracast broadcast audio",
};

export const ACCESSIBILITY_VALUES = Object.keys(ACCESSIBILITY_LABELS);

const ALLOWED_ACCESSIBILITY = new Set(ACCESSIBILITY_VALUES);

/**
 * The same physical feature under two spellings.
 *
 * Google returns both — 7,849 Dubai listings say "car park" and 1,742 say
 * "parking lot" — because the strings come from different surfaces rather than
 * from one normalised field. Offering both as separate chips would split one
 * answer in half; offering only one would silently hide the other's listings.
 * British English wins to match the rest of the repo, and is also the larger
 * set in this corpus.
 */
const AMENITY_ALIASES: Record<string, string> = {
  "wheelchair-accessible-parking-lot": "wheelchair-accessible-car-park",
  "wheelchair-accessible-restroom": "wheelchair-accessible-toilet",
};

export function canonicalAmenity(slug: string): string {
  return AMENITY_ALIASES[slug] ?? slug;
}

/**
 * Slug for a category label.
 *
 * Must agree exactly with the slugs already in /category/ URLs — those are
 * live and indexed, and a disagreement would 404 every category link at once.
 * Diacritic folding is the one addition: no Dubai category carries an accent,
 * so nothing changes today, but ADR 0005 says a city is data, and "Cafés" must
 * not slug to "caf-s" the first time somebody crawls Montreal.
 */
export function toCategorySlug(label: string): string {
  return label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ---------------------------------------------------------------- filtering

export interface BusinessFilter {
  /** Category slug, as produced by toCategorySlug. */
  category?: string;
  /** Neighbourhood slug, matched against Business.area. */
  area?: string;
  minRating?: number;
  minReviews?: number;
  /** Every listed field must be present; these AND together. */
  has?: readonly PresenceKey[];
  /** A canonical accessibility value. */
  accessibility?: string;
}

/** The facet groups, which are also the units a count may exclude itself from. */
export type FacetGroup =
  "category" | "area" | "accessibility" | "has" | "rating" | "reviews";

export interface FacetValue {
  /** Goes in the URL. */
  value: string;
  /**
   * Goes on the chip. For an area this is the slug: neighbourhood names live in
   * the city config, which core cannot read without doing I/O, so the web layer
   * resolves them through areaLabel.
   */
  label: string;
  count: number;
  selected: boolean;
}

export type FacetGroups = Record<FacetGroup, FacetValue[]>;

export interface FacetedResult {
  /** Everything that matched, in the order it was given. */
  items: Business[];
  facets: FacetGroups;
  total: number;
}

function presence(business: Business, key: PresenceKey): boolean {
  switch (key) {
    case "phone":
      // phoneE164, not phoneRaw: this is the same field the phone search and
      // stats() count, and a raw string libphonenumber could not parse is not a
      // number anything downstream can act on.
      return Boolean(business.phoneE164);
    case "website":
      return Boolean(business.website);
    case "hours":
      // The normaliser writes `{}` rather than omitting the key, so truthiness
      // alone would let an hours-less listing through.
      return Object.keys(business.openHours ?? {}).length > 0;
  }
}

/**
 * The accessibility attributes of a business, canonicalised and de-duplicated.
 *
 * A Set rather than an array so a listing carrying both spellings of one
 * feature counts once. No listing in the current crawl does, but the two
 * strings come from different Google surfaces, so nothing prevents it.
 */
function accessibilityOf(business: Business): Set<string> {
  const out = new Set<string>();
  for (const raw of business.accessibility ?? []) {
    const canonical = canonicalAmenity(raw);
    if (ALLOWED_ACCESSIBILITY.has(canonical)) out.add(canonical);
  }
  return out;
}

function atLeast(value: number | undefined, floor: number): boolean {
  // A missing rating or review count is absence of evidence, not a pass. Letting
  // it through would put unrated listings inside a "4.5+" result set, which is
  // the one thing that filter promises it does not contain.
  return typeof value === "number" && Number.isFinite(value) && value >= floor;
}

/**
 * Does this business survive the filter?
 *
 * `skip` omits one group's own predicate, which is what makes the counts
 * useful: a facet is counted with every OTHER filter applied but not its own.
 * Without that, picking "Restaurants" would collapse the category list to a
 * single row and leave no way to switch to Cafes without clearing first.
 */
function matches(
  business: Business,
  filter: BusinessFilter,
  skip?: FacetGroup,
): boolean {
  if (skip !== "category" && filter.category) {
    if (!business.l2 || toCategorySlug(business.l2) !== filter.category) {
      return false;
    }
  }
  if (skip !== "area" && filter.area && business.area !== filter.area) {
    return false;
  }
  if (
    skip !== "rating" &&
    filter.minRating !== undefined &&
    !atLeast(business.rating, filter.minRating)
  ) {
    return false;
  }
  if (
    skip !== "reviews" &&
    filter.minReviews !== undefined &&
    !atLeast(business.reviews, filter.minReviews)
  ) {
    return false;
  }
  if (skip !== "has" && filter.has?.length) {
    for (const key of filter.has) {
      if (!presence(business, key)) return false;
    }
  }
  if (skip !== "accessibility" && filter.accessibility) {
    if (!accessibilityOf(business).has(filter.accessibility)) return false;
  }
  return true;
}

/** Title-case a slug, for a selected value with nothing left to label it. */
function humanise(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

interface Tally {
  count: number;
  label?: string;
}

/**
 * Count one open-ended group — category, area, accessibility.
 *
 * "Open-ended" meaning the values come from the data, so a value nothing
 * matches is dropped rather than shown at zero. The exception is the selected
 * value, which stays visible even at zero: otherwise the chip that emptied the
 * page disappears with the results and there is nothing left to click to undo
 * it.
 */
function openGroup(
  businesses: readonly Business[],
  filter: BusinessFilter,
  group: FacetGroup,
  valuesOf: (business: Business) => Iterable<string>,
  labelOf: (business: Business, value: string) => string,
  selected: string | undefined,
  /**
   * Name for a selected value that matched nothing.
   *
   * `labelOf` only ever runs against a business that matched, so the injected
   * zero entry below has no business to take a name from. Without this the
   * fallback is a title-cased slug, which renames the chip at the exact moment
   * the reader needs to recognise it: "Banking & Exchange" loses its ampersand,
   * and "Wheelchair-accessible car park" comes back as "Wheelchair Accessible
   * Car Park" — a string that appears nowhere else on the site.
   */
  labelForValue?: (value: string) => string | undefined,
): FacetValue[] {
  const tallies = new Map<string, Tally>();

  for (const business of businesses) {
    if (!matches(business, filter, group)) continue;
    for (const value of valuesOf(business)) {
      const tally = tallies.get(value) ?? { count: 0 };
      tally.count += 1;
      tally.label ??= labelOf(business, value);
      tallies.set(value, tally);
    }
  }

  if (selected && !tallies.has(selected)) {
    // Built in two shapes rather than one with `label: undefined`, which
    // `exactOptionalPropertyTypes` rejects — an absent key and a key holding
    // undefined are different things here, and the `??` below reads the former.
    const label = labelForValue?.(selected);
    tallies.set(
      selected,
      label === undefined ? { count: 0 } : { count: 0, label },
    );
  }

  return [...tallies.entries()]
    .map(([value, tally]) => ({
      value,
      label: tally.label ?? humanise(value),
      count: tally.count,
      selected: value === selected,
    }))
    .sort(
      // Count first, then label — a tie broken by insertion order would
      // reshuffle the chips between two renders of the same query.
      (a, z) => z.count - a.count || a.label.localeCompare(z.label),
    );
}

/**
 * Count one fixed group — presence toggles and the rating/review thresholds.
 *
 * These keep their declared order and stay visible at zero. They are not
 * values in the data but questions we chose to ask, and a threshold that
 * vanished when nothing met it would quietly change which thresholds exist.
 */
function fixedGroup<T extends string | number>(
  businesses: readonly Business[],
  filter: BusinessFilter,
  group: FacetGroup,
  steps: readonly T[],
  holds: (business: Business, step: T) => boolean,
  label: (step: T) => string,
  isSelected: (step: T) => boolean,
): FacetValue[] {
  const counts = new Map<T, number>(steps.map((step) => [step, 0]));

  for (const business of businesses) {
    if (!matches(business, filter, group)) continue;
    for (const step of steps) {
      if (holds(business, step)) counts.set(step, (counts.get(step) ?? 0) + 1);
    }
  }

  return steps.map((step) => ({
    value: String(step),
    label: label(step),
    count: counts.get(step) ?? 0,
    selected: isSelected(step),
  }));
}

/**
 * Count the presence chips as the result set each one produces.
 *
 * `has` is the only group whose values AND together rather than replace one
 * another, so it cannot be counted the way the single-choice groups are.
 * Excluding the whole group — correct for category, area and the thresholds,
 * where picking a second value replaces the first — would advertise "Has
 * website 2" beside a chip that actually yields 1, a number no click can reach.
 *
 * So each chip is counted against the filter its own link navigates to: every
 * other group applied, the presence keys already chosen kept, and this one
 * added. A selected chip therefore describes the set on screen, and an
 * unselected one describes the set it would leave behind.
 */
function presenceGroup(
  businesses: readonly Business[],
  filter: BusinessFilter,
): FacetValue[] {
  const selected = new Set(filter.has ?? []);

  return PRESENCE_KEYS.map((key) => {
    const required = PRESENCE_KEYS.filter(
      (candidate) => selected.has(candidate) || candidate === key,
    );
    const probe: BusinessFilter = { ...filter, has: required };

    let count = 0;
    for (const business of businesses) {
      if (matches(business, probe)) count += 1;
    }

    return {
      value: key,
      label: PRESENCE_LABELS[key],
      count,
      selected: selected.has(key),
    };
  });
}

/**
 * Apply a filter and count every facet against the result.
 *
 * `businesses` is expected in relevance order and is returned in that order —
 * sorting is a separate decision, made by sortBusinesses.
 */
export function facetSearch(
  businesses: readonly Business[],
  filter: BusinessFilter,
): FacetedResult {
  const items = businesses.filter((business) => matches(business, filter));

  const facets: FacetGroups = {
    category: openGroup(
      businesses,
      filter,
      "category",
      (business) => (business.l2 ? [toCategorySlug(business.l2)] : []),
      (business) => business.l2 ?? "",
      filter.category,
      // Search the whole match set, not just the businesses that survived the
      // other filters — the label is a property of the category, so any listing
      // carrying it will do. Only reached when the chip has fallen to zero.
      (value) =>
        businesses.find(
          (business) => business.l2 && toCategorySlug(business.l2) === value,
        )?.l2,
    ),
    area: openGroup(
      businesses,
      filter,
      "area",
      (business) => [business.area],
      (business) => business.area,
      filter.area,
    ),
    accessibility: openGroup(
      businesses,
      filter,
      "accessibility",
      accessibilityOf,
      (_business, value) => ACCESSIBILITY_LABELS[value] ?? humanise(value),
      filter.accessibility,
      // Always available: the allow-list is the label table, so an
      // accessibility chip never needs the slug fallback at all.
      (value) => ACCESSIBILITY_LABELS[value],
    ),
    has: presenceGroup(businesses, filter),
    rating: fixedGroup(
      businesses,
      filter,
      "rating",
      RATING_STEPS,
      (business, step) => atLeast(business.rating, step),
      (step) => `${step.toFixed(1)}+`,
      (step) => filter.minRating === step,
    ),
    reviews: fixedGroup(
      businesses,
      filter,
      "reviews",
      REVIEW_STEPS,
      (business, step) => atLeast(business.reviews, step),
      (step) => `${step}+ reviews`,
      (step) => filter.minReviews === step,
    ),
  };

  return { items, facets, total: items.length };
}

/** True when any filter is set — the page uses it to offer "Clear all". */
export function hasActiveFilter(filter: BusinessFilter): boolean {
  return Boolean(
    filter.category ||
    filter.area ||
    filter.accessibility ||
    filter.minRating !== undefined ||
    filter.minReviews !== undefined ||
    filter.has?.length,
  );
}

// ---------------------------------------------------------------- sorting

/**
 * Order a result set.
 *
 * "relevance" is the default and returns the input untouched, because the
 * caller has already scored it: an exact title match must stay above the
 * best-ranked business in the corpus. This is where /search differs from a
 * category page, which has no relevance signal and so defaults to "best".
 */
export function sortBusinesses(
  businesses: readonly Business[],
  sort: SortKey,
  prior?: RankPrior,
): Business[] {
  const copy = [...businesses];
  if (sort === "relevance") return copy;

  if (sort === "best") {
    // Derived from the set being sorted when the caller has no corpus-wide
    // prior to offer. See rank.ts for why the prior matters at all.
    const p = prior ?? corpusPrior(copy);
    return copy.sort(
      (a, z) =>
        rankScore(z.rating, z.reviews, p) - rankScore(a.rating, a.reviews, p),
    );
  }
  if (sort === "reviews") {
    return copy.sort((a, z) => (z.reviews ?? 0) - (a.reviews ?? 0));
  }
  if (sort === "rating") {
    return copy.sort((a, z) => (z.rating ?? 0) - (a.rating ?? 0));
  }
  // localeCompare, not <: bilingual titles are the norm here, and a code-point
  // sort files every accented and non-Latin name after Z.
  return copy.sort((a, z) => a.title.localeCompare(z.title));
}

// ---------------------------------------------------------------- paging

export interface PageSlice<T> {
  items: T[];
  /** 1-based, clamped into range. */
  page: number;
  pages: number;
  perPage: number;
  /** 1-based display bounds; both 0 when there is nothing to show. */
  from: number;
  to: number;
  total: number;
}

export function paginate<T>(
  items: readonly T[],
  page: number,
  perPage: number,
): PageSlice<T> {
  const total = items.length;
  const size = Math.max(1, Math.floor(perPage));
  const pages = Math.max(1, Math.ceil(total / size));

  // ?page=999 is a stale link or a crawler, not an error worth a 404. Clamping
  // shows the last page; failing would lose the query as well as the page.
  const requested = Number.isFinite(page) ? Math.floor(page) : 1;
  const current = Math.min(Math.max(requested, 1), pages);

  const start = (current - 1) * size;
  const slice = items.slice(start, start + size);

  return {
    items: slice,
    page: current,
    pages,
    perPage: size,
    from: total === 0 ? 0 : start + 1,
    to: total === 0 ? 0 : start + slice.length,
    total,
  };
}

// ---------------------------------------------------------------- the URL

/**
 * The query-string names, in one place.
 *
 * Short, because these are read and shared by people: `?q=restaurant&cat=cafes`
 * rather than `?query=…&categorySlug=…`. /search is `robots: noindex`, so the
 * permutations cost no crawl budget — the reason a filter can live in the URL
 * at all here, when it could not on an indexed page.
 */
export const SEARCH_PARAMS = {
  query: "q",
  category: "cat",
  area: "area",
  rating: "rating",
  reviews: "reviews",
  has: "has",
  accessibility: "access",
  sort: "sort",
  page: "page",
} as const;

/** What Next hands a page for one search param. A repeated key arrives as an array. */
export type QueryValue = string | string[] | undefined;

export type SearchQuery = Partial<Record<string, QueryValue>>;

function first(value: QueryValue): string | undefined {
  const single = Array.isArray(value) ? value[0] : value;
  return typeof single === "string" && single !== "" ? single : undefined;
}

/**
 * Slug shape, enforced before a value reaches a lookup or a rendered link.
 *
 * The length cap is not decoration: without it a megabyte-long parameter is a
 * megabyte-long regex subject on every request.
 */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 80;

function slugParam(value: QueryValue): string | undefined {
  const raw = first(value);
  if (!raw || raw.length > MAX_SLUG_LENGTH || !SLUG_PATTERN.test(raw)) {
    return undefined;
  }
  return raw;
}

/**
 * A threshold, accepted only if it is one of the steps actually on offer.
 *
 * ?rating=4.9 would otherwise render a page whose chips all read "unselected"
 * while the results were silently filtered by something the reader was never
 * shown.
 */
function stepParam<T extends number>(
  value: QueryValue,
  steps: readonly T[],
): T | undefined {
  const raw = first(value);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return steps.find((step) => step === parsed);
}

function presenceParam(value: QueryValue): PresenceKey[] | undefined {
  const raw = first(value);
  if (!raw) return undefined;
  const requested = new Set(raw.split(",").map((part) => part.trim()));
  // Filtering the declared list rather than the request de-duplicates and fixes
  // the order in one pass, so ?has=website,phone and ?has=phone,website are the
  // same filter.
  const keys = PRESENCE_KEYS.filter((key) => requested.has(key));
  return keys.length > 0 ? keys : undefined;
}

function accessibilityParam(value: QueryValue): string | undefined {
  const raw = slugParam(value);
  if (!raw) return undefined;
  // Canonicalise on the way in, so a link shared before the two spellings were
  // folded together still selects the chip it was meant to.
  const canonical = canonicalAmenity(raw);
  return ALLOWED_ACCESSIBILITY.has(canonical) ? canonical : undefined;
}

/** Read a filter off the query string, discarding anything not on offer. */
export function parseFilter(query: SearchQuery): BusinessFilter {
  const filter: BusinessFilter = {};

  const category = slugParam(query[SEARCH_PARAMS.category]);
  if (category) filter.category = category;

  const area = slugParam(query[SEARCH_PARAMS.area]);
  if (area) filter.area = area;

  const minRating = stepParam(query[SEARCH_PARAMS.rating], RATING_STEPS);
  if (minRating !== undefined) filter.minRating = minRating;

  const minReviews = stepParam(query[SEARCH_PARAMS.reviews], REVIEW_STEPS);
  if (minReviews !== undefined) filter.minReviews = minReviews;

  const has = presenceParam(query[SEARCH_PARAMS.has]);
  if (has) filter.has = has;

  const accessibility = accessibilityParam(query[SEARCH_PARAMS.accessibility]);
  if (accessibility) filter.accessibility = accessibility;

  return filter;
}

/** Read a sort key off a URL a stranger can edit. */
export function parseSortKey(value: QueryValue): SortKey {
  const raw = first(value);
  return SORT_KEYS.includes(raw as SortKey) ? (raw as SortKey) : "relevance";
}

/** 1-based. Anything else is a stale link or a crawler; start at the top. */
export function parsePage(value: QueryValue): number {
  const raw = first(value);
  // Digits only, so "-2" and "1e9" are rejected rather than coerced into a
  // number that then has to be defended against downstream.
  if (raw === undefined || !/^\d+$/.test(raw)) return 1;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : 1;
}

/** Serialise a filter back into query parameters. Unset groups are omitted. */
export function filterToQuery(filter: BusinessFilter): Record<string, string> {
  const query: Record<string, string> = {};
  if (filter.category) query[SEARCH_PARAMS.category] = filter.category;
  if (filter.area) query[SEARCH_PARAMS.area] = filter.area;
  if (filter.minRating !== undefined) {
    // String(4) is "4", not "4.0". The parse accepts both, but only one of them
    // is the URL people see and share.
    query[SEARCH_PARAMS.rating] = String(filter.minRating);
  }
  if (filter.minReviews !== undefined) {
    query[SEARCH_PARAMS.reviews] = String(filter.minReviews);
  }
  if (filter.has?.length) query[SEARCH_PARAMS.has] = filter.has.join(",");
  if (filter.accessibility) {
    query[SEARCH_PARAMS.accessibility] = filter.accessibility;
  }
  return query;
}

/**
 * The filter you get by clicking one chip.
 *
 * Selecting a value that is already selected clears it, so every chip is its
 * own off switch — without that, the only way out of a filter is Clear all,
 * which also throws away the other three. A value the group does not offer is
 * ignored rather than rejected: it can only come from a hand-edited URL, and
 * the useful response is the page the reader was already looking at.
 *
 * Pure, because the page renders one href per chip from a single base filter.
 */
export function toggleFilter(
  filter: BusinessFilter,
  group: FacetGroup,
  value: string,
): BusinessFilter {
  const next: BusinessFilter = { ...filter };
  if (filter.has) next.has = [...filter.has];

  switch (group) {
    case "category": {
      const slug = slugParam(value);
      if (slug) {
        if (next.category === slug) delete next.category;
        else next.category = slug;
      }
      return next;
    }
    case "area": {
      const slug = slugParam(value);
      if (slug) {
        if (next.area === slug) delete next.area;
        else next.area = slug;
      }
      return next;
    }
    case "accessibility": {
      const slug = accessibilityParam(value);
      if (slug) {
        if (next.accessibility === slug) delete next.accessibility;
        else next.accessibility = slug;
      }
      return next;
    }
    case "rating": {
      const step = stepParam(value, RATING_STEPS);
      if (step !== undefined) {
        if (next.minRating === step) delete next.minRating;
        else next.minRating = step;
      }
      return next;
    }
    case "reviews": {
      const step = stepParam(value, REVIEW_STEPS);
      if (step !== undefined) {
        if (next.minReviews === step) delete next.minReviews;
        else next.minReviews = step;
      }
      return next;
    }
    case "has": {
      const key = PRESENCE_KEYS.find((candidate) => candidate === value);
      if (!key) return next;
      const current = next.has ?? [];
      const updated = current.includes(key)
        ? current.filter((existing) => existing !== key)
        : PRESENCE_KEYS.filter(
            (candidate) => current.includes(candidate) || candidate === key,
          );
      // An empty array would serialise to `?has=` — a filter that reads as set,
      // matches everything, and cannot be cleared from the UI.
      if (updated.length > 0) next.has = updated;
      else delete next.has;
      return next;
    }
  }
}

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Business } from "@directory/core";
import { toCategorySlug } from "@directory/core";

/**
 * Data access for the site.
 *
 * Every query below is a linear scan of the crawl output, loaded once per
 * container. That is Milestone 1's stopgap, not the architecture — this
 * package has no DynamoDB client at all — and the dataset itself is never
 * committed (ADR 0002).
 *
 * The signatures are kept index-shaped so Milestone 2 can swap the backend
 * without rewriting a single page. Each one already has a table index waiting
 * for it, written by packages/pipeline:
 *
 *   bySlug / byArea / byCategory  -> GSI2  CAT#{l2}#AREA#{area}
 *   byPhone                       -> GSI1  PH#{e164}
 *   typeahead                     -> PFX#{prefix} partitions
 */

let businessCache: Business[] | null = null;
let areaNameCache: Map<string, string> | null = null;

/**
 * Resolve a bundled data file.
 *
 * Everything the site reads is copied into `.data/` by scripts/bundle-data.mjs,
 * which runs at both `predev` and `prebuild`, and reaches the server bundle via
 * `outputFileTracingIncludes` in next.config.ts.
 *
 * There is deliberately no fallback to the repo root, and the single static
 * path is the whole point. Next traces the files a route needs by reading the
 * source: a path it cannot resolve statically makes it give up and wildcard the
 * directory instead. With a `process.cwd()/../..` fallback here it did exactly
 * that — `page.js.nft.json` listed 1,679 files, 1,400 of them raw crawl archive
 * carrying 20,226 verbatim Google review snippets, some naming individual
 * employees. None of it is read by any code, all of it would have shipped
 * inside the Lambda, and republishing it is the thing packages/core/src/reviews.ts
 * refuses to do on purpose.
 */
function dataFile(bundled: string): string {
  return join(process.cwd(), ".data", bundled);
}

export function allBusinesses(): Business[] {
  if (businessCache) return businessCache;
  try {
    businessCache = JSON.parse(
      readFileSync(dataFile("businesses.json"), "utf8"),
    ) as Business[];
  } catch {
    // No crawl has run yet. An empty directory is a valid state — pages render
    // an honest empty state rather than crashing the build.
    businessCache = [];
  }
  return businessCache;
}

/**
 * Human-readable neighbourhood names, from the committed city config.
 *
 * DIRECTORY_CITY selects which city this deployment serves, so the same app
 * builds for any city the toolkit supports (ADR 0005).
 */
export const CITY_ID = process.env.DIRECTORY_CITY ?? "dubai";

export function areaNames(): Map<string, string> {
  if (areaNameCache) return areaNameCache;
  areaNameCache = new Map();
  try {
    const parsed = JSON.parse(readFileSync(dataFile("city.json"), "utf8")) as {
      tiles: Array<{ id: string; name: string }>;
    };
    for (const tile of parsed.tiles) areaNameCache.set(tile.id, tile.name);
  } catch {
    /* fall back to the slug itself */
  }
  return areaNameCache;
}

export function areaLabel(area: string): string {
  return areaNames().get(area) ?? titleCase(area);
}

let cityNameCache: string | null = null;

/**
 * The city this deployment serves, by name.
 *
 * Read from the committed city config rather than written into copy, because
 * ADR 0005 says a city is data: the homepage description, the OG card and the
 * JSON-LD all need this string, and a fork must not inherit "Dubai" from any of
 * them. Falls back to the id so an unconfigured deployment still renders.
 */
export function cityName(): string {
  if (cityNameCache) return cityNameCache;
  try {
    const parsed = JSON.parse(readFileSync(dataFile("city.json"), "utf8")) as {
      name?: string;
    };
    cityNameCache = parsed.name ?? titleCase(CITY_ID);
  } catch {
    cityNameCache = titleCase(CITY_ID);
  }
  return cityNameCache;
}

/**
 * The date this deployment's corpus was crawled, from the city config's own
 * verification block — "2026-08-20" — or null if this city has never been
 * crawled.
 *
 * Local business data decays monthly, and answer engines discount undated local
 * content. The site had no freshness signal anywhere: no dateModified, no
 * visible "last updated", no <time> element on any route. This is the honest
 * one to publish, because it is the date the data was actually retrieved rather
 * than the date the page was rendered — a render timestamp would refresh itself
 * every deploy while the underlying listings sat still, which is the dishonest
 * version of this signal.
 */
export function crawledAt(): string | null {
  if (crawledAtCache !== undefined) return crawledAtCache;
  try {
    const parsed = JSON.parse(readFileSync(dataFile("city.json"), "utf8")) as {
      verification?: { crawledAt?: string };
    };
    crawledAtCache = parsed.verification?.crawledAt ?? null;
  } catch {
    crawledAtCache = null;
  }
  return crawledAtCache;
}

let crawledAtCache: string | null | undefined;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * "2026-08-20" -> "20 August 2026".
 *
 * Formatted from the string's own parts rather than through Date. Parsing a
 * bare ISO date yields UTC midnight, and any locale-aware formatter then
 * renders it a day early in every timezone behind UTC — which, for a site whose
 * whole audience sits at UTC+4, would be wrong in the one place it is read.
 */
export function formatCrawlDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  const name = MONTHS[Number(month) - 1];
  if (!year || !name || !day) return iso;
  return `${Number(day)} ${name} ${year}`;
}

function titleCase(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Category slug.
 *
 * One definition, in core, because the search facets have to produce byte-identical
 * slugs to the ones already in /category/ URLs — two implementations would
 * drift and take every category link with them.
 */
export const slugify = toCategorySlug;

// ---------------------------------------------------------------- lookups

export function getBySlug(slug: string): Business | undefined {
  return allBusinesses().find((b) => b.slug === slug);
}

export function byPhone(e164: string): Business[] {
  const normalised = e164.startsWith("+") ? e164 : `+${e164}`;
  return allBusinesses().filter((b) => b.phoneE164 === normalised);
}

export function byArea(area: string): Business[] {
  return allBusinesses().filter((b) => b.area === area);
}

export function byCategory(l2Slug: string): Business[] {
  return allBusinesses().filter((b) => b.l2 && slugify(b.l2) === l2Slug);
}

export function byAreaCategory(area: string, l2Slug: string): Business[] {
  return allBusinesses().filter(
    (b) => b.area === area && b.l2 && slugify(b.l2) === l2Slug,
  );
}

// ---------------------------------------------------------------- facets

/**
 * Below this many listings, a facet page has nothing to say and stays out of the
 * index — reachable, crawlable, but not submitted and not indexable.
 *
 * One definition, because it was three: area/[area]/[l2] enforced it, sitemap.ts
 * declared its own copy and applied it to ONE of its three facet loops, and the
 * /category and /area hubs enforced it nowhere — so nine categories and four
 * neighbourhoods with one or two listings were indexable at priority 0.7,
 * carrying descriptions like "1 catering in Dubai, by neighbourhood."
 *
 * Thirteen URLs of ~15,900 is not a thin-content emergency. It is fixed here so
 * the rule the code already states in a comment — "thousands of one-result pages
 * drag down a whole domain, not just themselves" — is actually the rule the code
 * applies, on every tier, from one constant.
 */
export const MIN_FOR_INDEX = 3;

export interface Facet {
  slug: string;
  label: string;
  count: number;
}

export function categories(): Facet[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const b of allBusinesses()) {
    if (!b.l2) continue;
    const slug = slugify(b.l2);
    const entry = counts.get(slug) ?? { label: b.l2, count: 0 };
    entry.count++;
    counts.set(slug, entry);
  }
  return [...counts.entries()]
    .map(([slug, v]) => ({ slug, label: v.label, count: v.count }))
    .sort((a, b) => b.count - a.count);
}

export function areas(): Facet[] {
  const counts = new Map<string, number>();
  for (const b of allBusinesses()) {
    counts.set(b.area, (counts.get(b.area) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([slug, count]) => ({ slug, label: areaLabel(slug), count }))
    .sort((a, b) => b.count - a.count);
}

export function categoriesInArea(area: string): Facet[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const b of byArea(area)) {
    if (!b.l2) continue;
    const slug = slugify(b.l2);
    const entry = counts.get(slug) ?? { label: b.l2, count: 0 };
    entry.count++;
    counts.set(slug, entry);
  }
  return [...counts.entries()]
    .map(([slug, v]) => ({ slug, label: v.label, count: v.count }))
    .sort((a, b) => b.count - a.count);
}

export function areasInCategory(l2Slug: string): Facet[] {
  const counts = new Map<string, number>();
  for (const b of byCategory(l2Slug)) {
    counts.set(b.area, (counts.get(b.area) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([slug, count]) => ({ slug, label: areaLabel(slug), count }))
    .sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------- search

/** Strip diacritics and case so "Trèsind" matches a plain "tresind" query. */
function fold(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

const PHONE_QUERY = /^[\d\s+()-]{6,}$/;

export function looksLikePhone(query: string): boolean {
  return PHONE_QUERY.test(query.trim());
}

/**
 * Convert a typed UAE phone number into E.164 for lookup. Accepts the shapes
 * people actually type: 04 577 6680, 045776680, +97145776680, 0097145776680.
 */
export function phoneQueryToE164(query: string): string | null {
  const digits = query.replace(/\D/g, "");
  if (digits.length < 7) return null;
  if (digits.startsWith("00971")) return `+${digits.slice(2)}`;
  if (digits.startsWith("971")) return `+${digits}`;
  if (digits.startsWith("0")) return `+971${digits.slice(1)}`;
  return `+971${digits}`;
}

export interface SearchResult {
  businesses: Business[];
  /** True when the query was read as a phone number rather than a name. */
  matchedByPhone: boolean;
  total: number;
}

/**
 * Every business matching a query, in relevance order.
 *
 * Deliberately uncapped. The page shows 50 at a time, but the filters and their
 * counts run over the whole match set — "restaurant" matches 1,496 businesses,
 * and a filter that saw only the rendered 50 would be narrowing 3% of the
 * answer while looking like it narrowed all of it. Truncation is the caller's
 * decision, taken after filtering, by paginate().
 */
export function search(query: string): SearchResult {
  const trimmed = query.trim();
  if (!trimmed) return { businesses: [], matchedByPhone: false, total: 0 };

  if (looksLikePhone(trimmed)) {
    const e164 = phoneQueryToE164(trimmed);
    if (e164) {
      const hits = byPhone(e164);
      if (hits.length > 0) {
        return { businesses: hits, matchedByPhone: true, total: hits.length };
      }
    }
  }

  const needle = fold(trimmed);
  const scored: Array<{ business: Business; score: number }> = [];

  for (const b of allBusinesses()) {
    const title = fold(b.title);
    let score = 0;
    if (title === needle) score = 1000;
    else if (title.startsWith(needle)) score = 500;
    else if (title.includes(needle)) score = 250;
    else if (b.l2 && fold(b.l2).includes(needle)) score = 100;
    else if (b.l3 && fold(b.l3).includes(needle)) score = 100;
    else if (b.types.some((t) => fold(t).includes(needle))) score = 50;
    else if (fold(areaLabel(b.area)).includes(needle)) score = 25;
    if (score === 0) continue;
    // Popularity breaks ties, so a well-reviewed match outranks an obscure one.
    scored.push({
      business: b,
      score: score + Math.log10((b.reviews ?? 0) + 1),
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return {
    businesses: scored.map((s) => s.business),
    matchedByPhone: false,
    total: scored.length,
  };
}

export interface Suggestion {
  slug: string;
  title: string;
  label: string;
}

/** Search-as-you-type. Mirrors the PFX# partitions the loader writes. */
export function typeahead(prefix: string, limit = 8): Suggestion[] {
  const needle = fold(prefix.trim());
  if (needle.length < 2) return [];

  const starts: Business[] = [];
  const contains: Business[] = [];
  for (const b of allBusinesses()) {
    const title = fold(b.title);
    if (title.startsWith(needle)) starts.push(b);
    else if (title.includes(needle)) contains.push(b);
    if (starts.length >= limit) break;
  }

  const byReviews = (a: Business, b: Business) =>
    (b.reviews ?? 0) - (a.reviews ?? 0);

  return [...starts.sort(byReviews), ...contains.sort(byReviews)]
    .slice(0, limit)
    .map((b) => ({
      slug: b.slug,
      title: b.title,
      label: [b.l2, areaLabel(b.area)].filter(Boolean).join(" · "),
    }));
}

export function stats() {
  const all = allBusinesses();
  return {
    businesses: all.length,
    withPhone: all.filter((b) => b.phoneE164).length,
    categories: categories().length,
    areas: areas().length,
  };
}

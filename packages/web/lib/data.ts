import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Business } from "@directory/core";

/**
 * Data access for the site.
 *
 * In local development this reads the crawl output from data/out/, which is
 * git-ignored — the dataset is never committed (ADR 0002). In production the
 * same functions are backed by DynamoDB; every query below maps onto an index
 * that already exists in the table:
 *
 *   bySlug / byArea / byCategory  -> GSI2  CAT#{l2}#AREA#{area}
 *   byPhone                       -> GSI1  PH#{e164}
 *   typeahead                     -> PFX#{prefix} partitions
 *
 * Keeping the signatures index-shaped is the point: swapping the backend must
 * not require rewriting a single page.
 */

let businessCache: Business[] | null = null;
let areaNameCache: Map<string, string> | null = null;

/**
 * Resolve a data file.
 *
 * Bundled copy first: inside a Lambda the repo root does not exist, so
 * `.data/` — populated at prebuild and included via outputFileTracingIncludes —
 * is the only path that resolves. Falling back to the repo root keeps local
 * development working straight after a crawl, with no build step.
 */
function dataFile(bundled: string, repoRelative: string): string {
  const local = join(process.cwd(), ".data", bundled);
  if (existsSync(local)) return local;
  return join(process.cwd(), "..", "..", repoRelative);
}

export function allBusinesses(): Business[] {
  if (businessCache) return businessCache;
  try {
    businessCache = JSON.parse(
      readFileSync(
        dataFile("businesses.json", "data/out/businesses.json"),
        "utf8",
      ),
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
    const parsed = JSON.parse(
      readFileSync(
        dataFile("city.json", `data/cities/${CITY_ID}.json`),
        "utf8",
      ),
    ) as { tiles: Array<{ id: string; name: string }> };
    for (const tile of parsed.tiles) areaNameCache.set(tile.id, tile.name);
  } catch {
    /* fall back to the slug itself */
  }
  return areaNameCache;
}

export function areaLabel(area: string): string {
  return areaNames().get(area) ?? titleCase(area);
}

function titleCase(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

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

export function search(query: string, limit = 50): SearchResult {
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
    businesses: scored.slice(0, limit).map((s) => s.business),
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

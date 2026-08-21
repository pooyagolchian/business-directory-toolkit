import { readFileSync } from "node:fs";
import { join } from "node:path";
import { slugify } from "./data";

/**
 * Measured search demand, from SearchApi's autocomplete engine.
 *
 * Google orders autocomplete by real query popularity, so this is what people
 * actually search for — as opposed to what the crawl happened to find. The two
 * disagree sharply: Restaurants has 1,172 listings but people name only four
 * neighbourhoods; Nurseries has 216 listings and people name seven.
 *
 * This is what should decide which of the ~2,000 possible area x category
 * pages get built. Generating every combination and hoping is the default
 * approach to programmatic SEO; selecting from measured demand is cheaper to
 * build, cheaper to crawl, and far likelier to rank.
 */

interface RawDemand {
  category: string;
  suggestions: Array<{ query: string; rank: number; area?: string }>;
  areasInDemand: string[];
}

let cache: RawDemand[] | null = null;

function load(): RawDemand[] {
  if (cache) return cache;
  try {
    cache = JSON.parse(
      readFileSync(join(process.cwd(), "..", "..", "data/demand.json"), "utf8"),
    ) as RawDemand[];
  } catch {
    // Demand is an enhancement, not a dependency. Without it the site falls
    // back to ranking by supply, which is what it did before.
    cache = [];
  }
  return cache;
}

export interface DemandedPage {
  area: string;
  l2Slug: string;
  /** Lower is more searched. 0 is the top autocomplete suggestion. */
  rank: number;
}

/**
 * The area x category combinations people demonstrably search for,
 * most-searched first.
 */
export function demandedPages(): DemandedPage[] {
  const pages: DemandedPage[] = [];
  for (const entry of load()) {
    const l2Slug = slugify(entry.category);
    for (const suggestion of entry.suggestions) {
      if (!suggestion.area) continue;
      pages.push({ area: suggestion.area, l2Slug, rank: suggestion.rank });
    }
  }
  // Keep the best rank per combination, then order by it.
  const best = new Map<string, DemandedPage>();
  for (const page of pages) {
    const key = `${page.area}/${page.l2Slug}`;
    const existing = best.get(key);
    if (!existing || page.rank < existing.rank) best.set(key, page);
  }
  return [...best.values()].sort((a, b) => a.rank - b.rank);
}

/** Ranked queries people type for a category, for display and for copy. */
export function popularQueries(category: string, limit = 6): string[] {
  const entry = load().find((d) => d.category === category);
  if (!entry) return [];
  return entry.suggestions.slice(0, limit).map((s) => s.query);
}

/** True when this exact combination shows up in real search queries. */
export function isDemanded(area: string, l2Slug: string): boolean {
  return demandedPages().some((p) => p.area === area && p.l2Slug === l2Slug);
}

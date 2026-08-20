import type { RawLocalResult, TaxonomyMap, TaxonomyNode } from "./types.js";

/**
 * Every category string a record carries, primary `type` first, then `types[]`
 * in Google's own order, deduplicated.
 */
function candidateCategories(record: RawLocalResult): string[] {
  const out: string[] = [];
  if (record.type) out.push(record.type);
  for (const t of record.types ?? []) {
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

/**
 * The distinct category vocabulary across a corpus.
 *
 * This is the input to the project's central cost decision: classify these
 * strings once, then apply the result to every business by lookup. Sorted so
 * that `data/taxonomy-map.json` produces clean diffs when it is regenerated.
 */
export function distinctCategories(records: RawLocalResult[]): string[] {
  const set = new Set<string>();
  for (const record of records) {
    for (const category of candidateCategories(record)) set.add(category);
  }
  return [...set].sort();
}

/**
 * Resolve a business onto a single taxonomy node.
 *
 * A business can carry nine overlapping category strings — one probed
 * restaurant listed Restaurant, Bar & grill, Cocktail bar, Seafood restaurant
 * and Steak house simultaneously. Two rules keep that sane:
 *
 * 1. **The primary category anchors L1/L2.** Google's `type` field says what
 *    the business fundamentally is. Picking the "deepest" match across all
 *    categories would file that restaurant under Bars, because "Cocktail bar"
 *    happens to appear earlier in the array than "Seafood restaurant".
 * 2. **Refine to L3 only within that branch.** Among the remaining categories,
 *    the first that sharpens the anchor wins.
 *
 * Returns null when nothing maps. Unmapped categories must surface for a real
 * decision rather than being silently bucketed into "Other".
 */
export function applyTaxonomy(
  record: RawLocalResult,
  map: TaxonomyMap,
): TaxonomyNode | null {
  const candidates = candidateCategories(record);

  let anchor: TaxonomyNode | undefined;
  for (const category of candidates) {
    const node = map[category];
    if (node) {
      anchor = node;
      break;
    }
  }
  if (!anchor) return null;
  if (anchor.l3) return anchor;

  for (const category of candidates) {
    const node = map[category];
    if (node && node.l1 === anchor.l1 && node.l2 === anchor.l2 && node.l3) {
      return node;
    }
  }
  return anchor;
}

import type { RawLocalResult, TaxonomyMap, TaxonomyNode } from "./types";

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

  const refinements: TaxonomyNode[] = [];
  for (const category of candidates) {
    const node = map[category];
    if (node && node.l1 === anchor.l1 && node.l2 === anchor.l2 && node.l3) {
      refinements.push(node);
    }
  }

  const first = refinements[0];
  if (!first) return anchor;
  if (refinements.length === 1) return first;

  // Several sub-categories compete. Array position cannot decide this:
  // measured across the probe corpus, 85% of types[] tails come back
  // ALPHABETICALLY sorted, so Google's ordering carries no relevance signal at
  // all. Taking the first match filed a seafood-and-steak restaurant under
  // "Grill" purely because "Bar & grill" sorts before "Seafood restaurant".
  //
  // The business's own words do carry signal, so ask them.
  const text =
    `${record.title ?? ""} ${record.description ?? ""}`.toLowerCase();
  const described = refinements.find(
    (node) => node.l3 !== undefined && text.includes(node.l3.toLowerCase()),
  );

  // With no signal either way, be deterministic rather than accidentally
  // arbitrary — a stable choice at least reproduces across runs.
  return described ?? first;
}

/**
 * Does a business sit under the given category, at any level of the taxonomy?
 *
 * All three levels are checked, and that is the whole point. The export CLI
 * compared only `l2` and `l3`, so `pnpm export --category "Health & Medical"`
 * reported "Exported 0 businesses" against a corpus containing 2,068 of them.
 * Nothing failed — an empty export reads exactly like a category nobody
 * crawled, which is the shape of quiet wrongness ADR 0007 exists to argue
 * against.
 *
 * Matching is exact after trimming and lowercasing, never a substring. An
 * operator who asks for "Health" and silently receives "Health & Medical" has
 * no way to notice they got a broader set than they requested — and the
 * asymmetry matters, because an export is usually the last step before the
 * rows are handed to somebody else.
 */
export function matchesCategory(
  business: { l1?: string; l2?: string; l3?: string },
  category: string,
): boolean {
  const needle = category.trim().toLowerCase();
  if (needle === "") return false;
  return [business.l1, business.l2, business.l3].some(
    (level) => level?.trim().toLowerCase() === needle,
  );
}

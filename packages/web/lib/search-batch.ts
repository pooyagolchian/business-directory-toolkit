import type { CardRow } from "@/components/business-row";

/**
 * One appended batch of search results.
 *
 * Declared here rather than in the route that produces it, because the client
 * component consumes it too and must not import that module even for a type —
 * the route reaches searchView and therefore `node:fs`. A type-only import
 * would erase, but the rule that keeps this boundary honest is "the client
 * never names a server module", not "the client never names one at runtime".
 */
export interface SearchBatch {
  rows: CardRow[];
  /** The batch these rows are, 1-based and already clamped. */
  page: number;
  pages: number;
  /** 1-based display bounds of this batch within the filtered set. */
  from: number;
  to: number;
  /** Filtered total. */
  total: number;
}

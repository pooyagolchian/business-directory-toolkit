import type { RawLocalResult } from "./types";

export interface DedupeResult {
  unique: RawLocalResult[];
  /** Records dropped because their place_id was already seen. */
  duplicatesRemoved: number;
  /** Records dropped because they carried no place_id. */
  skippedNoPlaceId: number;
}

/**
 * Collapse a crawl's results to one record per business.
 *
 * Google repeats businesses across pages of the same query — measured at ~12%
 * within a single query stream — and a business tagged with several categories
 * appears once per category crawl. `place_id` is the only stable identity:
 * `data_id` and `ludocid` are retained on the record but are not safe keys.
 *
 * First occurrence wins. Earlier pages rank higher, so the first sighting is
 * the more prominent listing.
 */
export function dedupeByPlaceId(records: RawLocalResult[]): DedupeResult {
  const seen = new Set<string>();
  const unique: RawLocalResult[] = [];
  let duplicatesRemoved = 0;
  let skippedNoPlaceId = 0;

  for (const record of records) {
    const id = record.place_id;
    if (!id) {
      // Without an identity we cannot dedupe it, and admitting it risks the
      // same business appearing twice under different slugs.
      skippedNoPlaceId++;
      continue;
    }
    if (seen.has(id)) {
      duplicatesRemoved++;
      continue;
    }
    seen.add(id);
    unique.push(record);
  }

  return { unique, duplicatesRemoved, skippedNoPlaceId };
}

/**
 * Takedown suppression.
 *
 * TAKEDOWN.md tells a business owner that once their listing is removed it
 * "stays removed — it will not reappear after the next crawl", and the site
 * repeats that promise in its footer. Nothing enforces a promise like that by
 * itself: the crawl is a pure function of what Google returns, so a suppressed
 * business comes straight back on the next run unless something drops it.
 *
 * This is that something. It runs on the load path rather than the fetch path
 * deliberately — a takedown is about what gets published, and the load stage is
 * the single point both a fresh crawl and a replay from the raw archive pass
 * through. Filtering at fetch time would leave the archive as a way back in.
 *
 * The list holds opaque Google `place_id` values and nothing else. Storing a
 * name or a phone number in order to remember not to publish a name or a phone
 * number would defeat the purpose, and unlike the dataset this file IS
 * committed — a suppression list that only exists on one laptop protects
 * nobody.
 */

/**
 * Either spelling of the identifier.
 *
 * Raw engine records use `place_id`; normalised Business records use
 * `placeId`. Suppression must apply to both — a filter that only understands
 * one shape protects only half the pipeline, and the half it misses is the one
 * that reaches users.
 */
export interface Identifiable {
  place_id?: string | undefined;
  placeId?: string | undefined;
}

export interface SuppressionResult<T> {
  kept: T[];
  /** How many records the list removed, so a load can report it rather than lose them quietly. */
  removed: number;
}

/**
 * Extract the identifier, preferring the raw engine key over the normalised one.
 *
 * `place_id` is the raw engine key, closest to the source of truth that the
 * suppression list is written against. If a record ever carried both keys
 * (which the normaliser deliberately avoids), place_id wins so suppression
 * enforces the takedown promise even in pathological cases.
 */
function identifierOf(item: Identifiable): string | undefined {
  return item.place_id ?? item.placeId;
}

/**
 * Parse a suppression list, rejecting anything malformed.
 *
 * This throws rather than returning an empty set on bad input, because the two
 * outcomes look identical from the outside and only one of them is safe. The
 * file gets hand-edited during a takedown request, which is exactly when a
 * typo is most likely and least likely to be noticed.
 */
export function parseSuppressionList(json: string): Set<string> {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) {
    throw new Error(
      "Suppression list must be a JSON array of place_id strings.",
    );
  }
  const ids = new Set<string>();
  for (const entry of parsed) {
    if (typeof entry !== "string") {
      throw new Error(
        `Suppression list must contain only strings; found ${typeof entry}.`,
      );
    }
    const trimmed = entry.trim();
    if (trimmed) ids.add(trimmed);
  }
  return ids;
}

/** Drop every record whose identifier appears in the suppression list. */
export function dropSuppressed<T extends Identifiable>(
  records: readonly T[],
  suppressed: ReadonlySet<string>,
): SuppressionResult<T> {
  if (suppressed.size === 0) return { kept: [...records], removed: 0 };

  const kept: T[] = [];
  let removed = 0;
  for (const record of records) {
    // A record with no place_id cannot be matched against the list. Dedupe
    // already drops those; keeping them here means suppression never becomes a
    // second, silent reason for a record to disappear.
    const id = identifierOf(record);
    if (id && suppressed.has(id)) {
      removed++;
      continue;
    }
    kept.push(record);
  }
  return { kept, removed };
}

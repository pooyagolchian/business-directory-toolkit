/**
 * Carry businesses over from the previous dataset into the next one.
 *
 * A crawl is a sample of Google, not a census. The same tiles and categories
 * return a slightly different set every run, so rebuilding the directory from
 * the newest crawl alone shrinks it: the live set held 14,980 businesses when
 * the next crawl's dry run estimated ~13,600. Each business that falls out
 * would lose a page that is already indexed and linked — a 404 caused by
 * sampling noise, not by the business closing.
 *
 * So a business the crawl did not return this time is kept for a bounded grace
 * period, measured from the last load whose crawl DID return it. Long enough
 * to ride out a few noisy runs, short enough that a business that really
 * closed eventually goes. See docs/adr/0016-carry-over-businesses-between-crawls.md.
 *
 * Pure by design: `now` is a parameter, not `Date.now()`, so the boundary is
 * testable to the millisecond and a replay of an old load is reproducible.
 */
import { dropSuppressed } from "./suppression";
import type { Business } from "./types";

/**
 * Eight weeks of wall-clock time. A business has to go unseen by every crawl
 * for two months before it is retired — a closed business lingers that long,
 * which is the price of not 404ing a live one over one bad sample. Crawls are
 * run by hand, so a re-crawl more than 56 days after the last one retires
 * everything it misses at once; pass --max-unseen-days to widen the window.
 */
export const DEFAULT_MAX_UNSEEN_DAYS = 56;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CarryOverOptions {
  now: Date;
  maxUnseenDays?: number;
  /** The takedown list. Applied to BOTH inputs — see `mergeCarryOver`. */
  suppressed: ReadonlySet<string>;
}

/**
 * Where every input record went. Printed on every load, because a carried
 * record and a retired one are both a difference in the total that nobody
 * could otherwise account for — the same reasoning as the "Suppressed" line
 * in ADR 0007.
 */
export interface CarryOverCounts {
  /** Returned by this crawl, after suppression. */
  fresh: number;
  /** Not returned this time, kept because it was seen within the grace period. */
  carried: number;
  /** Not returned this time and not seen for longer than the grace period. */
  retired: number;
  /** Distinct place ids dropped by the takedown list, from either input. */
  suppressed: number;
}

export interface CarryOverResult {
  businesses: Business[];
  counts: CarryOverCounts;
}

/** An ISO string that `Date` cannot read would otherwise become NaN maths. */
function timestampOf(record: Business): number | undefined {
  if (record.lastSeenAt === undefined) return undefined;
  const ms = Date.parse(record.lastSeenAt);
  if (Number.isNaN(ms)) {
    throw new Error(
      `Business ${record.placeId} has an unreadable lastSeenAt: ${JSON.stringify(record.lastSeenAt)}.`,
    );
  }
  return ms;
}

/**
 * Index by placeId, refusing duplicates. Picking one of two records with the
 * same id would hide whatever upstream bug produced them.
 */
function byPlaceId(
  records: readonly Business[],
  label: string,
): Map<string, Business> {
  const map = new Map<string, Business>();
  for (const record of records) {
    if (map.has(record.placeId)) {
      throw new Error(
        `Duplicate placeId ${record.placeId} in the ${label} set.`,
      );
    }
    map.set(record.placeId, record);
  }
  return map;
}

/**
 * Most-reviewed first — the order `pnpm load` has always written — with
 * placeId as the tiebreak. The tiebreak is new: before it, ties fell in
 * whatever order tiles were iterated, so two loads of the same data could
 * produce different files.
 */
function compare(a: Business, b: Business): number {
  const byReviews = (b.reviews ?? 0) - (a.reviews ?? 0);
  if (byReviews !== 0) return byReviews;
  return a.placeId < b.placeId ? -1 : a.placeId > b.placeId ? 1 : 0;
}

/**
 * Merge the previous dataset with a fresh crawl.
 *
 * - Fresh wins for an id in both sets, and every fresh record is stamped
 *   `lastSeenAt = now`.
 * - A previous-only record is carried, timestamp UNCHANGED, while
 *   `now - lastSeenAt <= maxUnseenDays`; past that it is retired. Re-stamping
 *   a carried record would restart its clock on every run and nothing would
 *   ever retire.
 * - A previous-only record with NO `lastSeenAt` is adopted and stamped `now`.
 *   That is every record built before this module existed. There is no honest
 *   older date to give it — the crawl that found it left no timestamp — and
 *   inventing one (the file's mtime, the v0.1 crawl date) would either retire
 *   the whole live directory on first adoption or claim a sighting that never
 *   happened. The grace period simply starts at adoption.
 * - The takedown list is applied to both inputs before anything else. The
 *   previous dataset was built before today's takedown, so without this a
 *   carried record would resurrect it — exactly the recurrence ADR 0007
 *   exists to stop. A suppressed record that is also stale is counted as
 *   suppressed, because that is why it is gone.
 */
export function mergeCarryOver(
  previous: readonly Business[],
  fresh: readonly Business[],
  options: CarryOverOptions,
): CarryOverResult {
  const { now, suppressed } = options;
  const maxUnseenDays = options.maxUnseenDays ?? DEFAULT_MAX_UNSEEN_DAYS;
  const nowMs = now.getTime();
  if (Number.isNaN(nowMs)) throw new Error("now is not a valid Date.");
  if (!Number.isFinite(maxUnseenDays) || maxUnseenDays < 0) {
    throw new Error(
      `maxUnseenDays must be a non-negative number; got ${maxUnseenDays}.`,
    );
  }
  const stamp = now.toISOString();
  const graceMs = maxUnseenDays * DAY_MS;

  const freshById = byPlaceId(fresh, "fresh");
  const previousById = byPlaceId(previous, "previous");

  // Counted as a set of ids, so a takedown present in both inputs is one
  // honoured request rather than two.
  const suppressedIds = new Set<string>();
  const freshKept = dropSuppressed([...freshById.values()], suppressed).kept;
  const previousKept = dropSuppressed(
    [...previousById.values()],
    suppressed,
  ).kept;
  for (const id of [...freshById.keys(), ...previousById.keys()]) {
    if (suppressed.has(id)) suppressedIds.add(id);
  }

  const businesses: Business[] = freshKept.map((record) => ({
    ...record,
    lastSeenAt: stamp,
  }));

  let carried = 0;
  let retired = 0;
  for (const record of previousKept) {
    if (freshById.has(record.placeId)) continue;
    const seen = timestampOf(record);
    if (seen === undefined) {
      businesses.push({ ...record, lastSeenAt: stamp });
      carried++;
    } else if (nowMs - seen <= graceMs) {
      businesses.push({ ...record });
      carried++;
    } else {
      retired++;
    }
  }

  businesses.sort(compare);
  return {
    businesses,
    counts: {
      fresh: freshKept.length,
      carried,
      retired,
      suppressed: suppressedIds.size,
    },
  };
}

const REQUIRED_STRINGS = ["placeId", "slug", "title", "area"] as const;

/**
 * Parse the previous `businesses.json`, rejecting anything that is not one.
 *
 * Throws rather than returning an empty list, for the reason
 * `parseSuppressionList` does: an empty carry-over and a broken one look
 * identical downstream, and only one is safe. A truncated download treated as
 * "nothing to carry" would switch the shrink protection off on exactly the run
 * that needed it. An empty array is rejected for the same reason — no live
 * directory is empty, so `[]` means the wrong file.
 *
 * Only the fields `mergeCarryOver` and the load stage rely on are checked;
 * the rest of the record is passed through as the previous load wrote it.
 */
export function parseCarryOver(json: string): Business[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) {
    throw new Error("Carry-over file must be a JSON array of businesses.");
  }
  if (parsed.length === 0) {
    throw new Error(
      "Carry-over file is an empty array. A live directory is never empty, so this is the wrong file.",
    );
  }

  const seen = new Set<string>();
  parsed.forEach((entry: unknown, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(`Carry-over record ${index} is not an object.`);
    }
    const record = entry as Record<string, unknown>;
    for (const field of REQUIRED_STRINGS) {
      if (typeof record[field] !== "string" || record[field] === "") {
        throw new Error(`Carry-over record ${index} has no valid ${field}.`);
      }
    }
    if (
      !Array.isArray(record.types) ||
      !record.types.every((t) => typeof t === "string")
    ) {
      throw new Error(`Carry-over record ${index} has no valid types array.`);
    }
    if (
      record.lastSeenAt !== undefined &&
      (typeof record.lastSeenAt !== "string" ||
        Number.isNaN(Date.parse(record.lastSeenAt)))
    ) {
      throw new Error(
        `Carry-over record ${index} has an unreadable lastSeenAt: ${JSON.stringify(record.lastSeenAt)}.`,
      );
    }
    const id = record.placeId as string;
    if (seen.has(id)) {
      throw new Error(
        `Carry-over file has a duplicate placeId ${id} (record ${index}).`,
      );
    }
    seen.add(id);
  });

  return parsed as Business[];
}

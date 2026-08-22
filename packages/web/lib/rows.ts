import type { Business } from "@directory/core";
import { corpusPrior, rankScore } from "@directory/core";
import { allBusinesses, areaLabel } from "./data";
import type { ListRow } from "@/components/filterable";

/**
 * The corpus prior, computed once per process.
 *
 * Derived from the whole dataset rather than the page being rendered — a
 * category page of six spas would otherwise produce a prior built from six
 * businesses, and every page would rank on a different scale.
 */
let prior: ReturnType<typeof corpusPrior> | null = null;
export function rankPrior() {
  prior ??= corpusPrior(allBusinesses());
  return prior;
}

/**
 * Resolve a Business into a display row.
 *
 * Done on the server on purpose: areaLabel() reads the city config off disk, so
 * resolving in a client component would pull node:fs into the browser bundle.
 *
 * Both formatted strings and raw numbers are carried. The strings are what gets
 * rendered; the numbers are what the client sorts and filters on, because
 * sorting "1,204" as text puts it before "89".
 */
export function toRow(b: Business): ListRow {
  const row: ListRow = {
    key: b.placeId,
    href: `/business/${b.slug}`,
    title: b.title,
    meta: [b.l3, b.l2, areaLabel(b.area)].filter(Boolean).join(" · "),
    rank: rankScore(b.rating, b.reviews, rankPrior()),
  };
  if (b.address) row.detail = b.address;
  if (b.rating !== undefined) {
    row.rating = b.rating.toFixed(1);
    row.ratingValue = b.rating;
  }
  if (b.reviews !== undefined) {
    row.reviews = b.reviews.toLocaleString();
    row.reviewsValue = b.reviews;
  }
  if (b.phoneRaw) row.phone = b.phoneRaw;
  return row;
}

/** Order a set of businesses by rank before they become rows. */
export function byRank(businesses: Business[]): Business[] {
  const p = rankPrior();
  return [...businesses].sort(
    (a, b) =>
      rankScore(b.rating, b.reviews, p) - rankScore(a.rating, a.reviews, p),
  );
}

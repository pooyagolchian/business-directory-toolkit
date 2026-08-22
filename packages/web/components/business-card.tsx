import type { Business } from "@directory/core";
import { BusinessRow, type CardRow } from "./business-row";
import { areaLabel } from "@/lib/data";

/**
 * Server-side resolution for a listing row.
 *
 * The markup lives in business-row.tsx, which the client also renders. This
 * file is the half that cannot cross that boundary: areaLabel() reads the city
 * config off disk.
 */

/**
 * Resolve a Business into a display row.
 *
 * The category is the first of l3/l2 rather than both, because a row is
 * scanned: "Coffee · Cafes · Al Barsha" spends a third of the line restating
 * itself.
 */
export function toCardRow(business: Business): CardRow {
  const category = [business.l3, business.l2].filter(Boolean)[0];
  const row: CardRow = {
    key: business.placeId,
    href: `/business/${business.slug}`,
    title: business.title,
    meta: [category, areaLabel(business.area)].filter(Boolean).join(" · "),
  };
  if (business.address) row.address = business.address;
  if (business.rating !== undefined) row.rating = business.rating.toFixed(1);
  if (business.reviews !== undefined) {
    row.reviews = business.reviews.toLocaleString();
  }
  if (business.phoneRaw) row.phone = business.phoneRaw;
  return row;
}

export function BusinessCard({ business }: { business: Business }) {
  return <BusinessRow row={toCardRow(business)} />;
}

export function BusinessList({
  businesses,
  emptyMessage = "No businesses found.",
}: {
  businesses: Business[];
  emptyMessage?: string;
}) {
  if (businesses.length === 0) {
    return <p className="py-12 text-[var(--muted)]">{emptyMessage}</p>;
  }
  return (
    <ul className="mt-2">
      {businesses.map((b) => (
        <BusinessCard key={b.placeId} business={b} />
      ))}
    </ul>
  );
}

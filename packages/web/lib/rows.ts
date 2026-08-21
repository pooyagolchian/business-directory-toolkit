import type { Business } from "@directory/core";
import { areaLabel } from "./data";
import type { ListRow } from "@/components/filterable";

/**
 * Resolve a Business into a display row.
 *
 * Done on the server on purpose: areaLabel() reads the city config off disk,
 * so resolving in a client component would pull node:fs into the browser.
 */
export function toRow(b: Business): ListRow {
  const row: ListRow = {
    key: b.placeId,
    href: `/business/${b.slug}`,
    title: b.title,
    meta: [b.l3, b.l2, areaLabel(b.area)].filter(Boolean).join(" · "),
  };
  if (b.address) row.detail = b.address;
  if (b.rating !== undefined) row.rating = b.rating.toFixed(1);
  if (b.reviews !== undefined) row.reviews = b.reviews.toLocaleString();
  if (b.phoneRaw) row.phone = b.phoneRaw;
  return row;
}

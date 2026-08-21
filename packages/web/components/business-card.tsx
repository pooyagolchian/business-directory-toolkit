import Link from "next/link";
import type { Business } from "@directory/core";
import { areaLabel } from "@/lib/data";

/**
 * One listing in a results list.
 *
 * `dir="auto"` on the title is load-bearing, not decoration: Dubai listings are
 * routinely bilingual ("Shamiat Restaurant مطعم شاميات"), and without it the
 * Arabic run renders in the wrong direction mid-line.
 *
 * Ratings and review counts use tabular figures so numbers line up down the
 * column — with no colour in the design, alignment is doing the work that
 * colour usually does.
 */
export function BusinessCard({ business }: { business: Business }) {
  const category = [business.l3, business.l2].filter(Boolean)[0];

  return (
    <li className="border-t border-[var(--rule)] last:border-b">
      <Link
        href={`/business/${business.slug}`}
        className="group flex gap-4 py-5 transition-opacity hover:opacity-60"
      >
        <div className="min-w-0 flex-1">
          <h3
            dir="auto"
            className="font-[family-name:var(--font-display)] text-lg leading-snug"
          >
            {business.title}
          </h3>

          <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]">
            {[category, areaLabel(business.area)].filter(Boolean).join(" · ")}
          </p>

          {business.address && (
            <p
              dir="auto"
              className="mt-1.5 line-clamp-1 text-sm text-[var(--muted)]"
            >
              {business.address}
            </p>
          )}
        </div>

        <div className="shrink-0 text-right">
          {business.rating !== undefined && (
            <p className="tabular text-sm">
              {business.rating.toFixed(1)}
              {business.reviews !== undefined && (
                <span className="text-[var(--muted)]">
                  {" "}
                  ({business.reviews.toLocaleString()})
                </span>
              )}
            </p>
          )}
          {business.phoneRaw && (
            <p className="tabular mt-1 text-xs text-[var(--muted)]">
              {business.phoneRaw}
            </p>
          )}
        </div>
      </Link>
    </li>
  );
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

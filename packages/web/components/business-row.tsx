import Link from "next/link";

/**
 * A listing row, already resolved for display.
 *
 * THIS FILE MUST NOT IMPORT FROM @/lib/data, and that is the entire reason it
 * is a separate file rather than an export of business-card.tsx.
 *
 * /search appends results as you scroll, so a client component renders these.
 * A Business cannot cross that boundary: resolving one needs areaLabel(), which
 * reads the city config off disk, and a client import of anything that reaches
 * it drags `node:fs` into the browser bundle. Keeping the markup here and the
 * resolution in business-card.tsx makes that impossible rather than merely
 * discouraged — the same division FilterableBusinessList's ListRow makes, for
 * the same reason.
 *
 * Every field is a finished string.
 */
export interface CardRow {
  /** Stable list key. */
  key: string;
  href: string;
  title: string;
  /** "Coffee · Al Barsha" — category and neighbourhood, already joined. */
  meta: string;
  address?: string;
  /** Formatted for display: "4.8" and "20,389". */
  rating?: string;
  reviews?: string;
  phone?: string;
}

/**
 * One listing in a results list.
 *
 * `dir="auto"` on the title is load-bearing, not decoration: Dubai listings are
 * routinely bilingual ("Shamiat Restaurant مطعم شاميات"), and without it the
 * Arabic run renders in the wrong direction mid-line.
 *
 * The title is sans 600, not the display serif. A results row is scanned, not
 * read: the eye is matching a shape against a remembered name, and Instrument
 * Serif's thin stems at 19px gave it less to match on than the muted address
 * underneath. The serif stays on headings, where the size makes it work.
 *
 * Ratings and review counts use tabular figures so numbers line up down the
 * column — with no colour in the design, alignment is doing the work that
 * colour usually does.
 */
export function BusinessRow({ row }: { row: CardRow }) {
  return (
    <li className="border-t border-[var(--rule)] last:border-b">
      <Link
        href={row.href}
        className="group flex gap-5 py-6 transition-opacity hover:opacity-60"
      >
        <div className="min-w-0 flex-1">
          <h3 dir="auto" className="text-lg font-semibold">
            {row.title}
          </h3>

          <p className="label mt-1.5 text-[var(--muted)]">{row.meta}</p>

          {row.address && (
            <p
              dir="auto"
              className="mt-2 line-clamp-1 text-sm text-[var(--muted)]"
            >
              {row.address}
            </p>
          )}
        </div>

        <div className="shrink-0 text-right">
          {row.rating && (
            <p className="tabular text-base">
              {row.rating}
              {row.reviews && (
                <span className="text-sm text-[var(--muted)]">
                  {" "}
                  ({row.reviews})
                </span>
              )}
            </p>
          )}
          {row.phone && (
            <p className="tabular mt-1.5 text-sm text-[var(--muted)]">
              {row.phone}
            </p>
          )}
        </div>
      </Link>
    </li>
  );
}

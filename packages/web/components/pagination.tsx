import Link from "next/link";

/**
 * Prev / next across a result set.
 *
 * Numbered pages are deliberately absent. "restaurant" filtered to nothing is
 * still 30 pages, and a strip of thirty numbers is a control nobody uses to
 * reach page 17 — they narrow instead. The filters above are the real
 * navigation; this is for walking the tail of one.
 */
export function Pagination({
  page,
  pages,
  hrefFor,
}: {
  page: number;
  pages: number;
  hrefFor: (page: number) => string;
}) {
  if (pages <= 1) return null;

  return (
    <nav
      aria-label="Result pages"
      className="mt-10 flex items-baseline justify-between gap-6 border-t border-[var(--rule)] pt-5"
    >
      <Step href={hrefFor(page - 1)} disabled={page <= 1} rel="prev">
        ← Previous
      </Step>

      <p className="tabular label text-[var(--muted)]">
        Page {page.toLocaleString()} of {pages.toLocaleString()}
      </p>

      <Step href={hrefFor(page + 1)} disabled={page >= pages} rel="next">
        Next →
      </Step>
    </nav>
  );
}

/**
 * At the ends of the range the control renders as text rather than a link.
 *
 * A disabled anchor is still focusable and still navigates; a span is the
 * honest markup for "there is nothing in that direction".
 *
 * It is muted ink rather than the rule token. `--rule` is ink-200, drawn for
 * hairlines — as text it measures 1.4:1 against paper, which is not a faint
 * label but an unreadable one. The absent underline is what separates this
 * from the live step; the two never need a contrast difference as well.
 */
function Step({
  href,
  disabled,
  rel,
  children,
}: {
  href: string;
  disabled: boolean;
  rel: "prev" | "next";
  children: React.ReactNode;
}) {
  if (disabled) {
    return <span className="text-sm text-[var(--muted)]">{children}</span>;
  }
  return (
    <Link
      href={href}
      rel={rel}
      prefetch={false}
      className="text-sm underline underline-offset-4 transition-opacity hover:opacity-60"
    >
      {children}
    </Link>
  );
}

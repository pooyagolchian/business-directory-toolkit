import type { Metadata } from "next";
import Link from "next/link";
import { Page } from "@/components/chrome";
import { SearchBox } from "@/components/search-box";
import { TAKEDOWN_URL } from "@/lib/site";

/**
 * The site-wide 404: any URL no route matches.
 *
 * It keeps the full Page chrome because the visitor is still on the site and
 * still wants something from it. Next's built-in page has no header and no way
 * back, which turns one dead link into a dead end. Next adds
 * `<meta name="robots" content="noindex">` to any 404 response itself.
 *
 * A listing that is not in the directory has its own, more specific page in
 * app/business/[slug]/not-found.tsx.
 */
export const metadata: Metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <Page>
      <h1 className="font-[family-name:var(--font-display)] text-3xl sm:text-5xl">
        Page not found
      </h1>
      <p className="mt-4 max-w-xl text-[var(--muted)]">
        Nothing is published at this address. The link may be mistyped, or the
        page may have moved.
      </p>

      {/* The one next action. Most people who land here were looking for a
          business, and the search box is the shortest way back to one. */}
      <div className="mt-10 max-w-xl">
        <SearchBox size="sm" />
      </div>

      <ul className="mt-12 flex flex-wrap gap-x-6 gap-y-2">
        <li>
          <Link
            href="/categories"
            className="underline underline-offset-4 hover:text-[var(--muted)]"
          >
            Browse by category
          </Link>
        </li>
        <li>
          <Link
            href="/areas"
            className="underline underline-offset-4 hover:text-[var(--muted)]"
          >
            Browse by area
          </Link>
        </li>
        <li>
          <a
            href={TAKEDOWN_URL}
            className="underline underline-offset-4 hover:text-[var(--muted)]"
          >
            Takedown policy
          </a>
        </li>
      </ul>
    </Page>
  );
}

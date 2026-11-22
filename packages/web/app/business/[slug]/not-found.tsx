import Link from "next/link";
import { Page } from "@/components/chrome";
import { SearchBox } from "@/components/search-box";
import { TAKEDOWN_URL } from "@/lib/site";

/**
 * Rendered when /business/[slug] calls notFound(): a slug that was never in
 * the dataset, one the crawl no longer finds, or one suppressed by a takedown.
 *
 * THE COPY IS GENERIC ON PURPOSE. This page must read the same for all three
 * causes, and must never confirm that a particular business asked to be
 * removed — that would publish the one fact the takedown request was made to
 * withdraw. So it names every cause as a possibility ("may have") and
 * confirms none of them, which is also simply true: the page cannot tell a
 * typo from a takedown, because by design a suppressed listing leaves nothing
 * behind to check against.
 *
 * The title comes from the page's generateMetadata, which already answers
 * "Not found" for a slug it cannot resolve.
 */
export default function BusinessNotFound() {
  return (
    <Page>
      <h1 className="font-[family-name:var(--font-display)] text-3xl sm:text-5xl">
        This listing isn’t in the directory
      </h1>
      <p className="mt-4 max-w-xl text-[var(--muted)]">
        It may have closed, changed its name, or been removed at the owner’s
        request — or the link may be mistyped. Try searching for it by name.
      </p>

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
          <a
            href={TAKEDOWN_URL}
            className="underline underline-offset-4 hover:text-[var(--muted)]"
          >
            How removal requests work
          </a>
        </li>
      </ul>
    </Page>
  );
}

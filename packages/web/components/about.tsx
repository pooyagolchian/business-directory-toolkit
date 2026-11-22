import Link from "next/link";
import { REPO_URL } from "@/lib/site";

/**
 * The short disclaimer and the maker's credit, shared by the footer, the home
 * page and /about so the three can never disagree about what the data is.
 *
 * The refresh sentence is a claim about the pipeline, not about this page. If
 * the crawl schedule changes, this is the one place to change it.
 */

const link = "underline underline-offset-4 hover:text-[var(--fg)]";

/** Where the maker's credit points. Not env-driven, unlike AUTHOR_URL. */
export const MAKER_URL = "https://pooyagolchian.com";

export function Disclaimer({ className }: { className?: string }) {
  return (
    <p className={className}>
      An{" "}
      <a href={REPO_URL} className={link}>
        open-source
      </a>{" "}
      project (MIT), built with the Business Directory Toolkit. Listings come
      from Google Maps via SearchApi, as of the retrieval date below, so details
      can be out of date. Not affiliated with Google or with the businesses
      listed.{" "}
      <Link href="/about" className={link}>
        About this directory
      </Link>
    </p>
  );
}

/**
 * The author's own credit, and openly an advert for the author's work.
 *
 * It says "Built by" and names the person, so it reads as the maker's mark
 * rather than as a sponsor's slot, and it is a plain link: no rel="sponsored",
 * because nobody paid for it. It is deliberately NOT built from AUTHOR_NAME /
 * AUTHOR_URL. Those are env-driven so a fork's structured data names the fork's
 * publisher; this line describes what one particular person sells, and a fork
 * rewriting the name under the same pitch would put words in someone else's
 * mouth. A fork that does not want it deletes it, as it deletes logo/.
 */
export function MakerCredit({ className }: { className?: string }) {
  return (
    <p className={className}>
      Built by Pooya Golchian — directories, data products and AI-search
      visibility for local businesses →{" "}
      <a href={MAKER_URL} className={link}>
        pooyagolchian.com
      </a>
    </p>
  );
}

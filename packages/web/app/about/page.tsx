import type { Metadata } from "next";
import { Breadcrumbs, Page } from "@/components/chrome";
import { MAKER_URL } from "@/components/about";
import { cityName, crawledAt, formatCrawlDate } from "@/lib/data";
import { REPO_URL, TAKEDOWN_URL } from "@/lib/site";

/**
 * What this site is, where its data comes from, and who made it.
 *
 * The long form of the footer's disclaimer. The footer has room for one
 * sentence on each point; this page is where a business owner, a journalist or
 * a developer weighing up the toolkit gets the version with the mechanics in
 * it. Static: nothing here changes between deploys except the crawl date.
 */
export function generateMetadata(): Metadata {
  return {
    title: "About this directory",
    description: `How this ${cityName()} business directory is built: an open-source toolkit, Google Maps data via SearchApi, how the data is refreshed, and a takedown policy for business owners.`,
    alternates: { canonical: "/about" },
  };
}

const link = "underline underline-offset-4 hover:text-[var(--muted)]";

export default function AboutPage() {
  const crawled = crawledAt();

  return (
    <Page>
      <Breadcrumbs trail={[{ href: "/", label: "Home" }, { label: "About" }]} />

      <h1 className="font-[family-name:var(--font-display)] text-3xl sm:text-5xl">
        About this directory
      </h1>
      <p className="mt-4 max-w-2xl text-lg text-[var(--muted)]">
        A directory of {cityName()} businesses, and the reference deployment of
        the Business Directory Toolkit: an open-source (MIT) toolkit for
        building a local business directory for any city.
      </p>

      {/* The same rhythm as a listing page: 48px above each section, 16px from
          a heading to its text. */}
      <section className="mt-12 max-w-2xl">
        <h2 className="font-[family-name:var(--font-display)] text-2xl">
          The toolkit
        </h2>
        <p className="mt-4">
          A city is data, not code. Each city is one JSON file holding its map
          tiles, categories, bounding boxes, country code and phone region, and
          nothing else in the code names a city. To run your own, you bring a
          SearchApi key, crawl your city, and deploy. The crawled data never
          goes into the repository, so every deployment crawls its own.
        </p>
        <p className="mt-3">
          <a href={REPO_URL} className={link}>
            Source code and setup on GitHub
          </a>
        </p>
      </section>

      <section className="mt-12 max-w-2xl">
        <h2 className="font-[family-name:var(--font-display)] text-2xl">
          Where the listings come from
        </h2>
        <p className="mt-4">
          Every listing comes from Google Maps, retrieved through SearchApi.
          Ratings and review counts are Google’s; nothing here is collected from
          visitors. The directory lists businesses only, never residential
          numbers or personal data.
        </p>
        <p className="mt-3">
          The listings are refreshed by re-running the crawl by hand, not on a
          schedule. A business that later crawls stop finding stays listed for 8
          weeks after it was last seen, then drops out of the directory, so
          places that close do disappear, but not straight away. Hours, phone
          numbers and even whether a place is still open can change between
          crawls, so confirm before you travel.
          {crawled && (
            <>
              {" "}
              The current data was retrieved on{" "}
              <time dateTime={crawled}>{formatCrawlDate(crawled)}</time>.
            </>
          )}
        </p>
        <p className="mt-3">
          This directory is not affiliated with Google or with any of the
          businesses listed.
        </p>
      </section>

      <section className="mt-12 max-w-2xl">
        <h2 className="font-[family-name:var(--font-display)] text-2xl">
          Removing a listing
        </h2>
        <p className="mt-4">
          If you own or represent a business and want it taken down, the
          takedown policy explains how to ask and how long it takes. A removed
          listing is suppressed by its Google place ID, which the pipeline
          checks on every run, so the next crawl does not bring it back.
        </p>
        <p className="mt-3">
          <a href={TAKEDOWN_URL} className={link}>
            Read the takedown policy
          </a>
        </p>
      </section>

      {/* The maker's credit, said plainly as what it is, in the first person
          because it is one. It ends the page so its one link is the obvious
          next step; the header already covers "back to the directory". */}
      <section className="mt-12 max-w-2xl">
        <h2 className="font-[family-name:var(--font-display)] text-2xl">
          Who built it
        </h2>
        <p className="mt-4">
          I’m Pooya Golchian. I build directories, data products and AI-search
          visibility for local businesses, and I develop this toolkit in public
          as part of the SearchApi Developer Ambassador Program. If you want a
          directory like this for your city or your industry, or want your
          business to show up when people ask an AI assistant, that is the work
          I do.
        </p>
        <p className="mt-3">
          <a href={MAKER_URL} className={link}>
            See my work at pooyagolchian.com →
          </a>
        </p>
      </section>
    </Page>
  );
}
